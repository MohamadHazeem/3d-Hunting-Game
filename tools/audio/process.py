"""Turn raw recordings into game-ready sounds in public/audio.

  python3 tools/audio/process.py <elevenlabs_raw_dir> <commons_raw_dir> <out_dir>

- ElevenLabs one-shots: trimmed, click-free tails, peak-normalised.
- Footstep sequences: split into single steps.
- Ambience beds: seamless loops (crossfaded), loudness-matched.
- Bird recordings: filtered to the species' band, individual calls/phrases
  cut out and the cleanest ones kept.
Writes manifest.json (sound name -> files) for src/audio/audio.js.
"""
import json, os, subprocess, sys
import numpy as np

SR = 44100


def load(path, stereo=False):
    ch = 2 if stereo else 1
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", str(ch), "-ar", str(SR), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype=np.float32).copy()
    return x.reshape(-1, ch).T if stereo else x


def save(x, path, bitrate="96k"):
    x = np.asarray(x, dtype=np.float32)
    ch = 1 if x.ndim == 1 else x.shape[0]
    data = (x if x.ndim == 1 else x.T).astype(np.float32).tobytes()
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", str(ch), "-i", "-",
                    "-codec:a", "libmp3lame", "-b:a", bitrate, path], input=data, check=True)


def db(v):
    return 10 ** (v / 20)


def env(x, win=0.01):
    n = max(1, int(win * SR))
    a = np.abs(x if x.ndim == 1 else x.mean(0))
    return np.convolve(a, np.ones(n) / n, mode="same")


def fade(x, fin=0.002, fout=0.03):
    x = x.copy()
    n_in, n_out = int(fin * SR), int(fout * SR)
    if n_in:
        x[..., :n_in] *= np.linspace(0, 1, n_in)
    if n_out and x.shape[-1] > n_out:
        x[..., -n_out:] *= np.linspace(1, 0, n_out) ** 2
    return x


def trim(x, start_db=-45, end_db=-55, cut_tail=0.08):
    if cut_tail:
        x = x[..., : max(1, x.shape[-1] - int(cut_tail * SR))]  # ElevenLabs files often end in a click
    e = env(x, 0.005)
    peak = e.max() + 1e-9
    on = np.where(e > peak * db(start_db + 20))[0]
    if not len(on):
        return x
    s = max(0, on[0] - int(0.004 * SR))
    off = np.where(e > peak * db(end_db + 20))[0]
    t = min(x.shape[-1], off[-1] + int(0.05 * SR))
    return x[..., s:t]


def peak_norm(x, target=-1.0):
    p = np.abs(x).max() + 1e-9
    return x * (db(target) / p)


def rms_norm(x, target=-24.0, ceiling=-1.0):
    r = np.sqrt(np.mean(x ** 2)) + 1e-9
    x = x * (db(target) / r)
    p = np.abs(x).max()
    if p > db(ceiling):
        x = np.tanh(x / db(ceiling)) * db(ceiling)  # soft-limit the rare peaks
    return x


def band(x, lo, hi):
    """Brick-wall-ish band filter in the frequency domain (fine for offline use)."""
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    w = np.clip((f - lo * 0.8) / (lo * 0.2 + 1), 0, 1) * np.clip((hi * 1.2 - f) / (hi * 0.2 + 1), 0, 1)
    return np.fft.irfft(X * w, n=len(x)).astype(np.float32)


def events(x, thresh_k=4.0, gap=0.08, min_len=0.03, win=0.008):
    e = env(x, win)
    floor = np.median(e)
    mad = np.median(np.abs(e - floor)) + 1e-9
    th = floor + thresh_k * mad * 1.4826
    on = e > th
    ev, i, n = [], 0, len(on)
    while i < n:
        if on[i]:
            j = i
            while j < n and on[j]:
                j += 1
            ev.append([i, j])
            i = j
        else:
            i += 1
    merged = []
    for s, t in ev:
        if merged and s - merged[-1][1] < gap * SR:
            merged[-1][1] = t
        else:
            merged.append([s, t])
    out = []
    for s, t in merged:
        if (t - s) / SR < min_len:
            continue
        snr = e[s:t].max() / (floor + 1e-9)
        out.append((s, t, snr))
    return out


def slice_events(x, ev, pad=0.04, max_len=None, keep=6, min_gap_to_next=0.0):
    ev = sorted(ev, key=lambda v: -v[2])[: keep * 3]
    picks = []
    for s, t, snr in ev:
        s0 = max(0, s - int(pad * SR))
        t0 = min(len(x), t + int(pad * 1.5 * SR))
        if max_len:
            t0 = min(t0, s0 + int(max_len * SR))
        if any(not (t0 < a or s0 > b) for a, b, _ in picks):
            continue
        picks.append((s0, t0, snr))
        if len(picks) >= keep:
            break
    picks.sort()
    return [fade(x[a:b], 0.004, min(0.04, (b - a) / SR * 0.3)) for a, b, _ in picks]


def main():
    el, cm, out = sys.argv[1:4]
    os.makedirs(out, exist_ok=True)
    groups, beds = {}, {}

    def add(name, arr, fname, bitrate="96k"):
        save(arr, os.path.join(out, fname), bitrate)
        groups.setdefault(name, []).append(fname)

    # -------- ElevenLabs one-shots
    ONE = {
        "shot": ["shot_near_1", "shot_near_2", "shot_near_3"],
        "shotFar": ["shot_far_1", "shot_far_2"],
        "breakOpen": ["gun_open"], "breakClose": ["gun_close"], "shellOut": ["shell_eject"],
        "shellIn": ["shell_insert_1", "shell_insert_2"], "dry": ["dry_fire"], "shellDrop": ["shell_drop"],
        "whirr": ["flush_quail_2", "flush_quail_1"], "clatter": ["flush_woodcock"], "flockFlush": ["flock_takeoff"],
        "flap": ["flap_2"], "land": ["land_1", "land_2"], "flutter": ["flutter_2"], "run": ["run_1"],
        "wingPass": ["wing_pass"], "thud": ["bird_thud"], "pickup": ["pickup"], "cloth": ["cloth"], "whistle": ["whistle_2"],
        "farSheep": ["far_sheep"], "farBell": ["far_church_bell"], "farDog": ["far_dog"], "farRooster": ["far_rooster"],
    }
    for name, files in ONE.items():
        for f in files:
            p = os.path.join(el, f + ".mp3")
            if not os.path.exists(p):
                continue
            x = trim(load(p))
            if f == "shell_eject":
                x = x[int(0.42 * SR):] if len(x) > 0.6 * SR else x
            x = fade(peak_norm(x, -1.0), 0.002, 0.04)
            add(name, x, f + ".mp3")

    # -------- footsteps: split sequences into single steps
    STEPS = {"step": "steps_grass", "stepLeaves": "steps_leaves", "stepGravel": "steps_gravel",
             "stepStone": "steps_stone", "stepSnow": "steps_snow"}
    for name, f in STEPS.items():
        p = os.path.join(el, f + ".mp3")
        if not os.path.exists(p):
            continue
        x = load(p)[: -int(0.08 * SR)]
        ev = events(band(x, 80, 12000), thresh_k=3.0, gap=0.12, min_len=0.04, win=0.012)
        steps = slice_events(x, ev, pad=0.015, max_len=0.42, keep=8)
        for i, s in enumerate(steps):
            add(name, peak_norm(s, -3), f"{f}_{i + 1}.mp3")

    # -------- ambience beds: seamless loops, matched loudness
    BEDS = {"dawn": "amb_dawn", "cicadas": "amb_cicadas", "crickets": "amb_crickets",
            "windTrees": "amb_wind_trees", "windOpen": "amb_wind_open", "winterWood": "amb_winter_wood"}
    for name, f in BEDS.items():
        p = os.path.join(el, f + ".mp3")
        if not os.path.exists(p):
            continue
        x = load(p, stereo=True)[:, : -int(0.08 * SR)]
        cf = int(1.2 * SR)
        y = x[:, :-cf].copy()
        k = np.linspace(0, 1, cf)
        y[:, :cf] = x[:, :cf] * np.sqrt(k) + x[:, -cf:] * np.sqrt(1 - k)
        y = rms_norm(y, -24 if name != "winterWood" else -30)
        save(y, os.path.join(out, f + ".mp3"), "128k")
        beds[name] = f + ".mp3"

    # -------- bird recordings
    BIRDS = [
        # name, files, band, merge gap, max length, keep
        ("tsip", ["thrush_call_a", "thrush_call_b", "thrush_call_c", "thrush_call_d"], (4500, 11000), 0.06, 0.35, 3),
        ("chack", ["fieldfare_call_a", "fieldfare_call_b"], (1500, 9000), 0.25, 1.2, 4),
        ("pink", ["chaffinch_call_a", "chaffinch_call_b"], (2000, 9000), 0.06, 0.4, 4),
        ("rattle", ["mistle_call_a"], (1500, 9000), 0.15, 1.2, 4),
        ("quail", ["quail_song_a", "quail_song_b"], (1500, 6000), 0.25, 1.2, 4),
        ("songThrush", ["thrush_song_a", "thrush_song_b"], (1500, 10000), 0.35, 4.0, 4),
        ("songChaffinch", ["chaffinch_song_a", "chaffinch_song_b"], (1800, 9000), 0.35, 3.5, 4),
    ]
    seen = set()
    for name, files, (lo, hi), gap, max_len, keep in BIRDS:
        n = 0
        for f in files:
            cand = [c for c in os.listdir(cm) if os.path.splitext(c)[0] == f]
            if not cand:
                continue
            raw = open(os.path.join(cm, cand[0]), "rb").read()
            digest = hash(raw)
            if digest in seen:  # the same recording twice would give duplicate calls
                print("skip duplicate", cand[0])
                continue
            seen.add(digest)
            x = band(load(os.path.join(cm, cand[0])), lo, hi)
            ev = events(x, thresh_k=5.0, gap=gap, min_len=0.025)
            for s in slice_events(x, ev, pad=0.05, max_len=max_len, keep=keep):
                n += 1
                add(name, peak_norm(s, -2), f"{name}_{n}.mp3")

    json.dump({"groups": groups, "beds": beds}, open(os.path.join(out, "manifest.json"), "w"), indent=1)
    for k, v in groups.items():
        print(f"{k:14} {len(v)}")
    print("beds", list(beds))


main()
