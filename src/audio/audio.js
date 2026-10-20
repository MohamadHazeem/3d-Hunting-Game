import { Random } from '../core/rng.js';

// The sound system. Recorded and generated samples (public/audio) are mixed
// through separate buses (effects, birds, ambience, voice, music) with their
// own volumes. Positional sounds travel at the speed of sound, lose their
// highs over distance, are muffled behind hills, and gunshots echo off the
// real slopes around the shooter. Every sound also has a synthesised
// fallback (below) that plays until the samples have loaded, or if they fail.

const rnd = new Random(12345);
const noise = () => rnd.float(-1, 1);

function env(t, a, d) {
  return t < a ? t / a : Math.exp(-(t - a) / d);
}

function makeBuffer(ctx, dur, fn, channels = 1) {
  const sr = ctx.sampleRate;
  const n = Math.floor(dur * sr);
  const buf = ctx.createBuffer(channels, n, sr);
  for (let c = 0; c < channels; c++) {
    const d = buf.getChannelData(c);
    const st = {};
    for (let i = 0; i < n; i++) d[i] = fn(i / sr, st, c);
  }
  return buf;
}

// One-pole filters used inside synth functions.
function lp(st, key, x, a) {
  st[key] = (st[key] || 0) + a * (x - (st[key] || 0));
  return st[key];
}

const SYNTH = {
  shot: (ctx) =>
    makeBuffer(ctx, 1.4, (t, st) => {
      const n = noise();
      const crack = n * env(t, 0.0005, 0.018) * 1.0;
      const body = lp(st, 'b', n, 0.12) * env(t, 0.001, 0.09) * 2.2;
      const f = 48 + 60 * Math.exp(-t * 18);
      st.p = (st.p || 0) + (2 * Math.PI * f) / ctx.sampleRate;
      const boom = Math.sin(st.p) * env(t, 0.002, 0.16) * 0.9;
      const tail = lp(st, 't', n, 0.03) * env(t, 0.01, 0.35) * 1.4;
      return Math.tanh((crack + body + boom + tail) * 1.4) * 0.9;
    }),
  dry: (ctx) => makeBuffer(ctx, 0.06, (t) => noise() * env(t, 0.0005, 0.006) * 0.5),
  breakOpen: (ctx) =>
    makeBuffer(ctx, 0.35, (t, st) => {
      const c1 = noise() * env(t, 0.0005, 0.01);
      const c2 = t > 0.12 ? noise() * env(t - 0.12, 0.0005, 0.02) * 0.7 : 0;
      return lp(st, 'a', c1 + c2, 0.5) * 0.8;
    }),
  breakClose: (ctx) =>
    makeBuffer(ctx, 0.25, (t, st) => {
      const c = noise() * env(t, 0.0005, 0.015) + Math.sin(t * 2 * Math.PI * 900) * env(t, 0.001, 0.03) * 0.4;
      return lp(st, 'a', c, 0.6) * 0.9;
    }),
  shellIn: (ctx) => makeBuffer(ctx, 0.15, (t, st) => lp(st, 'a', noise(), 0.3) * env(t, 0.001, 0.02) * 0.7),
  shellOut: (ctx) =>
    makeBuffer(ctx, 0.5, (t, st) => {
      const a = lp(st, 'a', noise(), 0.4) * env(t, 0.001, 0.02);
      const b = t > 0.32 ? Math.sin(t * 2 * Math.PI * 2600) * env(t - 0.32, 0.001, 0.03) * 0.3 : 0;
      return a * 0.6 + b;
    }),
  whirr: (ctx) =>
    // quail / partridge flush: very fast wingbeats
    makeBuffer(ctx, 1.1, (t, st) => {
      const n = noise();
      const band = lp(st, 'h', n, 0.5) - lp(st, 'l', n, 0.08);
      const am = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 21);
      return band * am * env(t, 0.01, 0.38) * 1.6;
    }),
  clatter: (ctx) =>
    // woodcock: softer wing clatter through leaves
    makeBuffer(ctx, 0.8, (t, st) => {
      const n = noise();
      const band = lp(st, 'h', n, 0.35) - lp(st, 'l', n, 0.04);
      const am = Math.pow(0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 11), 2);
      return band * am * env(t, 0.01, 0.3) * 1.5;
    }),
  flap: (ctx) =>
    makeBuffer(ctx, 0.5, (t, st) => {
      const n = noise();
      const band = lp(st, 'h', n, 0.3) - lp(st, 'l', n, 0.05);
      return band * Math.pow(0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 9), 3) * env(t, 0.01, 0.2);
    }),
  quail: (ctx) =>
    // "wet-my-lips": one short then two quick notes
    makeBuffer(ctx, 0.75, (t, st) => {
      const notes = [0.0, 0.26, 0.42];
      let s = 0;
      for (const n0 of notes) {
        const dt = t - n0;
        if (dt < 0 || dt > 0.09) continue;
        const f = 2900 + 900 * Math.sin((dt / 0.09) * Math.PI) - 500 * (dt / 0.09);
        s += Math.sin(2 * Math.PI * f * dt + 3 * Math.sin(2 * Math.PI * 70 * dt)) * Math.sin((dt / 0.09) * Math.PI);
      }
      return s * 0.5;
    }),
  tsip: (ctx) =>
    makeBuffer(ctx, 0.14, (t) => {
      const f = 7600 - 2400 * (t / 0.12);
      return Math.sin(2 * Math.PI * f * t) * Math.sin(Math.min(1, t / 0.12) * Math.PI) * 0.35;
    }),
  chack: (ctx) =>
    makeBuffer(ctx, 0.42, (t, st) => {
      let s = 0;
      for (const n0 of [0, 0.17]) {
        const dt = t - n0;
        if (dt < 0 || dt > 0.09) continue;
        const n = noise();
        const band = lp(st, 'h' + n0, n, 0.7) - lp(st, 'l' + n0, n, 0.25);
        s += (band * 1.2 + Math.sin(2 * Math.PI * 2100 * dt) * 0.4) * env(dt, 0.004, 0.03);
      }
      return s * 0.8;
    }),
  pink: (ctx) =>
    makeBuffer(ctx, 0.1, (t) => {
      const f = 5200 + 800 * Math.exp(-t * 60);
      return Math.sin(2 * Math.PI * f * t) * env(t, 0.003, 0.025) * 0.4;
    }),
  woodcock: (ctx) =>
    makeBuffer(ctx, 0.3, (t) => {
      const f = 4200 + 2600 * Math.sin((t / 0.18) * Math.PI);
      return t < 0.18 ? Math.sin(2 * Math.PI * f * t) * Math.sin((t / 0.18) * Math.PI) * 0.25 : 0;
    }),
  whistle: (ctx) =>
    // the hunter's mouth whistle imitating a thrush: "tsiii-tsiip"
    makeBuffer(ctx, 0.9, (t, st) => {
      let s = 0;
      for (const [n0, d] of [[0, 0.32], [0.45, 0.16]]) {
        const dt = t - n0;
        if (dt < 0 || dt > d) continue;
        const f = 5600 + 500 * Math.sin((dt / d) * Math.PI) + 120 * Math.sin(dt * 2 * Math.PI * 28);
        st['p' + n0] = (st['p' + n0] || 0) + (2 * Math.PI * f) / ctx.sampleRate;
        s += Math.sin(st['p' + n0]) * Math.sin((dt / d) * Math.PI) * 0.35 + noise() * 0.03 * Math.sin((dt / d) * Math.PI);
      }
      return s;
    }),
  step: (ctx) =>
    makeBuffer(ctx, 0.18, (t, st) => {
      const n = noise();
      return (lp(st, 'a', n, 0.12) * 1.4 + (n - lp(st, 'b', n, 0.2)) * 0.25) * env(t, 0.004, 0.04);
    }),
  stepLeaves: (ctx) =>
    makeBuffer(ctx, 0.3, (t, st) => {
      const n = noise() * (rnd.next() < 0.3 ? 1.6 : 0.6);
      return ((n - lp(st, 'b', n, 0.15)) * 0.6 + lp(st, 'a', n, 0.1)) * env(t, 0.01, 0.08);
    }),
  pickup: (ctx) =>
    makeBuffer(ctx, 0.5, (t, st) => {
      const n = noise();
      return (n - lp(st, 'b', n, 0.2)) * 0.4 * env(t, 0.02, 0.12);
    }),
  hit: (ctx) => makeBuffer(ctx, 0.12, (t, st) => lp(st, 'a', noise(), 0.25) * env(t, 0.001, 0.02) * 0.8),
  wind: (ctx) =>
    makeBuffer(
      ctx,
      8,
      (t, st, c) => {
        const n = noise();
        const slow = 0.55 + 0.45 * Math.sin(t * 0.8 + c) * Math.sin(t * 0.33 + 1.3);
        const fade = Math.min(1, t / 0.5, (8 - t) / 0.5);
        return lp(st, 'a', n, 0.02 + 0.015 * slow) * slow * 2.2 * fade;
      },
      2
    ),
};

// turtle dove: a deep purring "turrr turrr"
SYNTH.purr = (ctx) =>
  makeBuffer(ctx, 1.6, (t) => {
    let s = 0;
    for (const n0 of [0, 0.75]) {
      const dt = t - n0;
      if (dt < 0 || dt > 0.6) continue;
      const am = 0.5 + 0.5 * Math.sin(2 * Math.PI * 24 * dt);
      s += Math.sin(2 * Math.PI * (560 - 60 * (dt / 0.6)) * dt) * am * Math.sin((dt / 0.6) * Math.PI);
    }
    return s * 0.35;
  });
// woodpigeon: the five-note "coo-COO-coo, coo-coo"
SYNTH.coo = (ctx) =>
  makeBuffer(ctx, 2.6, (t) => {
    let s = 0;
    for (const [n0, d, a] of [[0, 0.3, 0.7], [0.4, 0.5, 1], [1.0, 0.3, 0.8], [1.45, 0.28, 0.7], [1.85, 0.28, 0.6]]) {
      const dt = t - n0;
      if (dt < 0 || dt > d) continue;
      const f = 420 + 40 * Math.sin((dt / d) * Math.PI);
      s += (Math.sin(2 * Math.PI * f * dt) + 0.3 * Math.sin(4 * Math.PI * f * dt)) * Math.sin((dt / d) * Math.PI) * a;
    }
    return s * 0.3;
  });
SYNTH.hitConfirm = SYNTH.hit;

const SPEED_OF_SOUND = 343;
const MAX_VOICES = 48;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const bell = (x, mid, w) => Math.exp(-(((x - mid) / w) ** 2));
const ramp = (x, a, b) => clamp01((x - a) / (b - a));

export const BUSES = ['effects', 'birds', 'ambience', 'voice', 'music'];
export const VOLUME_DEFAULTS = { master: 0.9, effects: 1, birds: 1, ambience: 0.8, voice: 1, music: 0.5 };

// Bus and priority for each sound. When too many sounds want to play at
// once, the lowest priority (then the oldest) gives way.
const ROUTING = {
  shot: ['effects', 10], shotEcho: ['effects', 7], shotFar: ['ambience', 5],
  dry: ['effects', 6], breakOpen: ['effects', 6], breakClose: ['effects', 6], shellIn: ['effects', 6], shellOut: ['effects', 6], shellDrop: ['effects', 3],
  whirr: ['effects', 8], clatter: ['effects', 8], flap: ['effects', 5], flutter: ['effects', 5], wingPass: ['effects', 4], wingClap: ['effects', 4],
  land: ['effects', 3], hit: ['effects', 5], thud: ['effects', 4], flockFlush: ['effects', 6], run: ['effects', 3], hitConfirm: ['effects', 6], pickup: ['effects', 6], cloth: ['effects', 3], whistle: ['effects', 6],
  step: ['effects', 4], stepLeaves: ['effects', 4], stepGravel: ['effects', 4], stepStone: ['effects', 4], stepSnow: ['effects', 4],
  quail: ['birds', 4], tsip: ['birds', 3], chack: ['birds', 3], pink: ['birds', 3], woodcock: ['birds', 3], rattle: ['birds', 3],
  songThrush: ['birds', 2], songChaffinch: ['birds', 2], purr: ['birds', 3], coo: ['birds', 3],
  dogWhistle: ['effects', 6], dogShake: ['effects', 3],
  farSheep: ['ambience', 1], farBell: ['ambience', 1], farDog: ['ambience', 1], farRooster: ['ambience', 1],
};

// When a sound has no sample or synth of its own, use another one.
const ALIASES = {
  shotEcho: 'shot', shotFar: 'shot', flutter: 'wingPass', wingPass: 'flap', wingClap: 'flap', thud: 'hit', flockFlush: 'flap',
  stepGravel: 'step', stepStone: 'step', stepSnow: 'step', rattle: 'chack', shellDrop: 'shellIn',
};

// Looping ambience beds, crossfaded by hour, month, place and weather.
const BEDS = ['dawn', 'cicadas', 'crickets', 'windTrees', 'windOpen', 'winterWood'];
const BED_GAIN = { dawn: 0.5, cicadas: 0.32, crickets: 0.3, windTrees: 0.45, windOpen: 0.4, winterWood: 0.45 };

function localNum(k, d) {
  try {
    const v = localStorage.getItem('lbh.vol.' + k);
    return v == null ? d : parseFloat(v);
  } catch {
    return d;
  }
}

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.buffers = {}; // synthesised fallbacks
    this.samples = {}; // name -> [AudioBuffer]
    this.bedBuffers = {};
    this.lastPick = {};
    this.voices = [];
    this.enabled = true;
    this.vol = {};
    for (const k of Object.keys(VOLUME_DEFAULTS)) this.vol[k] = localNum(k, VOLUME_DEFAULTS[k]);
    this.heightFn = null;
    this.reflCache = { key: '', list: [] };
    this.amb = null;
  }

  async init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx({ sampleRate: 48000 });
    const ctx = this.ctx;

    // master -> gentle glue compressor -> brickwall-ish limiter -> out
    this.master = ctx.createGain();
    this.master.gain.value = this.vol.master;
    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -18;
    glue.knee.value = 12;
    glue.ratio.value = 3;
    glue.attack.value = 0.01;
    glue.release.value = 0.25;
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -3;
    limit.knee.value = 0;
    limit.ratio.value = 20;
    limit.attack.value = 0.001;
    limit.release.value = 0.1;
    this.master.connect(glue).connect(limit).connect(ctx.destination);

    // buses; birds and ambience also pass through a duck stage that dips
    // under your own gunshots
    this.buses = {};
    this.ducks = {};
    for (const b of BUSES) {
      const g = ctx.createGain();
      g.gain.value = this.vol[b];
      if (b === 'birds' || b === 'ambience') {
        const d = ctx.createGain();
        g.connect(d).connect(this.master);
        this.ducks[b] = d;
      } else g.connect(this.master);
      this.buses[b] = g;
    }

    // valley reverb: long, dark, slightly delayed impulse
    const ir = makeBuffer(
      ctx,
      3.2,
      (t, st) => {
        const n = noise();
        const pre = t < 0.04 ? 0 : 1;
        return lp(st, 'a', n, 0.18 - Math.min(0.14, t * 0.04)) * Math.exp(-t * 1.6) * pre * 1.6;
      },
      2
    );
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    this.reverbIn = ctx.createGain();
    this.reverbIn.connect(this.reverb).connect(this.buses.effects);

    // generic late echoes off far ranges, for open ground with no near slopes
    this.echoIn = ctx.createGain();
    const echoLP = ctx.createBiquadFilter();
    echoLP.type = 'lowpass';
    echoLP.frequency.value = 1200;
    this.echoIn.connect(echoLP);
    for (const [d, g] of [[1.9, 0.22], [3.1, 0.14], [4.6, 0.08]]) {
      const delay = ctx.createDelay(6);
      delay.delayTime.value = d;
      const gn = ctx.createGain();
      gn.gain.value = g;
      echoLP.connect(delay).connect(gn);
      gn.connect(this.buses.effects);
      gn.connect(this.reverbIn);
    }

    for (const k of Object.keys(SYNTH)) this.buffers[k] = SYNTH[k](ctx);
    this.startSynthWind();
    this.loaded = this.loadSamples();
  }

  // ------------------------------------------------ samples

  async loadSamples() {
    const base = (import.meta.env && import.meta.env.BASE_URL) || '/';
    let manifest;
    try {
      manifest = await (await fetch(`${base}audio/manifest.json`)).json();
    } catch {
      return;
    }
    const decode = async (file) => {
      const r = await fetch(`${base}audio/${file}`);
      if (!r.ok) throw new Error(file);
      return await this.ctx.decodeAudioData(await r.arrayBuffer());
    };
    const jobs = [];
    for (const [name, files] of Object.entries(manifest.groups || {})) {
      for (const f of files) {
        jobs.push(async () => {
          try {
            const buf = await decode(f);
            (this.samples[name] ||= []).push(buf);
          } catch {}
        });
      }
    }
    for (const [name, f] of Object.entries(manifest.beds || {})) {
      jobs.push(async () => {
        try {
          this.bedBuffers[name] = await decode(f);
          if (this.amb) this.startBed(name);
        } catch {}
      });
    }
    // a few at a time so the hunt starts without waiting
    const queue = jobs.slice();
    const worker = async () => {
      while (queue.length) await queue.shift()();
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    this.samplesReady = true;
  }

  has(name) {
    return !!(this.samples[name]?.length || this.buffers[name]);
  }

  pick(name, depth = 0) {
    const list = this.samples[name];
    if (list && list.length) {
      let i = Math.floor(Math.random() * list.length);
      if (list.length > 1 && i === this.lastPick[name]) i = (i + 1) % list.length;
      this.lastPick[name] = i;
      return list[i];
    }
    if (this.buffers[name]) return this.buffers[name];
    const alt = ALIASES[name];
    return alt && depth < 3 ? this.pick(alt, depth + 1) : null;
  }

  // ------------------------------------------------ mixer

  setVolume(bus, v) {
    this.vol[bus] = v;
    try {
      localStorage.setItem('lbh.vol.' + bus, String(v));
    } catch {}
    if (!this.ctx) return;
    const node = bus === 'master' ? this.master : this.buses[bus];
    if (node) node.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  // Dip birds and ambience under a loud sound, then let them come back.
  duck(depth = 0.35, recover = 1.5) {
    const t = this.ctx.currentTime;
    for (const d of Object.values(this.ducks)) {
      d.gain.cancelScheduledValues(t);
      d.gain.setTargetAtTime(depth, t, 0.01);
      d.gain.setTargetAtTime(1, t + 0.12, recover / 3);
    }
  }

  // Too many sounds at once: lowest priority (then oldest) makes way.
  admit(prio) {
    const now = this.ctx.currentTime;
    this.voices = this.voices.filter((v) => v.end > now);
    if (this.voices.length < MAX_VOICES) return true;
    let worst = null;
    for (const v of this.voices) if (!worst || v.prio < worst.prio || (v.prio === worst.prio && v.start < worst.start)) worst = v;
    if (worst.prio > prio) return false;
    try {
      worst.src.stop();
    } catch {}
    this.voices.splice(this.voices.indexOf(worst), 1);
    return true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  // The world the sound travels through: terrain height for echoes and
  // for muffling sounds behind hills.
  setWorld(heightFn) {
    this.heightFn = heightFn;
    this.reflCache = { key: '', list: [] };
  }

  setListener(camera) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    const p = camera.position;
    const m = camera.matrixWorld.elements;
    const fx = -m[8], fy = -m[9], fz = -m[10];
    const ux = m[4], uy = m[5], uz = m[6];
    if (L.positionX) {
      const t = this.ctx.currentTime;
      L.positionX.setTargetAtTime(p.x, t, 0.02);
      L.positionY.setTargetAtTime(p.y, t, 0.02);
      L.positionZ.setTargetAtTime(p.z, t, 0.02);
      L.forwardX.setTargetAtTime(fx, t, 0.02);
      L.forwardY.setTargetAtTime(fy, t, 0.02);
      L.forwardZ.setTargetAtTime(fz, t, 0.02);
      L.upX.setTargetAtTime(ux, t, 0.02);
      L.upY.setTargetAtTime(uy, t, 0.02);
      L.upZ.setTargetAtTime(uz, t, 0.02);
    } else {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(fx, fy, fz, ux, uy, uz);
    }
    this.listenerPos = p;
  }

  // How much the ground hides a sound source from the listener (0 open, 1 behind a hill).
  occlusion(pos, d) {
    const H = this.heightFn;
    const L = this.listenerPos;
    if (!H || !L || d < 25) return 0;
    let above = 0;
    for (let i = 1; i < 12; i++) {
      const k = i / 12;
      const x = L.x + (pos.x - L.x) * k;
      const z = L.z + (pos.z - L.z) * k;
      const y = L.y + (pos.y - L.y) * k;
      above = Math.max(above, H(x, z) - y);
    }
    return clamp01(above / 12);
  }

  // Play a sound, in 3D if pos is given. opts: gain, rate, pitchVar, ref,
  // rolloff, absorb, cutoff, echo, reverb, delay, instant (no travel time),
  // priority, bus, occlude (default true).
  play(name, pos = null, opts = {}) {
    if (!this.ctx || !this.enabled) return null;
    const buf = this.pick(name);
    if (!buf) return null;
    const ctx = this.ctx;
    const [busName, prio0] = ROUTING[name] || ['effects', 4];
    const bus = this.buses[opts.bus || busName];
    const prio = opts.priority ?? prio0;
    let delay = opts.delay || 0;
    let d = 0;
    if (pos && this.listenerPos) {
      d = Math.hypot(pos.x - this.listenerPos.x, pos.y - this.listenerPos.y, pos.z - this.listenerPos.z);
      if (d > (opts.maxDist || 4000)) return null;
      if (!opts.instant) delay += d / SPEED_OF_SOUND;
    }
    if (!this.admit(prio)) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const rate = (opts.rate || 1) * (1 + (Math.random() - 0.5) * (opts.pitchVar ?? 0.06));
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = opts.gain ?? 1;
    let node = src;
    if (pos && this.listenerPos) {
      const occ = opts.occlude === false ? 0 : this.occlusion(pos, d);
      // air absorbs the highs over distance, hills muffle them further
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = Math.max(450, (opts.cutoff || 20000 * Math.exp(-d / (opts.absorb || 260))) * (1 - 0.8 * occ));
      g.gain.value *= 1 - 0.6 * occ;
      node.connect(f);
      node = f;
      const pan = ctx.createPanner();
      pan.panningModel = 'HRTF';
      pan.distanceModel = 'inverse';
      pan.refDistance = opts.ref || 4;
      pan.rolloffFactor = opts.rolloff ?? 1;
      pan.maxDistance = 20000;
      if (pan.positionX) {
        pan.positionX.value = pos.x;
        pan.positionY.value = pos.y;
        pan.positionZ.value = pos.z;
      } else pan.setPosition(pos.x, pos.y, pos.z);
      node.connect(pan);
      node = pan;
    }
    node.connect(g);
    g.connect(bus);
    if (opts.reverb) {
      const rg = ctx.createGain();
      rg.gain.value = opts.reverb;
      g.connect(rg).connect(this.reverbIn);
    }
    if (opts.echo) {
      const eg = ctx.createGain();
      eg.gain.value = opts.echo;
      g.connect(eg).connect(this.echoIn);
    }
    const t = ctx.currentTime + delay;
    src.start(t);
    this.voices.push({ src, prio, start: t, end: t + buf.duration / rate });
    return src;
  }

  // A looping 3D sound you can move and fade (the dog's bell, its panting).
  // Returns null until the sample has loaded; call again later.
  startLoop(name, opts = {}) {
    if (!this.ctx) return null;
    const list = this.samples[name];
    if (!list || !list.length) return null;
    const ctx = this.ctx;
    const buf = list[0];
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0;
    const pan = ctx.createPanner();
    pan.panningModel = 'HRTF';
    pan.distanceModel = 'inverse';
    pan.refDistance = opts.ref || 4;
    pan.rolloffFactor = 1;
    src.connect(pan).connect(g).connect(this.buses[opts.bus || 'effects']);
    src.start(0, Math.random() * buf.duration);
    return {
      set: (pos, gain) => {
        const t = ctx.currentTime;
        if (pan.positionX) {
          pan.positionX.setTargetAtTime(pos.x, t, 0.05);
          pan.positionY.setTargetAtTime(pos.y + 0.6, t, 0.05);
          pan.positionZ.setTargetAtTime(pos.z, t, 0.05);
        } else pan.setPosition(pos.x, pos.y + 0.6, pos.z);
        g.gain.setTargetAtTime(gain, t, 0.08);
      },
      stop: () => {
        try {
          src.stop();
        } catch {}
        g.disconnect();
      },
    };
  }

  // ------------------------------------------------ gunshots & echoes

  gunshot(pos, local) {
    this.play('shot', local ? null : pos, {
      gain: local ? 1.0 : 1.5,
      ref: 25,
      absorb: 700,
      reverb: local ? 0.3 : 0.45,
      pitchVar: 0.08,
    });
    if (local) this.duck(0.3, 1.8);
    this.echoes(pos, local ? 1 : 0.8);
  }

  // Echoes come back from the actual slopes around the shot, from their
  // direction, after the time the sound needs to get there and back.
  echoes(origin, strength = 1) {
    const refl = this.reflectors(origin);
    let used = 0;
    for (const r of refl) {
      const back = this.listenerPos ? Math.hypot(r.x - this.listenerPos.x, r.y - this.listenerPos.y, r.z - this.listenerPos.z) : r.d;
      const path = r.d + back;
      // far ridges are big surfaces: they lose less than the spreading suggests
      const g = Math.min(0.4, strength * r.strength * 0.4 * ((r.far ? 420 : 160) / (path + 60)));
      if (g < 0.015) continue;
      used++;
      this.play('shotEcho', r, {
        gain: g,
        rolloff: 0,
        delay: r.d / SPEED_OF_SOUND,
        cutoff: Math.max(700, 9000 * Math.exp(-path / 450)),
        reverb: 0.6,
        occlude: false,
        pitchVar: 0.1,
        priority: 7,
      });
    }
    // open ground: only faint late echoes off the far ranges
    if (used < 2) this.play('shotEcho', null, { gain: 0, echo: 0.7 * strength * (used ? 0.5 : 1), priority: 6 });
  }

  reflectors(o) {
    const H = this.heightFn;
    if (!H) return [];
    const key = `${Math.round(o.x / 8)},${Math.round(o.z / 8)}`;
    if (this.reflCache.key === key) return this.reflCache.list;
    const out = [];
    const N = 16;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + 0.13;
      const cx = Math.cos(a);
      const cz = Math.sin(a);
      let prev = H(o.x + cx * 35, o.z + cz * 35);
      let maxElev = -Infinity;
      let near = false;
      for (let d = 60; d <= 1400; d += d < 300 ? 25 : 50) {
        const h = H(o.x + cx * d, o.z + cz * d);
        const rise = h - prev;
        prev = h;
        const elev = (h - o.y) / d;
        const visible = elev > maxElev - 0.004;
        maxElev = Math.max(maxElev, elev);
        // a face rising towards us that the shot can reach: the first one
        // close by (terraces, a bank), then a far ridge for the long echo
        if (visible && h > o.y - 25 && rise > (d < 300 ? 5 : 9)) {
          const far = d >= 300;
          if (far || !near) out.push({ x: o.x + cx * d, y: h - rise * 0.5, z: o.z + cz * d, d, far, strength: clamp01(rise / (far ? 30 : 18)) * 0.75 + 0.25 });
          if (far) break;
          near = true;
        }
      }
    }
    const rank = (p) => p.strength / (p.d + 120);
    const nearList = out.filter((p) => !p.far).sort((p, q) => rank(q) - rank(p)).slice(0, 4);
    const farList = out.filter((p) => p.far).sort((p, q) => q.strength - p.strength).slice(0, 4);
    const list = nearList.concat(farList);
    this.reflCache = { key, list };
    return list;
  }

  // Other hunters far across the valley.
  distantShot() {
    if (!this.listenerPos) return;
    const a = Math.random() * Math.PI * 2;
    const d = 450 + Math.random() * 1500;
    const L = this.listenerPos;
    const x = L.x + Math.cos(a) * d;
    const z = L.z + Math.sin(a) * d;
    const y = (this.heightFn ? this.heightFn(x, z) : L.y) + 2;
    const p = { x, y, z };
    const o = { gain: 3.2, ref: 30, absorb: 380, reverb: 0.8, rolloff: 0.9 };
    this.play('shotFar', p, o);
    if (Math.random() < 0.4) this.play('shotFar', p, { ...o, gain: 3, delay: 0.5 + Math.random() * 0.7 });
  }

  // ------------------------------------------------ ambience

  startSynthWind() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.buffers.wind;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.14;
    src.connect(f).connect(this.windGain).connect(this.buses.ambience);
    src.start();
  }

  startBed(name) {
    const buf = this.bedBuffers[name];
    if (!buf || this.amb.beds[name]) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = this.ctx.createGain();
    g.gain.value = 0;
    src.connect(g).connect(this.buses.ambience);
    src.start(0, Math.random() * buf.duration);
    this.amb.beds[name] = g;
  }

  // Start the soundscape for a hunt: { month, kind, hasSea, christianVillage }
  setScene(scene) {
    this.amb = { scene, beds: {}, timers: { rooster: 20, dog: 30, sheep: 40, song: 2 }, lastHour: -1 };
    for (const b of BEDS) this.startBed(b);
  }

  // env: { hour, trees (0..1 around the listener), wind (0..1) }
  updateAmbience(dt, env) {
    const A = this.amb;
    if (!this.ctx || !A || !this.listenerPos) return;
    const { hour, trees = 0, wind = 0.5 } = env;
    const s = A.scene;
    const autumn = s.month === 'September' || s.month === 'October' || s.month === 'November';
    const winter = s.month === 'December' || s.month === 'January';
    const target = {
      dawn: bell(hour, 7, 1.4) * (winter ? 0.35 : 1),
      cicadas: (s.month === 'September' ? 1 : s.month === 'October' ? 0.35 : 0) * ramp(hour, 9.5, 12) * (1 - ramp(hour, 16.5, 18.5)),
      crickets: Math.max(ramp(hour, 17, 18.5), 1 - ramp(hour, 5.2, 6.4)) * (autumn ? 1 : 0.15),
      windTrees: trees * (0.25 + wind * 0.75),
      windOpen: (1 - trees) * wind * (s.kind === 'highland' ? 1 : 0.55),
      winterWood: winter && trees > 0.25 ? 0.8 : 0,
    };
    const t = this.ctx.currentTime;
    let windCovered = 0;
    for (const b of BEDS) {
      const g = A.beds[b];
      if (!g) continue;
      if (b === 'windTrees' || b === 'windOpen') windCovered++;
      g.gain.setTargetAtTime(target[b] * BED_GAIN[b], t, 1.5);
    }
    // the synthesised wind fills in until the recorded wind has loaded
    if (this.windGain) this.windGain.gain.setTargetAtTime(windCovered ? 0.03 : 0.08 + wind * 0.1, t, 1.5);

    // far-off life around the hunting ground
    const T = A.timers;
    const far = (min, max) => {
      const a = Math.random() * Math.PI * 2;
      const d = min + Math.random() * (max - min);
      const x = this.listenerPos.x + Math.cos(a) * d;
      const z = this.listenerPos.z + Math.sin(a) * d;
      return { x, y: (this.heightFn ? this.heightFn(x, z) : this.listenerPos.y) + 3, z };
    };
    for (const k of Object.keys(T)) T[k] -= dt;
    if (T.rooster <= 0) {
      T.rooster = 50 + Math.random() * 120;
      if (hour > 5.3 && hour < 9.5 && s.village) this.play('farRooster', far(450, 1000), { gain: 3, ref: 30, absorb: 500 });
    }
    if (T.dog <= 0) {
      T.dog = 70 + Math.random() * 160;
      if (s.village) this.play('farDog', far(350, 1000), { gain: 2.5, ref: 30, absorb: 450 });
    }
    if (T.sheep <= 0) {
      T.sheep = 120 + Math.random() * 200;
      if (hour > 7.5 && hour < 17 && !winter) this.play('farSheep', far(250, 650), { gain: 2.2, ref: 30, absorb: 450 });
    }
    // a song from the trees now and then, most at first light
    if (T.song <= 0) {
      const rate = 0.08 + bell(hour, 7, 1.6) * 0.5 + bell(hour, 16.5, 1) * 0.2;
      T.song = (2 + Math.random() * 6) / rate;
      if (trees > 0.05 || Math.random() < 0.3) {
        const name = Math.random() < 0.55 ? 'songThrush' : 'songChaffinch';
        if (this.samples[name]) this.play(name, far(40, 160), { gain: 0.9, ref: 10, absorb: 300 });
      }
    }
    // the village church bell on some hours
    const h = Math.floor(hour);
    if (A.lastHour >= 0 && h !== A.lastHour && s.church && [7, 8, 12, 17].includes(h) && Math.random() < 0.8) {
      this.play('farBell', far(700, 1200), { gain: 3, ref: 40, absorb: 600 });
    }
    A.lastHour = h;
  }

  setWind(v) {
    this.wind = v;
  }
}

export const audio = new AudioSystem();
