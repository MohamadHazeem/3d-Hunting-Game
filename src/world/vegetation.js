import * as THREE from 'three';
import { Random, hash2, smoothstep } from '../core/rng.js';
import { CORE_SIZE, FAR_COVER_SIZE } from './terrain.js';
import { loadTex } from '../core/assets.js';
import { loadFoliageAtlas, makeFoliageTexture } from './foliageTextures.js';
import { tierSettings } from '../gfx/quality.js';
import { Rocks } from './rocks.js';
import { buildTree, treeLods } from './trees.js';
import { treeMaterial, windUniforms } from './foliage.js';
import { loadModelTex } from './models.js';

// Lebanese trees: old olive trees, Palestine oak, umbrella stone pine, Greek
// juniper, Lebanon cedar and (in Akkar) Cilician fir, plus low garrigue
// shrubs. Each kind has a few procedural variants dressed in photographed
// foliage (trees.js). They are drawn instanced in three levels of detail that
// are re-sorted as the hunter walks: full trees close by, lighter ones in the
// middle distance and a handful of big cards far away.

export { windUniforms };

// bark photo and a linear colour multiplier that brings it to the species'
// own bark: pale grey olive, grey-brown oak, red-brown pine and juniper
const BARK = {
  olive: { tex: 'bark_willow', color: [3.0, 3.4, 3.9] },
  oak: { tex: 'bark_brown_02', color: [1.5, 1.6, 2.0] },
  pine: { tex: 'pine_bark', color: [1.3, 1.3, 1.3] },
  juniper: { tex: 'bark_willow', color: [2.6, 2.4, 2.4] },
  cedar: { model: 'bark/fir_bark', tex: 'bark_brown_02', color: [2.2, 2.3, 2.5] },
  fir: { model: 'bark/fir_bark', tex: 'pine_bark', color: [2.0, 2.1, 2.3] },
};
const VARIANTS = { olive: 4, oak: 3, pine: 3, juniper: 3, cedar: 2, fir: 3, shrub: 4 };
// how much sun comes through the leaves
const TRANS = { olive: 0.55, oak: 0.45, pine: 0.4, juniper: 0.3, cedar: 0.3, fir: 0.3, shrub: 0.4 };
// foliage colour per kind (multiplies the photographed atlas)
const TINT = { olive: 0xf2f4ea, oak: 0xe4ead8, pine: 0xeaf0dc, juniper: 0xdfe6de, cedar: 0xdde6de, fir: 0xd6e0d6, shrub: 0xe8e8dc };

// level-of-detail distances (m) for each quality tier: near, mid
const LOD_DIST = { low: [32, 130], medium: [50, 190], high: [70, 260], ultra: [95, 340] };
const SHRUB_FAR = { low: 70, medium: 110, high: 150, ultra: 190 };

// The woods beyond the hunting ground: light two-card trees on the far
// ring, wherever the far cover map (terrain.js) says the land is wooded.
// Which kinds grow there, how tall (m), how wide for their height, and the
// grid spacing per tier (0: none).
const FAR_KINDS = {
  forest: ['oak', 'oak', 'pine'],
  terraces: ['olive', 'oak', 'olive', 'pine'],
  highland: ['juniper', 'juniper', 'cedar', 'fir'],
  plain: ['oak', 'olive'],
};
const FAR_SIZE = { olive: [5, 1.2], oak: [6.5, 1.0], pine: [10, 0.9], juniper: [5.5, 0.8], cedar: [12, 1.1], fir: [12, 0.5] };
const FAR_CELL = { low: 0, medium: 18, high: 14, ultra: 12 };

// two crossed cards, one atlas cluster each, standing on the origin
function farTreeGeo() {
  const pos = [];
  const nor = [];
  const uv = [];
  const aux = [];
  const idx = [];
  for (let k = 0; k < 2; k++) {
    const a = (k / 2) * Math.PI + 0.4;
    const cx = Math.cos(a) * 0.5;
    const cz = Math.sin(a) * 0.5;
    const b = pos.length / 3;
    const u0 = k * 0.5 + 0.004;
    const corners = [[-1, 0, u0, 0.502], [1, 0, u0 + 0.492, 0.502], [1, 1, u0 + 0.492, 0.996], [-1, 1, u0, 0.996]];
    for (const [sx, y, u, v] of corners) {
      pos.push(cx * sx, y, cz * sx);
      // crown-shaped normals: out from the middle and up
      const n = new THREE.Vector3(cx * sx, y - 0.35, cz * sx).normalize();
      nor.push(n.x, n.y, n.z);
      uv.push(u, v);
      aux.push(0.8, 0, k * 0.5, 1);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aux', new THREE.Float32BufferAttribute(aux, 4));
  g.setIndex(idx);
  return g;
}

// One tree variant drawn in its three levels: near, mid, far; each a leaves
// mesh and (unless a shrub) a bark mesh, filled with the trees at that range.
class LodSet {
  constructor(group, lods, mats, list, shadows) {
    this.list = list; // {m: Float32Array(16), c: [r,g,b]}
    this.level = new Uint8Array(list.length).fill(255);
    this.levels = [];
    for (const name of ['near', 'mid', 'far']) {
      const L = lods[name];
      const parts = [];
      if (L) {
        for (const [geo, mat] of [[L.leaves, mats.leaf], [L.wood, mats.bark]]) {
          if (!geo || !mat) continue;
          const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
          im.count = 0;
          im.castShadow = shadows;
          im.receiveShadow = true;
          im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, list.length) * 3), 3);
          group.add(im);
          parts.push(im);
        }
      }
      this.levels.push(parts);
    }
  }

  // re-sort the trees into levels around (x, z); d1, d2: near and mid limits
  update(x, z, d1, d2) {
    const counts = [0, 0, 0];
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const it = list[i];
      const d = Math.hypot(it.x - x, it.z - z);
      let lv = d < d1 ? 0 : d < d2 ? 1 : 2;
      const prev = this.level[i];
      // a few metres of hysteresis so trees on a boundary don't flicker
      if (prev !== 255 && prev !== lv) {
        const edge = Math.min(prev, lv) === 0 ? d1 : d2;
        if (Math.abs(d - edge) < 4) lv = prev;
      }
      this.level[i] = lv;
      const parts = this.levels[lv];
      if (!parts.length) continue;
      const k = counts[lv]++;
      for (const im of parts) {
        im.instanceMatrix.array.set(it.m, k * 16);
        im.instanceColor.array[k * 3] = it.c[0];
        im.instanceColor.array[k * 3 + 1] = it.c[1];
        im.instanceColor.array[k * 3 + 2] = it.c[2];
      }
    }
    for (let lv = 0; lv < 3; lv++) {
      for (const im of this.levels[lv]) {
        im.count = counts[lv];
        im.instanceMatrix.clearUpdateRanges();
        im.instanceMatrix.addUpdateRange(0, counts[lv] * 16);
        im.instanceMatrix.needsUpdate = true;
        im.instanceColor.clearUpdateRanges();
        im.instanceColor.addUpdateRange(0, counts[lv] * 3);
        im.instanceColor.needsUpdate = true;
        im.visible = counts[lv] > 0;
        if (counts[lv]) im.computeBoundingSphere();
      }
    }
  }
}

export class Vegetation {
  constructor(hunt, terrain, quality) {
    this.hunt = hunt;
    this.terrain = terrain;
    this.quality = quality;
    this.trees = []; // {x,z,y,h,r,crownR,crownY,type}
    this.grid = new Map();
    this.group = new THREE.Group();
    this.sets = [];
    this.lastLod = new THREE.Vector2(1e9, 1e9);
    this.lodDist = LOD_DIST[quality] || LOD_DIST.high;
  }

  suitability(type, x, z, m, slope, h) {
    const road = this.terrain.road(x, z);
    if (road < 5) return 0;
    if (h < 3) return 0;
    if (Math.hypot(x - this.clearing.x, z - this.clearing.z) < this.clearing.r) return 0;
    const kind = this.terrain.kind;
    const n = this.terrain.noise2.noise(x / 60 + 40, z / 60);
    switch (type) {
      case 'olive':
        if (kind === 'terraces') return Math.max(m.terrace, 0.3 * (1 - m.forest) * (slope < 0.3 ? 1 : 0)) * (slope < 0.5 ? 1 : 0);
        return 0.15 * smoothstep(0.4, 0.8, n);
      case 'oak':
        return m.forest * (slope < 0.75 ? 1 : 0.3);
      case 'pine':
        return m.forest * smoothstep(0.0, 0.6, n);
      case 'juniper':
        return Math.max(m.forest, 0.25) * (1 - m.snow * 0.5);
      case 'cedar':
        return m.forest * smoothstep(0.2, 0.7, n);
      case 'fir':
        // fir keeps to the cooler, north-facing forest where the cedars aren't
        return m.forest * smoothstep(-0.1, -0.5, n) * (1 - m.snow * 0.4);
      case 'shrub':
        return (1 - m.field * 0.9) * (1 - m.terrace * 0.7) * (0.5 + 0.5 * smoothstep(0.02, 0.3, slope));
      default:
        return 0;
    }
  }

  async barkMaterial(t) {
    const b = BARK[t];
    let d = null;
    let n = null;
    if (b.model) [d, n] = await Promise.all([loadModelTex(`${b.model}_diff.jpg`, true), loadModelTex(`${b.model}_nor_gl.jpg`)]);
    if (!d || !n) [d, n] = await Promise.all([loadTex(`${b.tex}_diff.jpg`, true), loadTex(`${b.tex}_nor_gl.jpg`)]);
    return treeMaterial('bark', { map: d, normalMap: n, color: new THREE.Color().setRGB(...b.color) });
  }

  async build(scene, avoid) {
    this.clearing = avoid || { x: 1e9, z: 0, r: 0 };
    this.camera = scene.children.find((o) => o.isPerspectiveCamera) || null;
    const veg = { ...this.hunt.veg };
    // the Akkar highlands also carry Cilician fir alongside their cedars
    if (this.terrain.kind === 'highland' && veg.cedar > 0) veg.fir = veg.cedar * 0.9;
    const types = Object.keys(VARIANTS).filter((t) => veg[t] > 0);
    const qMul = { low: 0.55, medium: 0.8, high: 1, ultra: 1.15 }[this.quality] ?? 1;
    const T = tierSettings(this.quality);
    const dry = this.hunt.ground.dryness;

    // foliage atlases, bark and the tree variants
    const mats = {};
    const variants = {};
    await Promise.all(
      types.map(async (t) => {
        let tex = await loadFoliageAtlas(t);
        if (!tex) tex = makeFoliageTexture(t, this.hunt.seed + t.length * 13);
        mats[t] = {
          leaf: treeMaterial('leaf', { map: tex, a2c: T.msaa > 0, trans: TRANS[t], color: TINT[t] }),
          bark: BARK[t] ? await this.barkMaterial(t) : null,
        };
      })
    );
    for (const t of types) {
      variants[t] = [];
      for (let v = 0; v < VARIANTS[t]; v++) {
        const tree = buildTree(t, this.hunt.seed * 31 + v * 101 + t.length);
        if (t === 'shrub') {
          // atlas cells 0-1 are dry burnet, 2-3 green lentisk scrub
          const burnet = (v + 0.5) / VARIANTS[t] < 0.25 + 0.5 * dry;
          for (const c of tree.cards) c.cell = (burnet ? 0 : 2) + (c.cell & 1);
        }
        const lods = treeLods(tree, t === 'fir' || t === 'cedar' ? 0.4 : 0.25);
        if (t === 'shrub') lods.far = null;
        variants[t].push(lods);
      }
    }

    // placement
    const placements = {}; // type|variant -> instances
    const half = CORE_SIZE / 2 - 8;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const rnd = new Random(this.hunt.seed + 5);
    const nrm = new THREE.Vector3();
    for (const t of types) {
      const cell = t === 'olive' && this.terrain.kind === 'terraces' ? 8 : t === 'shrub' ? 5 : 6;
      const perHa = veg[t] * qMul;
      const pCell = Math.min(1, (perHa * cell * cell) / 10000);
      for (let gz = -half; gz < half; gz += cell) {
        for (let gx = -half; gx < half; gx += cell) {
          const hsh = hash2(Math.floor(gx), Math.floor(gz), t.length * 977 + this.hunt.seed + (t === 'fir' ? 31 : 0));
          if (hsh > pCell * 1.6) continue;
          const jit = t === 'olive' && this.terrain.kind === 'terraces' ? 1.2 : cell * 0.45;
          const x = gx + cell / 2 + (hash2(gx | 0, gz | 0, 7) - 0.5) * 2 * jit;
          const z = gz + cell / 2 + (hash2(gx | 0, gz | 0, 9) - 0.5) * 2 * jit;
          const m = this.terrain.maskAt(x, z);
          const y = this.terrain.height(x, z);
          this.terrain.normal(x, z, nrm);
          const slope = 1 - nrm.y;
          const s = this.suitability(t, x, z, m, slope, y);
          if (hsh > pCell * s) continue;
          const vi = Math.floor(hash2(gx | 0, gz | 0, 3) * variants[t].length);
          const sc = 0.75 + rnd.next() * 0.5;
          const rotY = rnd.float(0, Math.PI * 2);
          dummy.position.set(x, y, z);
          dummy.rotation.set(0, rotY, 0);
          dummy.scale.setScalar(sc);
          dummy.updateMatrix();
          const key = `${t}|${vi}`;
          if (!placements[key]) placements[key] = { t, vi, list: [] };
          // a little variety in the green, and in how much light each catches
          color.setHSL(0.22 + rnd.float(-0.025, 0.025), rnd.float(0.0, 0.12), 0.5);
          const l = 0.86 + rnd.next() * 0.22;
          const c = [(color.r / 0.5) * l, (color.g / 0.5) * l, (color.b / 0.5) * l];
          placements[key].list.push({ x, z, m: new Float32Array(dummy.matrix.elements), c });
          const meta = variants[t][vi].meta;
          if (t !== 'shrub') {
            this.addTree({
              x, z, y, type: t,
              h: meta.height * sc,
              r: Math.max(0.25, meta.trunkR * sc * 1.2),
              crownR: meta.crownR * sc,
              crownY: meta.crownY * sc,
            });
          }
        }
      }
    }

    const shadowsOn = this.quality !== 'low';
    for (const key of Object.keys(placements)) {
      const P = placements[key];
      const set = new LodSet(this.group, variants[P.t][P.vi], mats[P.t], P.list, shadowsOn);
      set.shrub = P.t === 'shrub';
      this.sets.push(set);
    }
    scene.add(this.group);
    // until the hunter is placed, sort around the middle of the ground
    this.updateLod(0, 0);
    this.buildFarForest(scene, mats);

    // boulders, outcrops and heaps of field stones
    this.rocks = new Rocks(this.hunt, this.terrain, tierSettings(this.quality));
    await this.rocks.build(scene, this.clearing);
    this.rockGrid = new Map();
    for (const st of this.rocks.stones) {
      const k = `${Math.floor(st.x / 10)}:${Math.floor(st.z / 10)}`;
      if (!this.rockGrid.has(k)) this.rockGrid.set(k, []);
      this.rockGrid.get(k).push(st);
    }
  }

  buildFarForest(scene, mats) {
    const cell = FAR_CELL[this.quality] ?? 17;
    const kinds = (FAR_KINDS[this.terrain.kind] || []).filter((t) => mats[t]);
    if (!cell || !kinds.length || !this.terrain.farCover) return;
    const t = this.terrain;
    const seed = this.hunt.seed;
    const lists = kinds.map(() => []);
    const S = FAR_COVER_SIZE / 2 - 20;
    const half = CORE_SIZE / 2 + 4;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const sv = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (let gz = -S; gz < S; gz += cell) {
      for (let gx = -S; gx < S; gx += cell) {
        const ix = Math.floor(gx);
        const iz = Math.floor(gz);
        const x = gx + hash2(ix, iz, seed + 31) * cell;
        const z = gz + hash2(ix, iz, seed + 37) * cell;
        // the hunting ground has its own trees
        if (Math.abs(x) < half && Math.abs(z) < half) continue;
        if (hash2(ix, iz, seed + 6161) > t.farCoverAt(x, z) * 0.9) continue;
        const k = Math.floor(hash2(ix, iz, seed + 41) * kinds.length);
        const [H, w] = FAR_SIZE[kinds[k]];
        const r = hash2(ix, iz, seed + 43);
        const sc = H * (0.7 + 0.6 * r);
        p.set(x, t.farHeight(x, z) - 0.6, z);
        q.setFromAxisAngle(up, r * 40);
        sv.set(sc * w, sc, sc * w);
        m4.compose(p, q, sv);
        lists[k].push(m4.clone());
      }
    }
    const geo = farTreeGeo();
    const col = new THREE.Color();
    this.far = [];
    kinds.forEach((kind, k) => {
      const list = lists[k];
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, mats[kind].leaf, list.length);
      list.forEach((m, i) => {
        im.setMatrixAt(i, m);
        const l = 0.75 + 0.3 * hash2(i, k, seed);
        im.setColorAt(i, col.setRGB(l, l, l * 0.97));
      });
      im.castShadow = false;
      im.receiveShadow = false;
      im.computeBoundingSphere();
      scene.add(im);
      this.far.push(im);
    });
  }

  updateLod(x, z) {
    this.lastLod.set(x, z);
    const [d1, d2] = this.lodDist;
    const sf = SHRUB_FAR[this.quality] || 150;
    for (const s of this.sets) s.update(x, z, s.shrub ? Math.min(d1, sf * 0.4) : d1, s.shrub ? sf : d2);
  }

  addTree(rec) {
    this.trees.push(rec);
    const k = `${Math.floor(rec.x / 10)}:${Math.floor(rec.z / 10)}`;
    if (!this.grid.has(k)) this.grid.set(k, []);
    this.grid.get(k).push(rec);
  }

  treesNear(x, z, radius) {
    const out = [];
    const r = Math.ceil(radius / 10);
    const cx = Math.floor(x / 10);
    const cz = Math.floor(z / 10);
    for (let j = -r; j <= r; j++) {
      for (let i = -r; i <= r; i++) {
        const cell = this.grid.get(`${cx + i}:${cz + j}`);
        if (!cell) continue;
        for (const t of cell) {
          if ((t.x - x) ** 2 + (t.z - z) ** 2 < radius * radius) out.push(t);
        }
      }
    }
    return out;
  }

  // Push a point (player) out of tree trunks and big stones.
  collide(pos, radius) {
    if (this.rockGrid) {
      const cx = Math.floor(pos.x / 10);
      const cz = Math.floor(pos.z / 10);
      for (let j = -1; j <= 1; j++) {
        for (let i = -1; i <= 1; i++) {
          const cell = this.rockGrid.get(`${cx + i}:${cz + j}`);
          if (!cell) continue;
          for (const st of cell) {
            const dx = pos.x - st.x;
            const dz = pos.z - st.z;
            const min = st.r + radius;
            if (dx * dx + dz * dz > min * min || pos.y > st.y + st.h) continue;
            const d = Math.hypot(dx, dz) || 1e-4;
            pos.x = st.x + (dx / d) * min;
            pos.z = st.z + (dz / d) * min;
          }
        }
      }
    }
    const near = this.treesNear(pos.x, pos.z, 4);
    for (const t of near) {
      const dx = pos.x - t.x;
      const dz = pos.z - t.z;
      const d = Math.hypot(dx, dz);
      const min = t.r + radius;
      if (d < min && d > 1e-4) {
        pos.x = t.x + (dx / d) * min;
        pos.z = t.z + (dz / d) * min;
      }
    }
  }

  // Does the segment a->b pass through foliage/trunk? Used for pellets
  // (dense canopy stops shot) and for line-of-sight.
  segmentBlocked(a, b) {
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const near = this.treesNear(mx, mz, len / 2 + 7);
    for (const t of near) {
      // trunk as vertical capsule
      const d = segPointDist2D(a, b, t.x, t.z);
      if (d.dist < t.r && d.y < t.y + t.crownY && d.y > t.y - 0.5) return true;
    }
    return false;
  }

  update(dt) {
    windUniforms.uTime.value += dt;
    // re-sort the levels of detail every few metres the hunter walks
    const cam = this.camera;
    if (cam && Math.hypot(cam.position.x - this.lastLod.x, cam.position.z - this.lastLod.y) > 3) this.updateLod(cam.position.x, cam.position.z);
  }
}

function segPointDist2D(a, b, px, pz) {
  const vx = b.x - a.x;
  const vz = b.z - a.z;
  const l2 = vx * vx + vz * vz || 1e-6;
  let t = ((px - a.x) * vx + (pz - a.z) * vz) / l2;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + vx * t;
  const cz = a.z + vz * t;
  return { dist: Math.hypot(px - cx, pz - cz), y: a.y + (b.y - a.y) * t };
}
