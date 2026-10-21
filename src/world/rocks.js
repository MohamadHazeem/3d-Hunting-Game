import * as THREE from 'three';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Random, hash2, smoothstep } from '../core/rng.js';
import { CORE_SIZE } from './terrain.js';
import { loadTex } from '../core/assets.js';
import { wetness } from './shading.js';
import { loadModel } from './models.js';

// Limestone: boulders and outcrops on the slopes, field stones and the
// cleared-stone heaps that sit at the edges of Lebanese fields. Drawn with
// instancing in chunks; each chunk swaps to a cheaper rock far away. The
// shapes are photo-scanned rocks (public/models/rocks, decimated, with their
// own ambient occlusion baked into the vertex colours); the procedural rock
// below stands in if they can't be loaded.

const CHUNK = 125;

// How to normalise a scanned rock: centred, longest side along x, scaled to
// a unit horizontal radius, with 30% of its height below the origin (the part
// that sits in the ground). Measured on the detailed level and applied to
// both, so the two levels line up.
function rockFrame(g) {
  const r = g.clone();
  r.computeBoundingBox();
  const turn = r.boundingBox.max.z - r.boundingBox.min.z > r.boundingBox.max.x - r.boundingBox.min.x;
  if (turn) r.rotateY(Math.PI / 2);
  r.computeBoundingBox();
  const b = r.boundingBox;
  const k = 1 / Math.max(1e-3, (b.max.x - b.min.x) / 2, (b.max.z - b.min.z) / 2);
  const H = (b.max.y - b.min.y) * k;
  return { turn, cx: (b.min.x + b.max.x) / 2, y0: b.min.y, cz: (b.min.z + b.max.z) / 2, k, H, top: 0.7 * H };
}

function applyFrame(g, f) {
  const out = g.clone();
  if (f.turn) out.rotateY(Math.PI / 2);
  out.translate(-f.cx, -f.y0, -f.cz);
  out.scale(f.k, f.k, f.k);
  out.translate(0, -0.3 * f.H, 0);
  out.computeBoundingSphere();
  return out;
}

// A stump or fallen trunk at its real size: centred, standing on y = 0.
function woodPiece(meshes, lod1) {
  const m = meshes.find((x) => x.name.endsWith('_lod1') === lod1) || meshes[0];
  const ref = meshes.find((x) => !x.name.endsWith('_lod1')) || m;
  ref.geometry.computeBoundingBox();
  const b = ref.geometry.boundingBox;
  const g = m.geometry.clone();
  g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  g.computeBoundingSphere();
  return g;
}

let library = null;
// Scanned rock shapes: { big: [{hi, lo, top}], small: [geometry] }, or null
export function rockLibrary() {
  if (library) return library;
  const files = ['boulder_01', 'boulder_02', 'boulder_05', 'rock_set', 'stone_07', 'stone_09'];
  library = Promise.all(files.map((n) => loadModel('rocks/' + n))).then((sets) => {
    if (sets.some((x) => !x)) return null;
    const meshes = sets.flat();
    const by = new Map(meshes.map((m) => [m.name, m.geometry]));
    const big = [];
    const small = [];
    for (const m of meshes) {
      if (m.name.endsWith('_lod1')) continue;
      const f = rockFrame(m.geometry);
      const lo = by.get(m.name + '_lod1');
      if (lo) {
        big.push({ hi: applyFrame(m.geometry, f), lo: applyFrame(lo, f), top: f.top });
        // two of the set's rocks also make good field stones (cheap level)
        if (/rock0[35]$/.test(m.name)) small.push(applyFrame(lo, f));
      } else {
        small.push(applyFrame(m.geometry, f));
      }
    }
    return { big, small };
  });
  return library;
}

// a lumpy, flattened rock (radius ~1) with smooth normals
export function rockGeometry(seed, detail = 1, flat = 0.62) {
  const r = new Random(seed);
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position;
  const ph = [r.float(0, 9), r.float(0, 9), r.float(0, 9)];
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n =
      0.22 * Math.sin(v.x * 2.1 + ph[0]) * Math.cos(v.z * 1.7 + ph[1]) +
      0.14 * Math.sin(v.y * 3.3 + v.x * 1.3 + ph[2]) +
      0.08 * Math.sin(v.z * 5.1 - v.y * 4.2 + ph[0]);
    v.multiplyScalar(1 + n);
    // facets: knock a few planes off so it reads as broken limestone
    if (v.y > 0.55) v.y = 0.55 + (v.y - 0.55) * 0.35;
    v.y *= flat;
    if (v.y < -0.25) v.y = -0.25 + (v.y + 0.25) * 0.3;
    p.setXYZ(i, v.x * r.float(0.97, 1.03), v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

// Triplanar stone in the rock's own space (no UV seams), tinted per instance.
// The texture only gives grain: it is turned to grey (the photo is of mossy
// rock) and scaled by `gain` so the stone's colour comes from the tint.
export function stoneMaterial(diff, scale, tint = 0xffffff, roughness = 0.92, gain = 5.5, bakedAO = false) {
  // bakedAO: the scanned rocks carry their occlusion in the vertex colours
  const m = new THREE.MeshStandardMaterial({ color: tint, roughness, metalness: 0, vertexColors: bakedAO });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.tStone = { value: diff };
    shader.uniforms.uWet = wetness;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRockP;\nvarying vec3 vRockN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRockP = position;\nvRockN = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tStone;\nuniform float uWet;\nvarying vec3 vRockP;\nvarying vec3 vRockN;')
      .replace(
        '#include <map_fragment>',
        `{
          vec3 w = pow(abs(normalize(vRockN)), vec3(4.0)); w /= (w.x + w.y + w.z);
          vec3 p = vRockP * ${scale.toFixed(3)};
          vec3 c = texture2D(tStone, p.zy).rgb * w.x + texture2D(tStone, p.xz).rgb * w.y + texture2D(tStone, p.xy).rgb * w.z;
          float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
          // weathered tops are paler, undersides darker
          l *= 0.8 + 0.32 * smoothstep(-0.6, 0.8, normalize(vRockN).y);
          diffuseColor.rgb *= clamp(l * ${gain.toFixed(2)}, 0.0, 1.6);
          // wet limestone goes darker, most on its rain-washed top
          diffuseColor.rgb *= 1.0 - uWet * (0.18 + 0.14 * smoothstep(-0.2, 0.8, normalize(vRockN).y));
        }`
      )
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.42, uWet * 0.75);');
  };
  m.customProgramCacheKey = () => 'stone' + scale + ':' + gain + (bakedAO ? ':ao' : '');
  return m;
}

const DENSITY = {
  // boulders per hectare, cleared-stone heaps per hectare
  highland: { rocks: 55, piles: 0.6, big: 0.25 },
  forest: { rocks: 22, piles: 0.3, big: 0.12 },
  terraces: { rocks: 12, piles: 1.6, big: 0.05 },
  plain: { rocks: 5, piles: 2.4, big: 0.02 },
};

export class Rocks {
  constructor(hunt, terrain, T) {
    this.hunt = hunt;
    this.terrain = terrain;
    this.T = T;
    this.group = new THREE.Group();
    this.stones = []; // big stones you bump into and that stop shot: {x, z, y, r, h}
  }

  async build(scene, clearing) {
    const terrain = this.terrain;
    const [diff, lib, barkD, stump, trunk] = await Promise.all([
      loadTex('rocky_terrain_02_diff.jpg', true),
      rockLibrary(),
      loadTex('bark_brown_02_diff.jpg', true),
      loadModel('deadwood/stump'),
      loadModel('deadwood/trunk'),
    ]);
    // stumps and fallen trunks under the trees (scanned, their real size)
    const wood = stump && trunk ? [stump, trunk].map((ms) => ({ hi: woodPiece(ms, false), lo: woodPiece(ms, true) })) : null;
    const woodMat = wood ? stoneMaterial(barkD, 1.4, 0xa49480, 0.95, 3.4, true) : null;
    const mat = stoneMaterial(diff, 0.45, lib ? 0xe2d8c8 : 0xd8d4cc, 0.92, 5.5, !!lib);
    let hiGeo;
    let loGeo;
    let tops;
    if (lib) {
      hiGeo = lib.big.map((b) => b.hi);
      loGeo = lib.big.map((b) => b.lo);
      tops = lib.big.map((b) => b.top);
    } else {
      hiGeo = [0, 1, 2].map((i) => rockGeometry(this.hunt.seed * 3 + i, this.T.detail >= 1 ? 2 : 1));
      loGeo = [0, 1, 2].map((i) => rockGeometry(this.hunt.seed * 3 + i, 0));
      tops = [0.45, 0.45, 0.45];
    }
    const NV = hiGeo.length;
    // scanned rocks keep their natural height, so sit them less deep
    const sink = lib ? 0.06 : 0.3;
    // heaps: a dozen stones piled into a rough cone
    const pileGeo = [0, 1].map((k) => {
      const r = new Random(this.hunt.seed + 50 + k);
      const parts = [];
      const n = r.int(11, 16);
      for (let i = 0; i < n; i++) {
        const g = lib ? lib.small[r.int(0, lib.small.length - 1)].clone() : rockGeometry(this.hunt.seed + 100 * k + i, 0, 0.7);
        if (lib) g.scale(1, 0.8, 1);
        const a = r.float(0, Math.PI * 2);
        const d = Math.sqrt(r.next()) * 1.1;
        const s = r.float(0.22, 0.42);
        g.scale(s, s, s);
        g.rotateY(r.float(0, 6));
        g.translate(Math.cos(a) * d, 0.55 * (1 - d / 1.25) + s * 0.3, Math.sin(a) * d);
        parts.push(g);
      }
      if (lib) for (const g of parts) for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(a)) g.deleteAttribute(a);
      return mergeGeometries(parts);
    });

    const dens = DENSITY[terrain.kind] || DENSITY.terraces;
    const qMul = this.T.detail;
    const rnd = new Random(this.hunt.seed + 909);
    const half = CORE_SIZE / 2 - 6;
    const chunks = new Map();
    const dummy = new THREE.Object3D();
    const nrm = new THREE.Vector3();
    const col = new THREE.Color();
    const add = (kind, vi, x, z, s, tilt) => {
      const key = Math.floor((x + CORE_SIZE / 2) / CHUNK) + ':' + Math.floor((z + CORE_SIZE / 2) / CHUNK);
      if (!chunks.has(key)) chunks.set(key, { rocks: hiGeo.map(() => []), piles: [[], []], wood: [[], []], cx: 0, cy: 0, cz: 0, n: 0 });
      const c = chunks.get(key);
      const y = terrain.height(x, z);
      terrain.normal(x, z, nrm);
      dummy.position.set(x, y - s * (kind === 'pile' ? 0.05 : kind === 'wood' ? 0.04 : sink), z);
      dummy.rotation.set(nrm.z * tilt, rnd.float(0, Math.PI * 2), -nrm.x * tilt);
      if (kind === 'wood') dummy.scale.setScalar(s);
      else dummy.scale.set(s * rnd.float(0.8, 1.25), s * rnd.float(0.75, 1.2), s * rnd.float(0.8, 1.25));
      dummy.updateMatrix();
      col.setHSL(0.09 + rnd.float(-0.02, 0.02), rnd.float(0.04, 0.12), rnd.float(0.62, 0.86));
      (kind === 'pile' ? c.piles : kind === 'wood' ? c.wood : c.rocks)[vi].push({ m: dummy.matrix.clone(), c: col.clone() });
      c.cx += x;
      c.cy += y;
      c.cz += z;
      c.n++;
      if (s > 0.6 && kind === 'rock') this.stones.push({ x, z, y, r: s * 0.85, h: s * (tops[vi] - sink) });
      if (kind === 'wood' && vi === 0) this.stones.push({ x, z, y, r: 0.55 * s, h: 0.5 * s });
    };

    // boulders: a grid of candidate cells, kept by slope/rockiness
    const cell = 7;
    const pCell = Math.min(1, (dens.rocks * qMul * cell * cell) / 10000);
    for (let gz = -half; gz < half; gz += cell) {
      for (let gx = -half; gx < half; gx += cell) {
        const h = hash2(gx | 0, gz | 0, 4242 + this.hunt.seed);
        if (h > pCell * 2.2) continue;
        const x = gx + hash2(gx | 0, gz | 0, 11) * cell;
        const z = gz + hash2(gx | 0, gz | 0, 13) * cell;
        if (terrain.road(x, z) < 4.5) continue;
        if (clearing && Math.hypot(x - clearing.x, z - clearing.z) < clearing.r + 2) continue;
        terrain.normal(x, z, nrm);
        const slope = 1 - nrm.y;
        const m = terrain.maskAt(x, z);
        // rocks gather on slopes and broken ground, less on ploughed fields
        const want = (0.35 + 1.6 * smoothstep(0.06, 0.35, slope) + 0.4 * m.snow) * (1 - 0.7 * m.field) * (terrain.height(x, z) < 2 ? 0 : 1);
        if (h > pCell * want) continue;
        const big = rnd.chance(dens.big);
        const s = big ? rnd.float(1.1, 2.2) : rnd.float(0.18, 0.75) * (rnd.chance(0.25) ? 1.6 : 1);
        add('rock', rnd.int(0, NV - 1), x, z, s, 0.6);
        // outcrops: a few smaller stones around a big one
        if (big || rnd.chance(0.2)) {
          for (let k = 0; k < rnd.int(2, 5); k++) {
            const a = rnd.float(0, Math.PI * 2);
            const d = s * rnd.float(0.9, 2.2);
            add('rock', rnd.int(0, NV - 1), x + Math.cos(a) * d, z + Math.sin(a) * d, s * rnd.float(0.2, 0.5), 0.6);
          }
        }
      }
    }
    // heaps of field stones on flat, open ground
    const pcell = 20;
    const pp = Math.min(1, (dens.piles * pcell * pcell) / 10000);
    for (let gz = -half; gz < half; gz += pcell) {
      for (let gx = -half; gx < half; gx += pcell) {
        if (hash2(gx | 0, gz | 0, 777 + this.hunt.seed) > pp) continue;
        const x = gx + hash2(gx | 0, gz | 0, 17) * pcell;
        const z = gz + hash2(gx | 0, gz | 0, 19) * pcell;
        if (terrain.road(x, z) < 5) continue;
        if (clearing && Math.hypot(x - clearing.x, z - clearing.z) < clearing.r + 3) continue;
        terrain.normal(x, z, nrm);
        const m = terrain.maskAt(x, z);
        if (nrm.y < 0.93 || m.forest > 0.5 || m.snow > 0.5) continue;
        add('pile', rnd.int(0, 1), x, z, rnd.float(0.8, 1.3), 0.2);
      }
    }

    // stumps and fallen trunks where the trees are
    if (wood) {
      const wcell = 16;
      const per = { forest: 3, highland: 1.5, terraces: 0.8, plain: 0 }[terrain.kind] || 0;
      const pw = Math.min(1, (per * qMul * wcell * wcell) / 10000);
      for (let gz = -half; gz < half; gz += wcell) {
        for (let gx = -half; gx < half; gx += wcell) {
          const h = hash2(gx | 0, gz | 0, 5151 + this.hunt.seed);
          if (h > pw) continue;
          const x = gx + hash2(gx | 0, gz | 0, 23) * wcell;
          const z = gz + hash2(gx | 0, gz | 0, 29) * wcell;
          if (terrain.road(x, z) < 5) continue;
          if (clearing && Math.hypot(x - clearing.x, z - clearing.z) < clearing.r + 3) continue;
          const m = terrain.maskAt(x, z);
          if (h > pw * m.forest * (1 - m.snow * 0.6)) continue;
          add('wood', rnd.chance(0.45) ? 0 : 1, x, z, rnd.float(0.75, 1.15), 0.9);
        }
      }
    }

    // one LOD per chunk: detailed rocks near, 20-triangle rocks far, and
    // small stones dropped beyond 260 m
    const shadows = this.T.shadows;
    for (const c of chunks.values()) {
      const cx = c.cx / c.n;
      const cy = c.cy / c.n;
      const cz = c.cz / c.n;
      const lod = new THREE.LOD();
      lod.position.set(cx, cy, cz);
      const near = new THREE.Group();
      const far = new THREE.Group();
      const build = (geo, list, m, castShadow) => {
        if (!list.length) return null;
        const im = new THREE.InstancedMesh(geo, m, list.length);
        const off = new THREE.Matrix4().makeTranslation(-cx, -cy, -cz);
        list.forEach((it, i) => {
          im.setMatrixAt(i, off.clone().multiply(it.m));
          im.setColorAt(i, it.c);
        });
        im.castShadow = castShadow;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        return im;
      };
      for (let v = 0; v < NV; v++) {
        const a = build(hiGeo[v], c.rocks[v], mat, shadows);
        if (a) near.add(a);
        const b = build(loGeo[v], c.rocks[v], mat, shadows);
        if (b) far.add(b);
      }
      for (let v = 0; v < 2; v++) {
        const a = build(pileGeo[v], c.piles[v], mat, shadows);
        if (a) near.add(a);
        const b = build(pileGeo[v], c.piles[v], mat, false);
        if (b) far.add(b);
        if (wood) {
          const w = build(wood[v].hi, c.wood[v], woodMat, shadows);
          if (w) near.add(w);
          const wl = build(wood[v].lo, c.wood[v], woodMat, false);
          if (wl) far.add(wl);
        }
      }
      lod.addLevel(near, 0);
      lod.addLevel(far, 150);
      lod.addLevel(new THREE.Group(), 700);
      this.group.add(lod);
    }
    scene.add(this.group);
  }
}
