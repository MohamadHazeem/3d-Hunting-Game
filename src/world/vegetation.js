import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Random, hash2, smoothstep } from '../core/rng.js';
import { CORE_SIZE } from './terrain.js';
import { loadTex } from '../core/assets.js';
import { makeFoliageTexture } from './foliageTextures.js';
import { tierSettings } from '../gfx/quality.js';
import { Rocks } from './rocks.js';

// Procedural Lebanese trees: old olive trees, Palestine/kermes oak,
// umbrella-shaped stone pine, Greek juniper and Lebanon cedar, plus low
// thorny-burnet shrubland. Each tree type has a few geometry variants that
// are drawn with instancing, split into spatial chunks for culling.

const CHUNK = 125;
export const windUniforms = { uTime: { value: 0 }, uWind: { value: 1 } };

// ---------- geometry helpers ----------

function branchGeo(p0, p1, r0, r1, radial = 6) {
  const dir = new THREE.Vector3().subVectors(p1, p0);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, len, radial, 1, true);
  // scale UVs so bark texture density is constant
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(r0 * 2 * Math.PI * 2)), uv.getY(i) * len * 0.8);
  }
  g.translate(0, len / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(q);
  g.translate(p0.x, p0.y, p0.z);
  return g;
}

function cardGeo(center, size, rnd, crownCenter, flat = 0, normalBias = 1) {
  const g = new THREE.PlaneGeometry(size, size);
  const e = new THREE.Euler(
    rnd.float(-Math.PI, Math.PI) * (1 - flat) - (flat * Math.PI) / 2,
    rnd.float(0, Math.PI * 2),
    rnd.float(-Math.PI, Math.PI) * (1 - flat)
  );
  g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(e));
  g.translate(center.x, center.y, center.z);
  // Normals point away from the crown centre: soft, volumetric lighting.
  const pos = g.attributes.position;
  const nor = g.attributes.normal;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).sub(crownCenter);
    v.y += normalBias * 0.6;
    v.normalize();
    nor.setXYZ(i, v.x, v.y, v.z);
  }
  // height above ground for wind weighting
  return g;
}

function mergeOrEmpty(list) {
  if (!list.length) return new THREE.BufferGeometry();
  const geos = list.map((g) => (g.index ? g.toNonIndexed() : g));
  return mergeGeometries(geos, false);
}

// ---------- tree builders ----------

function buildOlive(seed) {
  const r = new Random(seed);
  const wood = [];
  const leaves = [];
  const trunkH = r.float(1.0, 1.6);
  const base = new THREE.Vector3(0, -0.2, 0);
  const top = new THREE.Vector3(r.float(-0.3, 0.3), trunkH, r.float(-0.3, 0.3));
  const tr = r.float(0.22, 0.34);
  // gnarled trunk made of two twisted halves
  wood.push(branchGeo(base, top, tr * 1.3, tr, 7));
  wood.push(branchGeo(base.clone().add(new THREE.Vector3(0.12, 0, 0.05)), top.clone().add(new THREE.Vector3(0.1, 0.2, -0.08)), tr, tr * 0.7, 6));
  const crownC = new THREE.Vector3(0, trunkH + 1.6, 0);
  const leaders = r.int(3, 5);
  const tips = [];
  for (let i = 0; i < leaders; i++) {
    const a = (i / leaders) * Math.PI * 2 + r.float(-0.4, 0.4);
    const mid = top.clone().add(new THREE.Vector3(Math.cos(a) * 0.8, r.float(0.7, 1.2), Math.sin(a) * 0.8));
    wood.push(branchGeo(top, mid, tr * 0.7, tr * 0.42, 6));
    for (let k = 0; k < 3; k++) {
      const b = a + r.float(-0.9, 0.9);
      const end = mid.clone().add(new THREE.Vector3(Math.cos(b) * r.float(0.6, 1.3), r.float(0.4, 1.2), Math.sin(b) * r.float(0.6, 1.3)));
      wood.push(branchGeo(mid, end, tr * 0.3, 0.025, 4));
      tips.push(end);
    }
  }
  for (const t of tips) {
    for (let k = 0; k < 9; k++) {
      const c = t.clone().add(new THREE.Vector3(r.float(-0.9, 0.9), r.float(-0.6, 0.5), r.float(-0.9, 0.9)));
      leaves.push(cardGeo(c, r.float(1.4, 1.9), r, crownC));
    }
  }
  // fill the middle of the crown
  for (let k = 0; k < 14; k++) {
    const c = crownC.clone().add(new THREE.Vector3(r.float(-1.4, 1.4), r.float(-0.6, 0.9), r.float(-1.4, 1.4)));
    leaves.push(cardGeo(c, r.float(1.5, 2.0), r, crownC));
  }
  return { wood, leaves, height: crownC.y + 1.5, crownR: 2.6, trunkR: tr, crownY: crownC.y };
}

function buildOak(seed) {
  const r = new Random(seed);
  const wood = [];
  const leaves = [];
  const H = r.float(5.5, 8);
  const tr = r.float(0.16, 0.26);
  const trunkTop = new THREE.Vector3(r.float(-0.3, 0.3), H * 0.35, r.float(-0.3, 0.3));
  wood.push(branchGeo(new THREE.Vector3(0, -0.2, 0), trunkTop, tr * 1.25, tr * 0.85, 7));
  const crownC = new THREE.Vector3(0, H * 0.62, 0);
  const crownR = r.float(2.4, 3.3);
  const n = r.int(4, 6);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r.float(-0.3, 0.3);
    const end = crownC.clone().add(new THREE.Vector3(Math.cos(a) * crownR * 0.7, r.float(-0.6, 1.4), Math.sin(a) * crownR * 0.7));
    wood.push(branchGeo(trunkTop, end, tr * 0.6, 0.05, 5));
  }
  const cards = 110;
  for (let i = 0; i < cards; i++) {
    const u = r.float(0, Math.PI * 2);
    const v = Math.acos(r.float(-0.6, 1));
    const rr = crownR * Math.cbrt(r.float(0.35, 1));
    const c = new THREE.Vector3(Math.sin(v) * Math.cos(u) * rr, Math.cos(v) * rr * 0.8, Math.sin(v) * Math.sin(u) * rr).add(crownC);
    leaves.push(cardGeo(c, r.float(1.3, 1.8), r, crownC));
  }
  return { wood, leaves, height: crownC.y + crownR * 0.8, crownR, trunkR: tr, crownY: crownC.y };
}

function buildPine(seed) {
  // Stone pine (Pinus pinea): tall clean trunk and a flat umbrella crown.
  const r = new Random(seed);
  const wood = [];
  const leaves = [];
  const H = r.float(9, 13);
  const tr = r.float(0.2, 0.3);
  const lean = new THREE.Vector3(r.float(-0.8, 0.8), 0, r.float(-0.8, 0.8));
  const top = new THREE.Vector3(lean.x, H * 0.78, lean.z);
  wood.push(branchGeo(new THREE.Vector3(0, -0.3, 0), top, tr * 1.2, tr * 0.6, 8));
  const crownC = new THREE.Vector3(top.x, H * 0.9, top.z);
  const crownR = r.float(3.6, 5);
  const n = r.int(5, 7);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r.float(-0.3, 0.3);
    const end = crownC.clone().add(new THREE.Vector3(Math.cos(a) * crownR * 0.75, r.float(-0.2, 0.6), Math.sin(a) * crownR * 0.75));
    wood.push(branchGeo(top, end, tr * 0.45, 0.05, 5));
  }
  for (let i = 0; i < 95; i++) {
    const a = r.float(0, Math.PI * 2);
    const d = Math.sqrt(r.next()) * crownR;
    const y = crownC.y + 0.9 * (1 - (d / crownR) ** 2) + r.float(-0.45, 0.45);
    const c = new THREE.Vector3(crownC.x + Math.cos(a) * d, y, crownC.z + Math.sin(a) * d);
    leaves.push(cardGeo(c, r.float(1.6, 2.2), r, new THREE.Vector3(crownC.x, crownC.y - 1.5, crownC.z), 0.7));
  }
  return { wood, leaves, height: crownC.y + 1.2, crownR, trunkR: tr, crownY: crownC.y };
}

function buildJuniper(seed) {
  const r = new Random(seed);
  const wood = [];
  const leaves = [];
  const H = r.float(4, 7);
  const tr = r.float(0.18, 0.3);
  let prev = new THREE.Vector3(0, -0.2, 0);
  for (let s = 1; s <= 3; s++) {
    const p = new THREE.Vector3(r.float(-0.35, 0.35) * s, (H * 0.55 * s) / 3, r.float(-0.35, 0.35) * s);
    wood.push(branchGeo(prev, p, tr * (1.25 - s * 0.25), tr * (1.0 - s * 0.25), 6));
    prev = p;
  }
  const crownC = new THREE.Vector3(prev.x, H * 0.55, prev.z);
  for (let i = 0; i < 85; i++) {
    const t = r.next();
    const y = 0.8 + t * (H - 0.8);
    const rad = (1 - t) * r.float(1.4, 2.4) * (0.6 + 0.4 * r.next()) + 0.3;
    const a = r.float(0, Math.PI * 2);
    const c = new THREE.Vector3(crownC.x * t + Math.cos(a) * rad, y, crownC.z * t + Math.sin(a) * rad);
    leaves.push(cardGeo(c, r.float(1.0, 1.5), r, new THREE.Vector3(crownC.x, y - 0.3, crownC.z)));
  }
  return { wood, leaves, height: H, crownR: 2.2, trunkR: tr, crownY: crownC.y };
}

function buildCedar(seed) {
  // Cedrus libani: massive trunk and flat, layered tiers.
  const r = new Random(seed);
  const wood = [];
  const leaves = [];
  const H = r.float(13, 18);
  const tr = r.float(0.45, 0.65);
  wood.push(branchGeo(new THREE.Vector3(0, -0.4, 0), new THREE.Vector3(0, H * 0.92, 0), tr, tr * 0.25, 9));
  const tiers = r.int(4, 6);
  for (let t = 0; t < tiers; t++) {
    const k = t / (tiers - 1);
    const y = H * (0.32 + 0.6 * k);
    const R = (1 - k * 0.75) * r.float(5, 7);
    const arms = 5;
    for (let a = 0; a < arms; a++) {
      const ang = (a / arms) * Math.PI * 2 + r.float(-0.4, 0.4) + t;
      const end = new THREE.Vector3(Math.cos(ang) * R * 0.9, y + r.float(-0.2, 0.5), Math.sin(ang) * R * 0.9);
      wood.push(branchGeo(new THREE.Vector3(0, y - 0.6, 0), end, tr * 0.35 * (1 - k * 0.5), 0.06, 5));
    }
    const nCards = Math.round(14 + 26 * (1 - k));
    for (let i = 0; i < nCards; i++) {
      const ang = r.float(0, Math.PI * 2);
      const d = Math.sqrt(r.next()) * R;
      const c = new THREE.Vector3(Math.cos(ang) * d, y + r.float(-0.25, 0.35), Math.sin(ang) * d);
      leaves.push(cardGeo(c, r.float(1.8, 2.4), r, new THREE.Vector3(0, y - 1.2, 0), 0.85));
    }
  }
  return { wood, leaves, height: H, crownR: 6, trunkR: tr, crownY: H * 0.6 };
}

function buildShrub(seed) {
  const r = new Random(seed);
  const leaves = [];
  const R = r.float(0.5, 0.9);
  const crownC = new THREE.Vector3(0, R * 0.35, 0);
  for (let i = 0; i < 9; i++) {
    const c = new THREE.Vector3(r.float(-R, R) * 0.6, r.float(0.15, R * 0.7), r.float(-R, R) * 0.6);
    leaves.push(cardGeo(c, r.float(0.8, 1.2) * R * 1.4, r, crownC));
  }
  return { wood: [], leaves, height: R * 1.1, crownR: R, trunkR: 0, crownY: crownC.y };
}

const BUILDERS = { olive: buildOlive, oak: buildOak, pine: buildPine, juniper: buildJuniper, cedar: buildCedar, shrub: buildShrub };
const BARK = { olive: 'bark_willow', oak: 'bark_brown_02', pine: 'pine_bark', juniper: 'bark_willow', cedar: 'bark_brown_02' };
const VARIANTS = { olive: 3, oak: 3, pine: 2, juniper: 3, cedar: 2, shrub: 3 };

function foliageMaterial(tex, tint, a2c) {
  const m = new THREE.MeshStandardMaterial({
    map: tex,
    alphaTest: 0.42,
    // with MSAA, leaf edges become soft coverage instead of hard cut-outs
    alphaToCoverage: a2c,
    side: THREE.DoubleSide,
    roughness: 0.82,
    metalness: 0,
    color: tint,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWind = windUniforms.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        {
          vec3 ip = vec3(0.0);
          #ifdef USE_INSTANCING
            ip = instanceMatrix[3].xyz;
          #endif
          float hw = max(0.0, position.y - 0.5);
          float ph = ip.x * 0.21 + ip.z * 0.17;
          float sway = sin(uTime * 1.3 + ph) * 0.5 + sin(uTime * 2.7 + ph * 1.7) * 0.25;
          transformed.x += sway * 0.035 * hw * uWind;
          transformed.z += cos(uTime * 1.1 + ph) * 0.02 * hw * uWind;
          transformed += normal * sin(uTime * 7.0 + position.x * 3.0 + position.z * 2.0 + ph) * 0.03 * uWind;
        }`
      );
    // a little back-light translucency so canopies glow when lit from behind
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\n gl_FragColor.rgb += diffuseColor.rgb * 0.1;'
      )
      // leaf cards carry crown-shaped normals; keep them on both faces
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize(vNormal); nonPerturbedNormal = normal;');
  };
  m.customProgramCacheKey = () => 'foliage';
  return m;
}

export class Vegetation {
  constructor(hunt, terrain, quality) {
    this.hunt = hunt;
    this.terrain = terrain;
    this.quality = quality;
    this.trees = []; // {x,z,y,h,r,crownR,crownY,type}
    this.grid = new Map();
    this.group = new THREE.Group();
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
      case 'shrub':
        return (1 - m.field * 0.9) * (1 - m.terrace * 0.7) * (0.5 + 0.5 * smoothstep(0.02, 0.3, slope));
      default:
        return 0;
    }
  }

  async build(scene, avoid) {
    this.clearing = avoid || { x: 1e9, z: 0, r: 0 };
    const veg = this.hunt.veg;
    const types = Object.keys(BUILDERS).filter((t) => veg[t] > 0);
    const qMul = { low: 0.55, medium: 0.8, high: 1, ultra: 1.15 }[this.quality] ?? 1;
    const variants = {};
    const barkMats = {};
    const leafMats = {};
    const tints = {
      olive: 0xf0f4e8, oak: 0xe0e8d0, pine: 0xe8f0d8, juniper: 0xd8e4dc, cedar: 0xd0e0d0,
      shrub: this.hunt.ground.dryness > 0.6 ? 0xd8c8a8 : 0xc0c8a8,
    };
    for (const t of types) {
      const tex = makeFoliageTexture(t, this.hunt.seed + t.length * 13);
      leafMats[t] = foliageMaterial(tex, tints[t], tierSettings(this.quality).msaa > 0);
      if (BARK[t]) {
        const [d, n] = await Promise.all([loadTex(`${BARK[t]}_diff.jpg`, true), loadTex(`${BARK[t]}_nor_gl.jpg`)]);
        barkMats[t] = new THREE.MeshStandardMaterial({
          map: d,
          normalMap: n,
          roughness: 0.95,
          color: t === 'olive' || t === 'juniper' ? 0xb0aaa0 : 0xffffff,
        });
      }
      variants[t] = [];
      for (let v = 0; v < VARIANTS[t]; v++) {
        const b = BUILDERS[t](this.hunt.seed * 31 + v * 101 + t.length);
        variants[t].push({
          wood: b.wood.length ? mergeOrEmpty(b.wood) : null,
          leaves: mergeOrEmpty(b.leaves),
          meta: b,
        });
      }
    }

    // placement
    const placements = {}; // key chunk|type|variant -> matrices
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
          const hsh = hash2(Math.floor(gx), Math.floor(gz), t.length * 977 + this.hunt.seed);
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
          const ck = Math.floor((x + CORE_SIZE / 2) / CHUNK) + ':' + Math.floor((z + CORE_SIZE / 2) / CHUNK);
          const key = `${ck}|${t}|${vi}`;
          if (!placements[key]) placements[key] = { t, vi, mats: [], cols: [] };
          placements[key].mats.push(dummy.matrix.clone());
          color.setHSL(0, 0, 0.82 + rnd.next() * 0.3);
          placements[key].cols.push(color.clone());
          const meta = variants[t][vi].meta;
          if (t !== 'shrub') {
            const rec = {
              x, z, y, type: t,
              h: meta.height * sc,
              r: Math.max(0.25, meta.trunkR * sc * 1.2),
              crownR: meta.crownR * sc,
              crownY: meta.crownY * sc,
            };
            this.addTree(rec);
          }
        }
      }
    }

    const shadowsOn = this.quality !== 'low';
    for (const key of Object.keys(placements)) {
      const P = placements[key];
      const v = variants[P.t][P.vi];
      const n = P.mats.length;
      const leaves = new THREE.InstancedMesh(v.leaves, leafMats[P.t], n);
      for (let i = 0; i < n; i++) {
        leaves.setMatrixAt(i, P.mats[i]);
        leaves.setColorAt(i, P.cols[i]);
      }
      leaves.castShadow = shadowsOn;
      leaves.receiveShadow = true;
      leaves.computeBoundingSphere();
      this.group.add(leaves);
      if (v.wood) {
        const wood = new THREE.InstancedMesh(v.wood, barkMats[P.t], n);
        for (let i = 0; i < n; i++) wood.setMatrixAt(i, P.mats[i]);
        wood.castShadow = shadowsOn;
        wood.receiveShadow = true;
        wood.computeBoundingSphere();
        this.group.add(wood);
      }
    }
    scene.add(this.group);

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
