import * as THREE from 'three';
import { Random, hash2, smoothstep } from '../core/rng.js';
import { loadTex } from '../core/assets.js';
import { bleedTexture } from './foliageTextures.js';
import { rockGeometry, stoneMaterial, rockLibrary } from './rocks.js';
import { loadModel } from './models.js';

// Ground detail that only matters close to the hunter, rebuilt as you walk:
// pebbles and gravel (photo-scanned stones), fallen dry branches under the
// trees, and dry thistles in the fields.

const CELL = 4;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

// Dry Syrian thistle (Notobasis syriaca) as it stands in autumn: pale stems,
// spiny grey-green leaves gone brown, a few faded purple heads.
function thistleTexture(seed) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  const r = new Random(seed);
  const stems = r.int(3, 5);
  const tips = [];
  for (let i = 0; i < stems; i++) {
    const x0 = S / 2 + r.float(-14, 14);
    const lean = r.float(-50, 50);
    const h = r.float(0.55, 0.95) * S;
    const x1 = x0 + lean;
    const y1 = S - h;
    ctx.strokeStyle = `hsl(${r.float(36, 44)},${r.float(22, 34)}%,${r.float(52, 66)}%)`;
    ctx.lineWidth = r.float(2.5, 4);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, S);
    ctx.quadraticCurveTo(x0 + lean * 0.2, S - h * 0.5, x1, y1);
    ctx.stroke();
    // spiny leaves along the stem
    for (let k = 0; k < 6; k++) {
      const t = 0.15 + k * 0.12;
      const lx = x0 + (x1 - x0) * t * t + lean * 0.2 * t * (1 - t) * 2;
      const ly = S - h * t;
      const side = k % 2 ? 1 : -1;
      const len = r.float(18, 34) * (1 - t * 0.5);
      ctx.fillStyle = `hsl(${r.float(40, 70)},${r.float(12, 26)}%,${r.float(34, 50)}%)`;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      for (let j = 0; j <= 6; j++) {
        const u = j / 6;
        const sp = j % 2 ? 9 : 2;
        ctx.lineTo(lx + side * len * u, ly - len * 0.45 * u + (j % 2 ? -sp : sp) * (1 - u));
      }
      ctx.lineTo(lx + side * len * 0.2, ly + 4);
      ctx.closePath();
      ctx.fill();
    }
    tips.push([x1, y1]);
  }
  for (const [x, y] of tips) {
    const dry = r.chance(0.6);
    const R = r.float(7, 11);
    ctx.strokeStyle = dry ? 'hsl(38,30%,58%)' : 'hsl(300,24%,48%)';
    ctx.lineWidth = 1.4;
    for (let a = 0; a < Math.PI * 2; a += 0.35) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * R * 1.5, y + Math.sin(a) * R * 1.5);
      ctx.stroke();
    }
    ctx.fillStyle = dry ? 'hsl(40,26%,52%)' : 'hsl(296,30%,42%)';
    ctx.beginPath();
    ctx.arc(x, y, R, 0, Math.PI * 2);
    ctx.fill();
    // fluffy seed head on the dry ones
    if (dry) {
      ctx.fillStyle = 'rgba(245,240,228,0.95)';
      ctx.beginPath();
      ctx.ellipse(x, y - R * 0.8, R * 0.9, R * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return bleedTexture(c);
}

function crossCards(w, h) {
  const g = new THREE.BufferGeometry();
  const pos = [];
  const uv = [];
  const idx = [];
  for (let p = 0; p < 2; p++) {
    const a = (p / 2) * Math.PI;
    const cx = Math.cos(a) * w * 0.5;
    const cz = Math.sin(a) * w * 0.5;
    const b = pos.length / 3;
    pos.push(-cx, 0, -cz, cx, 0, cz, cx, h, cz, -cx, h, -cz);
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

// Several instanced shapes filled together, each instance going to one of
// them (stones of different shapes, branches of different lengths).
class Scatter {
  constructor(scene, geos, mat, cap, shadows) {
    const per = Math.ceil(cap / geos.length) + 16;
    this.meshes = geos.map((g) => {
      const m = new THREE.InstancedMesh(g, mat, per);
      m.count = 0;
      m.frustumCulled = false;
      m.receiveShadow = true;
      m.castShadow = shadows;
      scene.add(m);
      return m;
    });
    this.n = this.meshes.map(() => 0);
    this.per = per;
  }
  begin() {
    this.n.fill(0);
  }
  add(k, matrix, color) {
    const i = k % this.meshes.length;
    if (this.n[i] >= this.per) return false;
    const m = this.meshes[i];
    m.setMatrixAt(this.n[i], matrix);
    if (color) m.setColorAt(this.n[i], color);
    this.n[i]++;
    return true;
  }
  end() {
    this.meshes.forEach((m, i) => {
      m.count = this.n[i];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
  }
}

export class NearGround {
  constructor(hunt, terrain, T) {
    this.hunt = hunt;
    this.terrain = terrain;
    this.T = T;
    this.kind = terrain.kind;
    this.center = new THREE.Vector2(1e9, 1e9);
    const d = T.detail;
    this.radius = 22 + 14 * d;
    this.pebblesPerCell = { highland: 9, terraces: 6, forest: 3, plain: 4 }[this.kind] * d;
    this.thistlesPerCell = { plain: 0.9, terraces: 0.5, forest: 0.1, highland: 0.15 }[this.kind] * d;
    // fallen branches per cell under full tree cover
    this.branchesPerCell = { forest: 0.9, highland: 0.5, terraces: 0.35, plain: 0.1 }[this.kind] * d;
  }

  async build(scene) {
    const T = this.T;
    const [rockD, barkD, lib, wood] = await Promise.all([
      loadTex('rocky_terrain_02_diff.jpg', true),
      loadTex('bark_brown_02_diff.jpg', true),
      rockLibrary(),
      loadModel('deadwood/branches'),
    ]);
    const pebMat = stoneMaterial(rockD, 1.6, 0xcfc8bc, 0.92, 5.5, !!lib);
    const R = this.radius;
    this.pebCap = Math.ceil(((Math.PI * R * R) / (CELL * CELL)) * this.pebblesPerCell * 1.6) + 50;
    const stones = lib ? lib.small : [rockGeometry(this.hunt.seed + 5, 0, 0.6)];
    this.pebbles = new Scatter(scene, stones, pebMat, this.pebCap, false);
    if (wood) {
      // weathered grey deadwood: the bark photo as grain, its occlusion baked in
      const geos = wood.map((w) => {
        const g = w.geometry;
        g.computeBoundingBox();
        const b = g.boundingBox;
        g.translate(-(b.min.x + b.max.x) / 2, -b.min.y - 0.02, -(b.min.z + b.max.z) / 2);
        return g;
      });
      const woodMat = stoneMaterial(barkD, 2.2, 0xa89a88, 0.95, 3.2, true);
      this.brCap = Math.ceil(((Math.PI * R * R) / (CELL * CELL)) * this.branchesPerCell * 1.3) + 10;
      this.branches = new Scatter(scene, geos, woodMat, this.brCap, T.shadows);
    }

    const tex = thistleTexture(this.hunt.seed + 31);
    const thMat = new THREE.MeshStandardMaterial({
      map: tex,
      alphaTest: 0.45,
      alphaToCoverage: T.msaa > 0,
      side: THREE.DoubleSide,
      roughness: 0.95,
    });
    thMat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        '#include <normal_fragment_begin>\n normal = normalize(vNormal); nonPerturbedNormal = normal;'
      );
    };
    this.thCap = Math.ceil(((Math.PI * R * R) / (CELL * CELL)) * this.thistlesPerCell * 1.5) + 20;
    this.thistles = new THREE.InstancedMesh(crossCards(0.9, 1), thMat, this.thCap);
    this.thistles.count = 0;
    this.thistles.frustumCulled = false;
    this.thistles.castShadow = T.shadows;
    this.thistles.receiveShadow = true;
    scene.add(this.thistles);

  }

  update(pos) {
    if (!this.pebbles || this.center.distanceTo(new THREE.Vector2(pos.x, pos.z)) < 5) return;
    this.center.set(pos.x, pos.z);
    this.rebuildScatter(pos);
  }

  rebuildScatter(pos) {
    const t = this.terrain;
    const R = this.radius;
    const seed = this.hunt.seed + 313;
    const nrm = new THREE.Vector3();
    let np = 0;
    let nt = 0;
    let nb = 0;
    this.pebbles.begin();
    if (this.branches) this.branches.begin();
    const c0x = Math.floor((pos.x - R) / CELL), c1x = Math.floor((pos.x + R) / CELL);
    const c0z = Math.floor((pos.z - R) / CELL), c1z = Math.floor((pos.z + R) / CELL);
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const mx = cx * CELL + CELL / 2;
        const mz = cz * CELL + CELL / 2;
        const d2 = (mx - pos.x) ** 2 + (mz - pos.z) ** 2;
        if (d2 > R * R) continue;
        const m = t.maskAt(mx, mz);
        const road = t.road(mx, mz);
        // gravel on the track, stones on rocky slopes, fewer in leaf litter
        let peb = this.pebblesPerCell * (1 - 0.6 * m.forest) * (1 - m.snow) * (road < 2.5 ? 1.8 : 1);
        const far = Math.sqrt(d2) / R;
        for (let i = 0; i < peb && np < this.pebCap; i++) {
          const x = cx * CELL + hash2(cx, cz, i * 5 + seed) * CELL;
          const z = cz * CELL + hash2(cx, cz, i * 5 + 1 + seed) * CELL;
          const h = hash2(cx, cz, i * 5 + 2 + seed);
          const s = (0.035 + h * h * 0.12) * (road < 2.5 ? 0.7 : 1);
          if (far > 0.6 && s < 0.06) continue; // tiny gravel only near the feet
          t.normal(x, z, nrm);
          _q.setFromUnitVectors(UP, nrm).multiply(new THREE.Quaternion().setFromAxisAngle(UP, h * 40));
          _p.set(x, t.height(x, z) - s * 0.25, z);
          _s.set(s * (0.8 + h * 0.5), s * 0.8, s);
          _m.compose(_p, _q, _s);
          _c.setHSL(0.08 + h * 0.04, 0.1, 0.55 + hash2(cx, cz, i * 5 + 3 + seed) * 0.35);
          this.pebbles.add(Math.floor(h * 97), _m, _c);
          np++;
        }
        // dry branches fallen under the trees
        if (this.branches) {
          const nbr = this.branchesPerCell * m.forest * (1 - m.snow * 0.7) * (road < 3 ? 0 : 1);
          for (let i = 0; i < 2 && nb < this.brCap; i++) {
            if (hash2(cx, cz, i * 11 + seed + 90) > nbr - i) continue;
            const x = cx * CELL + hash2(cx, cz, i * 11 + 91 + seed) * CELL;
            const z = cz * CELL + hash2(cx, cz, i * 11 + 92 + seed) * CELL;
            const h = hash2(cx, cz, i * 11 + 93 + seed);
            t.normal(x, z, nrm);
            _q.setFromUnitVectors(UP, nrm).multiply(new THREE.Quaternion().setFromAxisAngle(UP, h * 40));
            _p.set(x, t.height(x, z) - 0.015, z);
            const sc = 0.7 + h * 0.6;
            _s.set(sc, sc, sc);
            _m.compose(_p, _q, _s);
            _c.setHSL(0.08, 0.08, 0.75 + h * 0.3);
            this.branches.add(Math.floor(h * 31), _m, _c);
            nb++;
          }
        }
        // thistles grow in patches on open, dry ground
        const patch = smoothstep(0.55, 0.8, hash2(Math.floor(cx / 4), Math.floor(cz / 4), seed + 9));
        const th = this.thistlesPerCell * patch * (1 - m.forest) * (1 - m.snow) * (road < 3 ? 0 : 1) * 3;
        for (let i = 0; i < th && nt < this.thCap; i++) {
          if (hash2(cx, cz, i * 7 + seed + 50) > th - i) continue;
          const x = cx * CELL + hash2(cx, cz, i * 7 + 51 + seed) * CELL;
          const z = cz * CELL + hash2(cx, cz, i * 7 + 52 + seed) * CELL;
          t.normal(x, z, nrm);
          if (nrm.y < 0.8) continue;
          const h = hash2(cx, cz, i * 7 + 53 + seed);
          _q.setFromAxisAngle(UP, h * 9);
          _p.set(x, t.height(x, z) - 0.03, z);
          const s = 0.55 + h * 0.5;
          _s.set(s, s * (0.8 + h * 0.4), s);
          _m.compose(_p, _q, _s);
          this.thistles.setMatrixAt(nt, _m);
          _c.setHSL(0.1, 0.1, 0.8 + h * 0.2);
          this.thistles.setColorAt(nt, _c);
          nt++;
        }
      }
    }
    this.pebbles.end();
    if (this.branches) this.branches.end();
    this.thistles.instanceMatrix.needsUpdate = true;
    if (this.thistles.instanceColor) this.thistles.instanceColor.needsUpdate = true;
    this.thistles.count = nt;
  }
}
