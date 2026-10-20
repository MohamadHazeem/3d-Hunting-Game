import { Random } from '../core/rng.js';

// All sound is synthesised at startup (no audio files): shotgun blasts with
// mountain echoes, bird calls for every species, wing whirr on the flush,
// footsteps, the hunter's whistle, and the wind.

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

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.buffers = {};
    this.enabled = true;
  }

  async init() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx({ sampleRate: 48000 });
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(ctx.destination);

    // valley reverb: long, dark, slightly delayed impulse
    const ir = makeBuffer(
      ctx,
      3.2,
      (t, st, c) => {
        const n = noise();
        const pre = t < 0.04 ? 0 : 1;
        return lp(st, 'a', n, 0.18 - Math.min(0.14, t * 0.04)) * Math.exp(-t * 1.6) * pre * 1.6;
      },
      2
    );
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = 1;
    this.reverbIn.connect(this.reverb).connect(this.master);

    // discrete echoes from the far slopes
    this.echoIn = ctx.createGain();
    const echoLP = ctx.createBiquadFilter();
    echoLP.type = 'lowpass';
    echoLP.frequency.value = 1400;
    this.echoIn.connect(echoLP);
    for (const [d, g] of [[0.55, 0.3], [1.25, 0.2], [2.1, 0.12]]) {
      const delay = ctx.createDelay(3);
      delay.delayTime.value = d;
      const gn = ctx.createGain();
      gn.gain.value = g;
      echoLP.connect(delay).connect(gn);
      gn.connect(this.master);
      gn.connect(this.reverbIn);
    }

    for (const k of Object.keys(SYNTH)) this.buffers[k] = SYNTH[k](ctx);
    this.startWind();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  startWind() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.buffers.wind;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 900;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.14;
    src.connect(f).connect(this.windGain).connect(this.master);
    src.start();
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

  // Play a synthesised sound in 3D. opts: gain, rate, ref, echo, reverb, pos(null = 2D)
  play(name, pos = null, opts = {}) {
    if (!this.ctx || !this.enabled || !this.buffers[name]) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.buffers[name];
    src.playbackRate.value = opts.rate || 1;
    const g = ctx.createGain();
    g.gain.value = opts.gain ?? 1;
    let node = src;
    if (pos && this.listenerPos) {
      const d = Math.hypot(pos.x - this.listenerPos.x, pos.y - this.listenerPos.y, pos.z - this.listenerPos.z);
      // air absorbs the highs over distance
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = Math.max(700, 20000 * Math.exp(-d / (opts.absorb || 260)));
      node.connect(f);
      node = f;
      const pan = ctx.createPanner();
      pan.panningModel = 'HRTF';
      pan.distanceModel = 'inverse';
      pan.refDistance = opts.ref || 4;
      pan.rolloffFactor = opts.rolloff || 1;
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
    g.connect(this.master);
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
    src.start(ctx.currentTime + (opts.delay || 0));
  }

  gunshot(pos, local) {
    this.play('shot', local ? null : pos, {
      gain: local ? 1.0 : 1.4,
      ref: 25,
      absorb: 600,
      reverb: 0.55,
      echo: local ? 0.9 : 0.7,
      rate: 0.96 + Math.random() * 0.08,
    });
  }

  distantShot() {
    if (!this.listenerPos) return;
    const a = Math.random() * Math.PI * 2;
    const d = 400 + Math.random() * 1600;
    const p = { x: this.listenerPos.x + Math.cos(a) * d, y: this.listenerPos.y + 30, z: this.listenerPos.z + Math.sin(a) * d };
    const pair = Math.random() < 0.45;
    this.play('shot', p, { gain: 2.5, ref: 25, absorb: 350, reverb: 0.9, echo: 0.8, delay: d / 343 * 0.1 });
    if (pair) this.play('shot', p, { gain: 2.3, ref: 25, absorb: 350, reverb: 0.9, echo: 0.8, delay: 0.5 + Math.random() * 0.6 });
  }

  setWind(v) {
    if (this.windGain) this.windGain.gain.setTargetAtTime(0.08 + v * 0.12, this.ctx.currentTime, 0.5);
  }
}

export const audio = new AudioSystem();
