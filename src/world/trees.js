import * as THREE from 'three';
import { Random, smoothstep } from '../core/rng.js';

// Procedural trees: a branching wooden skeleton dressed in cards cut from
// photographed foliage (see foliageTextures.js). Every species grows from the
// same few rules with its own shape: old olives with split, twisted trunks,
// Palestine oak, umbrella stone pine, Greek juniper, Lebanon cedar in flat
// tiers, Cilician fir in whorls, and low garrigue shrubs.
//
// buildTree() returns the skeleton (tubes) and the foliage cards; treeLods()
// turns that into near / mid / far geometry. Every vertex carries
// aux = (ambient occlusion, bend, phase, leaf) for the wind and the shading.

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function perp(d, out) {
  // any unit vector at right angles to d
  out.set(1, 0, 0);
  if (Math.abs(d.x) > 0.9) out.set(0, 0, 1);
  return out.cross(d).normalize();
}

// rotate v about unit axis k by angle a (Rodrigues)
function rotAxis(v, k, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const d = k.dot(v) * (1 - c);
  return new THREE.Vector3(
    v.x * c + (k.y * v.z - k.z * v.y) * s + k.x * d,
    v.y * c + (k.z * v.x - k.x * v.z) * s + k.y * d,
    v.z * c + (k.x * v.y - k.y * v.x) * s + k.z * d
  );
}

// A direction `angle` away from `dir`, turned `azim` around it.
function spread(dir, angle, azim) {
  const p = perp(dir, new THREE.Vector3());
  return rotAxis(rotAxis(dir.clone(), p, angle), dir, azim).normalize();
}

class Tree {
  constructor(seed) {
    this.r = new Random(seed);
    this.tubes = []; // {pts, rad, bend, level, phase}
    this.cards = []; // {c, d, s, w, h, cell, bend, phase, flat}
    this.size = 6; // rough height, scales the bend
  }

  // Grow one branch as a curved tube; returns its points (with radius and
  // bend) so children can sprout along it.
  limb(p0, dir, len, r0, r1, level, o = {}) {
    const r = this.r;
    const seg = o.seg ?? Math.max(0.25, len / (level === 0 ? 6 : level === 1 ? 5 : 4));
    const n = Math.max(2, Math.ceil(len / seg));
    const pts = [p0.clone()];
    const rad = [r0];
    const bend = [o.bend0 ?? 0];
    const d = dir.clone().normalize();
    const p = p0.clone();
    const wob = o.wobble ?? 0.25;
    const up = o.up ?? 0; // + turns towards the sky, - droops
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      d.x += r.float(-wob, wob);
      d.z += r.float(-wob, wob);
      d.y += r.float(-wob, wob) * 0.5 + up / n;
      d.normalize();
      p.addScaledVector(d, len / n);
      pts.push(p.clone());
      // a little swelling and pinching along the way (gnarled wood)
      const g = o.gnarl ? 1 + o.gnarl * Math.sin(t * 9 + r.float(0, 6)) * 0.5 * (1 - t) : 1;
      rad.push(Math.max(0.006, (r0 + (r1 - r0) * Math.pow(t, o.taperPow ?? 1)) * g));
      bend.push(bend[0] + (len * t) / this.size);
    }
    const tube = { pts, rad, bend, level, phase: o.phase ?? r.next() };
    if (!o.hidden) this.tubes.push(tube);
    return tube;
  }

  // point, direction, radius and bend a fraction t along a tube
  at(tube, t) {
    const n = tube.pts.length - 1;
    const f = Math.min(n - 1e-4, t * n);
    const i = Math.floor(f);
    const k = f - i;
    const p = tube.pts[i].clone().lerp(tube.pts[i + 1], k);
    const d = tube.pts[i + 1].clone().sub(tube.pts[i]).normalize();
    return { p, d, r: tube.rad[i] + (tube.rad[i + 1] - tube.rad[i]) * k, bend: tube.bend[i] + (tube.bend[i + 1] - tube.bend[i]) * k };
  }

  // A foliage card standing on point c, growing along d; flat > 0 turns its
  // face towards the sky (conifer plates).
  card(c, d, size, bend, phase, flat = 0, aspect = 1) {
    const r = this.r;
    const dir = d.clone().normalize();
    let side = perp(dir, new THREE.Vector3());
    side = rotAxis(side, dir, r.float(0, Math.PI * 2));
    if (flat > 0) {
      // side mostly horizontal so the face looks up
      const hs = new THREE.Vector3().crossVectors(dir, UP);
      if (hs.lengthSq() > 1e-4) side.lerp(hs.normalize(), flat).normalize();
    }
    this.cards.push({ c: c.clone(), d: dir, s: side, w: size * aspect, h: size, cell: r.int(0, 3), bend, phase, flat });
  }

  // Leaf cards along the outer part of a twig.
  dress(tube, n, size, o = {}) {
    const r = this.r;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.75 : 0.35 + (0.65 * i) / (n - 1);
      const a = this.at(tube, Math.min(0.98, t));
      let d = a.d.clone();
      if (o.out) {
        // lean the card away from the crown centre
        _v.copy(a.p).sub(o.out);
        _v.y *= 0.5;
        d.lerp(_v.normalize(), 0.45);
      }
      d.y += o.lift ?? 0.25;
      d = spread(d.normalize(), r.float(0, o.jitter ?? 0.5), r.float(0, Math.PI * 2));
      this.card(a.p, d, size * r.float(0.8, 1.15), a.bend, tube.phase, o.flat || 0);
    }
  }
}

// ---------------------------------------------------------------- species

function olive(seed) {
  // Old grove olives: a squat, swollen, often split trunk, a few twisting
  // scaffold limbs, an open, uneven crown of grey-green.
  const T = new Tree(seed);
  const r = T.r;
  T.size = 5;
  const stems = r.int(2, 3);
  const base = new THREE.Vector3(0, -0.25, 0);
  const tips = [];
  for (let s = 0; s < stems; s++) {
    const a = (s / stems) * Math.PI * 2 + r.float(-0.5, 0.5);
    const d = spread(UP, r.float(0.15, 0.4), a);
    const p0 = base.clone().add(new THREE.Vector3(Math.cos(a) * 0.12, 0, Math.sin(a) * 0.12));
    const st = T.limb(p0, d, r.float(1.1, 1.7), r.float(0.2, 0.28), r.float(0.13, 0.18), 0, { gnarl: 0.5, wobble: 0.22, seg: 0.25 });
    for (let k = 0; k < r.int(2, 3); k++) {
      const end = T.at(st, 1);
      const ld = spread(end.d.clone().lerp(UP, 0.3).normalize(), r.float(0.45, 0.9), r.float(0, 6.28));
      const limb = T.limb(end.p, ld, r.float(1.4, 2.2), end.r * 0.75, 0.05, 1, { wobble: 0.25, up: -0.15, bend0: end.bend, gnarl: 0.3 });
      for (let j = 0; j < r.int(3, 4); j++) {
        const at = T.at(limb, r.float(0.4, 1));
        const bd = spread(at.d, r.float(0.5, 1.0), r.float(0, 6.28));
        const br = T.limb(at.p, bd, r.float(0.8, 1.4), Math.max(0.03, at.r * 0.7), 0.015, 2, { wobble: 0.3, up: -0.35, bend0: at.bend, phase: limb.phase });
        tips.push(br);
      }
    }
  }
  const crownC = new THREE.Vector3(0, 2.6, 0);
  for (const br of tips) {
    for (let j = 0; j < r.int(4, 6); j++) {
      const at = T.at(br, r.float(0.25, 1));
      const td = spread(at.d, r.float(0.4, 1.0), r.float(0, 6.28));
      const tw = T.limb(at.p, td, r.float(0.35, 0.7), 0.012, 0.005, 3, { wobble: 0.35, up: -0.3, bend0: at.bend, phase: br.phase, hidden: true });
      T.dress(tw, 3, r.float(0.85, 1.05), { out: crownC, lift: 0.1, jitter: 0.7 });
    }
  }
  return T;
}

function oak(seed) {
  // Palestine oak (Quercus calliprinos): one to three leaning stems and a
  // dense, rounded crown of small dark leaves.
  const T = new Tree(seed);
  const r = T.r;
  T.size = 7;
  const stems = r.int(1, 3);
  const twigs = [];
  for (let s = 0; s < stems; s++) {
    const a = r.float(0, 6.28);
    const d = spread(UP, stems === 1 ? r.float(0, 0.15) : r.float(0.15, 0.35), a);
    const st = T.limb(new THREE.Vector3(Math.cos(a) * 0.1, -0.25, Math.sin(a) * 0.1), d, r.float(1.6, 2.6), r.float(0.16, 0.24) / Math.sqrt(stems * 0.7), 0.1, 0, { wobble: 0.12, gnarl: 0.25 });
    const nl = r.int(3, 5);
    for (let k = 0; k < nl; k++) {
      const at = T.at(st, k === 0 ? 1 : r.float(0.6, 1));
      const ld = spread(at.d, r.float(0.35, 0.8), (k / nl) * 6.28 + r.float(-0.5, 0.5));
      const limb = T.limb(at.p, ld, r.float(1.8, 2.8), at.r * 0.75, 0.04, 1, { wobble: 0.2, up: 0.1, bend0: at.bend });
      for (let j = 0; j < r.int(3, 5); j++) {
        const bt = T.at(limb, r.float(0.3, 1));
        const br = T.limb(bt.p, spread(bt.d, r.float(0.5, 1.0), r.float(0, 6.28)), r.float(0.9, 1.5), Math.max(0.025, bt.r * 0.7), 0.012, 2, { wobble: 0.3, up: 0.05, bend0: bt.bend, phase: limb.phase });
        twigs.push(br);
      }
    }
  }
  const crownC = new THREE.Vector3(0, 3.6, 0);
  for (const br of twigs) {
    for (let j = 0; j < 4; j++) {
      const at = T.at(br, r.float(0.3, 1));
      const tw = T.limb(at.p, spread(at.d, r.float(0.4, 0.9), r.float(0, 6.28)), r.float(0.4, 0.7), 0.01, 0.004, 3, { bend0: at.bend, phase: br.phase, hidden: true });
      T.dress(tw, 3, r.float(1.0, 1.25), { out: crownC, lift: 0.3, jitter: 0.6 });
    }
  }
  return T;
}

function pine(seed) {
  // Stone pine (Pinus pinea): a tall, leaning, bare trunk that forks into a
  // candelabra of rising limbs carrying a flat umbrella of needle tufts.
  const T = new Tree(seed);
  const r = T.r;
  const H = r.float(8, 11.5);
  T.size = H;
  const lean = spread(UP, r.float(0.04, 0.16), r.float(0, 6.28));
  const trunk = T.limb(new THREE.Vector3(0, -0.3, 0), lean, H * 0.6, r.float(0.26, 0.34), 0.19, 0, { wobble: 0.04, seg: 1.2 });
  const top = T.at(trunk, 1);
  const tips = [];
  const nl = r.int(3, 5);
  for (let k = 0; k < nl; k++) {
    const ld = spread(top.d, r.float(0.45, 0.8), (k / nl) * 6.28 + r.float(-0.4, 0.4));
    const limb = T.limb(top.p, ld, r.float(2.4, 3.4), top.r * 0.75, 0.1, 1, { wobble: 0.1, up: 0.1, bend0: top.bend });
    for (let j = 0; j < r.int(3, 4); j++) {
      const bt = T.at(limb, r.float(0.45, 1));
      const br = T.limb(bt.p, spread(bt.d, r.float(0.8, 1.25), r.float(0, 6.28)), r.float(2.2, 3.2), Math.max(0.04, bt.r * 0.7), 0.035, 2, { wobble: 0.15, up: 0.35, bend0: bt.bend, phase: limb.phase });
      for (let m = 0; m < r.int(2, 3); m++) {
        const st = T.at(br, r.float(0.45, 1));
        tips.push(T.limb(st.p, spread(st.d, r.float(0.4, 0.9), r.float(0, 6.28)), r.float(0.8, 1.4), 0.03, 0.012, 3, { up: 0.4, bend0: st.bend, phase: br.phase }));
      }
    }
  }
  for (const sb of tips) {
    for (let j = 0; j < r.int(5, 7); j++) {
      const at = T.at(sb, r.float(0.3, 1));
      const d = at.d.clone().lerp(UP, 0.65).normalize();
      T.card(at.p, spread(d, r.float(0, 0.65), r.float(0, 6.28)), r.float(1.3, 1.7), at.bend, sb.phase, 0.4);
    }
  }
  return T;
}

function juniper(seed) {
  // Greek juniper (Juniperus excelsa): a gnarled trunk, often more than one
  // leader, and a dense, ragged cone of fine grey-green sprays.
  const T = new Tree(seed);
  const r = T.r;
  const H = r.float(4.5, 7.5);
  T.size = H;
  const leaders = r.int(1, 2);
  for (let l = 0; l < leaders; l++) {
    const d = spread(UP, r.float(0.05, 0.25), r.float(0, 6.28));
    const lead = T.limb(new THREE.Vector3(r.float(-0.2, 0.2), -0.25, r.float(-0.2, 0.2)), d, H * r.float(0.85, 1), r.float(0.18, 0.28) / Math.sqrt(leaders), 0.03, 0, { wobble: 0.12, gnarl: 0.45, seg: 0.5 });
    const n = r.int(20, 28);
    for (let k = 0; k < n; k++) {
      const t = 0.15 + (0.83 * k) / n + r.float(-0.02, 0.02);
      const at = T.at(lead, t);
      const len = Math.pow(1.05 - t, 0.8) * r.float(1.8, 2.8) + 0.4;
      const bd = spread(at.d, r.float(1.0, 1.4), k * 2.4 + r.float(-0.4, 0.4));
      const br = T.limb(at.p, bd, len, Math.max(0.02, at.r * 0.55), 0.01, 1, { wobble: 0.3, up: 0.3, bend0: at.bend });
      T.dress(br, Math.max(2, Math.round(len * 2.6)), r.float(0.95, 1.2), { out: at.p, lift: 0.35, jitter: 0.9 });
      for (let j = 0; j < r.int(1, 3); j++) {
        const st = T.at(br, r.float(0.35, 0.9));
        const sb = T.limb(st.p, spread(st.d, r.float(0.5, 1.0), r.float(0, 6.28)), len * r.float(0.35, 0.55), 0.012, 0.005, 2, { wobble: 0.3, up: 0.3, bend0: st.bend, phase: br.phase });
        T.dress(sb, 2, r.float(0.9, 1.1), { out: at.p, lift: 0.3, jitter: 0.9 });
      }
    }
    // crown top
    const tip = T.at(lead, 1);
    for (let k = 0; k < 5; k++) T.card(tip.p.clone().add(new THREE.Vector3(0, -0.45 * k, 0)), spread(UP, r.float(0, 0.8), r.float(0, 6.28)), r.float(0.8, 1.0), tip.bend, r.next());
  }
  return T;
}

function cedar(seed) {
  // Lebanon cedar (Cedrus libani): a massive trunk and flat, layered tiers of
  // dense blue-green foliage.
  const T = new Tree(seed);
  const r = T.r;
  const H = r.float(13, 18);
  T.size = H;
  const trunk = T.limb(new THREE.Vector3(0, -0.4, 0), spread(UP, r.float(0, 0.06), r.float(0, 6.28)), H * 0.95, r.float(0.5, 0.7), 0.06, 0, { wobble: 0.03, seg: 1.5, gnarl: 0.15 });
  const tiers = r.int(4, 6);
  for (let t = 0; t < tiers; t++) {
    const k = t / (tiers - 1);
    const at = T.at(trunk, 0.3 + 0.62 * k);
    // broad low tiers, the top ones short: the old trees go flat-topped
    const R = (1 - k * 0.6) * r.float(5, 6.5);
    const arms = r.int(8, 11);
    for (let a = 0; a < arms; a++) {
      const az = (a / arms) * 6.28 + r.float(-0.3, 0.3) + t * 1.3;
      const d = new THREE.Vector3(Math.cos(az), r.float(0.15, 0.4), Math.sin(az)).normalize();
      const arm = T.limb(at.p, d, R * r.float(0.8, 1.05), at.r * 0.4 * (1 - k * 0.5), 0.03, 1, { wobble: 0.08, up: -0.25, bend0: at.bend });
      // a plate of sprays along the outer part of each arm and its shoots
      const plate = (tube, n, sz) => {
        for (let j = 0; j < n; j++) {
          const s = T.at(tube, r.float(0.25, 1));
          const sd = new THREE.Vector3(s.d.x + r.float(-0.9, 0.9), r.float(-0.05, 0.2), s.d.z + r.float(-0.9, 0.9)).normalize();
          // two layers make the plate thick enough to read from the side
          const p = s.p.clone();
          p.y += r.float(-0.25, 0.35);
          T.card(p, sd, sz * r.float(0.85, 1.15), s.bend, arm.phase, 0.7, 1.3);
        }
      };
      plate(arm, Math.round(3 + R * 1.6), 1.7);
      for (let j = 0; j < Math.round(R * 0.6); j++) {
        const s = T.at(arm, r.float(0.3, 0.95));
        const side = new THREE.Vector3(-s.d.z, 0, s.d.x).multiplyScalar(r.chance(0.5) ? 1 : -1);
        const sh = T.limb(s.p, side.lerp(s.d, 0.4).normalize(), R * r.float(0.25, 0.4), 0.025, 0.008, 2, { wobble: 0.1, up: -0.1, bend0: s.bend, phase: arm.phase });
        plate(sh, 2, 1.5);
      }
    }
  }
  return T;
}

function fir(seed) {
  // Cilician fir (Abies cilicica): a straight trunk with whorls of level,
  // slightly drooping branches, a narrow dark cone.
  const T = new Tree(seed);
  const r = T.r;
  const H = r.float(10, 15);
  T.size = H;
  const trunk = T.limb(new THREE.Vector3(0, -0.3, 0), UP, H, r.float(0.26, 0.36), 0.03, 0, { wobble: 0.015, seg: 1.0 });
  const step = r.float(0.5, 0.62);
  for (let y = 1.4; y < H - 0.4; y += step * r.float(0.85, 1.15)) {
    const t = y / H;
    const at = T.at(trunk, t);
    const len = Math.pow(1 - t, 0.85) * r.float(3.0, 3.6) + 0.3;
    const n = r.int(4, 6);
    for (let k = 0; k < n; k++) {
      const az = (k / n) * 6.28 + y * 1.7 + r.float(-0.3, 0.3);
      const d = new THREE.Vector3(Math.cos(az), r.float(-0.05, 0.15), Math.sin(az)).normalize();
      const br = T.limb(at.p, d, len, Math.max(0.02, at.r * 0.32), 0.008, 1, { wobble: 0.06, up: -0.3, bend0: at.bend });
      const cards = Math.max(1, Math.round(len / 0.5));
      for (let j = 0; j < cards; j++) {
        const s = T.at(br, 0.2 + (0.8 * (j + 0.5)) / cards);
        for (const side of [-1, 1]) {
          // sprays fan out to both sides of the branch, tilted up a little
          const sd = s.d.clone().add(new THREE.Vector3(-s.d.z * side * 0.6 + r.float(-0.2, 0.2), r.float(0.05, 0.3), s.d.x * side * 0.6 + r.float(-0.2, 0.2))).normalize();
          T.card(s.p.clone().addScaledVector(s.d, -0.3), sd, r.float(1.15, 1.4) * (0.75 + 0.25 * (1 - t)), s.bend, br.phase, 0.15);
        }
      }
    }
  }
  const tip = T.at(trunk, 1);
  for (let k = 0; k < 3; k++) T.card(tip.p.clone().add(new THREE.Vector3(0, -0.6 - 0.4 * k, 0)), spread(UP, r.float(0, 0.4), r.float(0, 6.28)), 1.0, tip.bend, r.next());
  return T;
}

function shrub(seed) {
  // Low garrigue: a few stems from the ground and a dome of cards.
  const T = new Tree(seed);
  const r = T.r;
  T.size = 1.2;
  const R = r.float(0.5, 0.95);
  const n = r.int(4, 6);
  const c = new THREE.Vector3(0, R * 0.3, 0);
  for (let k = 0; k < n; k++) {
    const d = spread(UP, r.float(0.3, 0.9), (k / n) * 6.28 + r.float(-0.4, 0.4));
    const st = T.limb(new THREE.Vector3(r.float(-0.1, 0.1), -0.05, r.float(-0.1, 0.1)), d, R * r.float(0.7, 1.1), 0.02, 0.006, 2, { wobble: 0.3, hidden: true });
    T.dress(st, r.int(3, 4), R * r.float(0.75, 1.0), { out: c, lift: 0.2, jitter: 0.8 });
  }
  return T;
}

export const SPECIES = { olive, oak, pine, juniper, cedar, fir, shrub };

// ---------------------------------------------------------------- geometry

class Buf {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.aux = [];
    this.idx = [];
  }
  get n() {
    return this.pos.length / 3;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aux', new THREE.Float32BufferAttribute(this.aux, 4));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// Bark tube along a polyline, parallel-transported rings. `every` skips
// rings for cheaper levels of detail.
function tubeGeo(B, tube, radial, every, crown) {
  const { pts, rad, bend } = tube;
  const idx = [];
  for (let i = 0; i < pts.length; i += every) idx.push(i);
  if (idx[idx.length - 1] !== pts.length - 1) idx.push(pts.length - 1);
  let nrm = null;
  let vacc = 0;
  const start = B.n;
  const circ = 2 * Math.PI * rad[0];
  const uRep = Math.max(1, Math.round(circ / 0.7));
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k];
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const t = _a.copy(b).sub(a).normalize();
    if (!nrm) nrm = perp(t, new THREE.Vector3());
    else {
      // transport the frame: remove the tangent part and renormalise
      nrm.addScaledVector(t, -nrm.dot(t)).normalize();
    }
    const bin = _b.crossVectors(t, nrm).normalize();
    if (k > 0) vacc += pts[i].distanceTo(pts[idx[k - 1]]);
    // darker deep inside the crown
    const ao = crown ? 0.72 + 0.28 * smoothstep(0, crown.r, Math.hypot(pts[i].x - crown.c.x, pts[i].z - crown.c.z)) : 1;
    for (let s = 0; s <= radial; s++) {
      const ang = (s / radial) * Math.PI * 2;
      const cx = Math.cos(ang);
      const sx = Math.sin(ang);
      const nx = nrm.x * cx + bin.x * sx;
      const ny = nrm.y * cx + bin.y * sx;
      const nz = nrm.z * cx + bin.z * sx;
      B.pos.push(pts[i].x + nx * rad[i], pts[i].y + ny * rad[i], pts[i].z + nz * rad[i]);
      B.nor.push(nx, ny, nz);
      B.uv.push((s / radial) * uRep, vacc / 0.9);
      B.aux.push(ao, bend[i], tube.phase, 0);
    }
  }
  const ring = radial + 1;
  for (let k = 0; k < idx.length - 1; k++) {
    for (let s = 0; s < radial; s++) {
      const a = start + k * ring + s;
      const b = a + ring;
      B.idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
}

// Foliage card. Normals bend away from the crown centre (soft, volumetric
// light on the whole crown) with a share of the card's own facing.
function cardGeo(B, cd, scale, crown, own) {
  const w = cd.w * scale;
  const h = cd.h * scale;
  // scale about the card centre so bigger far cards stay inside the crown
  const ctr = cd.c.clone().addScaledVector(cd.d, (cd.h * 0.5));
  const base = ctr.clone().addScaledVector(cd.d, -h * 0.5);
  const fn = new THREE.Vector3().crossVectors(cd.s, cd.d).normalize();
  _v.copy(ctr).sub(crown.c);
  if (fn.dot(_v) < 0) fn.negate();
  if (cd.flat > 0 && fn.y < 0) fn.negate();
  const u0 = (cd.cell % 2) * 0.5 + 0.004;
  const v0 = (cd.cell < 2 ? 0.5 : 0) + 0.002;
  const du = 0.492;
  const corners = [
    [-0.5, 0, u0, v0],
    [0.5, 0, u0 + du, v0],
    [0.5, 1, u0 + du, v0 + du],
    [-0.5, 1, u0, v0 + du],
  ];
  const start = B.n;
  for (const [sx, sy, u, v] of corners) {
    const p = base.clone().addScaledVector(cd.s, sx * w).addScaledVector(cd.d, sy * h);
    _v.copy(p).sub(crown.c);
    _v.y = _v.y * crown.squash + crown.lift;
    _v.normalize().multiplyScalar(1 - own).addScaledVector(fn, own).normalize();
    B.pos.push(p.x, p.y, p.z);
    B.nor.push(_v.x, _v.y, _v.z);
    B.uv.push(u, v);
    // occlusion: deep inside and low in the crown is darker
    const d = Math.hypot(p.x - crown.c.x, (p.y - crown.c.y) * 1.3, p.z - crown.c.z) / crown.r;
    const ao = (0.5 + 0.5 * smoothstep(0.15, 1.0, d)) * (0.8 + 0.2 * smoothstep(crown.y0, crown.y1, p.y));
    B.aux.push(ao, cd.bend + sy * 0.15, cd.phase, 1);
  }
  B.idx.push(start, start + 1, start + 2, start, start + 2, start + 3);
}

// Crown bounds from the cards: centre, radius and how tall it is.
function crownOf(T) {
  const b = new THREE.Box3();
  for (const c of T.cards) b.expandByPoint(c.c.clone().addScaledVector(c.d, c.h * 0.5));
  const c = b.getCenter(new THREE.Vector3());
  const s = b.getSize(new THREE.Vector3());
  const r = Math.max(0.3, Math.max(s.x, s.z) * 0.5);
  return { c, r, box: b, y0: b.min.y, y1: b.max.y, squash: Math.min(1.4, (2 * r) / Math.max(0.5, s.y)), lift: r * 0.35 };
}

const LOD = {
  near: { keep: 1, grow: 1, maxLevel: 2, radial: [9, 6, 4], every: 1 },
  mid: { keep: 0.38, grow: 1.45, maxLevel: 1, radial: [6, 4], every: 2 },
  far: { keep: 0.11, grow: 2.35, maxLevel: 0, radial: [5], every: 3 },
};

// Near / mid / far geometry for one tree. Far levels keep the outer cards
// (they make the silhouette) and grow them to cover the same crown.
export function treeLods(T, own = 0.25) {
  const crown = crownOf(T);
  const r = new Random(T.cards.length * 7 + 3);
  const scored = T.cards.map((cd) => {
    const out = Math.min(1, cd.c.distanceTo(crown.c) / crown.r);
    return { cd, s: Math.sqrt(r.next()) * (0.45 + 0.55 * out) };
  });
  scored.sort((a, b) => b.s - a.s);
  const out = {};
  for (const [name, L] of Object.entries(LOD)) {
    const wood = new Buf();
    for (const tb of T.tubes) {
      if (tb.level > L.maxLevel) continue;
      tubeGeo(wood, tb, L.radial[Math.min(tb.level, L.radial.length - 1)], tb.level === 0 ? 1 : L.every, crown);
    }
    const leaves = new Buf();
    const n = Math.max(4, Math.round(scored.length * L.keep));
    for (let i = 0; i < Math.min(n, scored.length); i++) cardGeo(leaves, scored[i].cd, L.grow, crown, own);
    out[name] = { wood: wood.n ? wood.geometry() : null, leaves: leaves.geometry() };
  }
  const trunk = T.tubes.find((t) => t.level === 0);
  out.meta = {
    height: crown.box.max.y,
    crownR: crown.r,
    crownY: crown.c.y,
    trunkR: trunk ? trunk.rad[0] * 0.8 : 0,
  };
  return out;
}

export function buildTree(type, seed) {
  return SPECIES[type](seed);
}
