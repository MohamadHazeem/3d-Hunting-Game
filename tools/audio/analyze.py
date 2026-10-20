"""Render waveform + spectrogram sheets for audio files so they can be checked by eye.
Usage: python3 tools/audio/analyze.py out.png file1 [file2 ...]"""
import subprocess, sys
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

def load(path, sr=44100):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32), sr

def main():
    out, files = sys.argv[1], sys.argv[2:]
    fig, axes = plt.subplots(len(files), 2, figsize=(14, 2.1 * len(files)), squeeze=False,
                             gridspec_kw={"width_ratios": [1, 2]})
    for row, f in zip(axes, files):
        x, sr = load(f)
        peak = float(np.max(np.abs(x))) if len(x) else 0
        rms = float(np.sqrt(np.mean(x ** 2))) if len(x) else 0
        t = np.arange(len(x)) / sr
        row[0].plot(t, x, lw=0.4, color="#333")
        row[0].set_ylim(-1, 1)
        row[0].set_title(f"{f.split('/')[-1][:40]}  {len(x)/sr:.2f}s  peak {20*np.log10(peak+1e-9):.1f}dB  rms {20*np.log10(rms+1e-9):.1f}dB", fontsize=8)
        row[1].specgram(x + 1e-9, NFFT=1024, Fs=sr, noverlap=768, cmap="magma", vmin=-120)
        row[1].set_ylim(0, 16000)
        row[1].tick_params(labelsize=7)
    plt.tight_layout()
    plt.savefig(out, dpi=80)
    print("wrote", out)

main()
