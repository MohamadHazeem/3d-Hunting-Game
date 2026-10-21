import * as THREE from 'three';
import { Noise2D, clamp, smoothstep, lerp } from '../core/rng.js';
import { loadTex } from '../core/assets.js';
import { tierSettings } from '../gfx/quality.js';
import { wetness } from './shading.js';

// The playable core is a high-resolution heightfield; around it a coarse
// ring of terrain stretches out to the horizon so you see real mountain
// ranges (and the sea on the coast hunts).

export const CORE_SIZE = 1000;
export const PLAY_RADIUS = 430;
const OUTER_SIZE = 16000;
// the far woods: a cover map round the hunting ground that both the far
// terrain's colour and the far tree cards (vegetation.js) follow
export const FAR_COVER_SIZE = 6000;
const FAR_COVER_RES = 384;
const MASK_RES = 256;
// terraces: height of one step, and where in each step the riser begins
const TERRACE_STEP = 1.7;
const RISER_START = 0.86;

export class Terrain {
  constructor(hunt, quality) {
    this.hunt = hunt;
    this.kind = hunt.terrain.kind;
    this.noise = new Noise2D(hunt.seed);
    this.noise2 = new Noise2D(hunt.seed * 7 + 3);
    this.N = { low: 360, medium: 560, high: 760, ultra: 880 }[quality] || 760;
    // far ring resolution: finer on strong GPUs so distant ridges aren't faceted
    this.outerRes = { low: [240, 360], medium: [280, 480], high: [320, 640], ultra: [360, 800] }[quality] || [240, 360];
    this.castShadows = tierSettings(quality).shadows;
    this.step = CORE_SIZE / this.N;
    this.heights = null;
    this.mask = null; // RGBA: forest, field, terrace, snow
    this.road = this.makeRoad();
  }

  // ---------- height function ----------
  rawHeight(x, z) {
    const n = this.noise;
    const t = this.hunt.terrain;
    const r = Math.hypot(x, z);
    let h = t.baseHeight;
    if (this.kind === 'plain') {
      h += t.relief * (0.7 * n.fbm(x / 700, z / 700, 4) + 0.3 * n.fbm(x / 160, z / 160, 3));
      // Mount Lebanon to the west, Anti-Lebanon to the east.
      const ax = Math.abs(x + 120 * n.noise(z / 2500, 3.3));
      const m = smoothstep(650, 2600, ax);
      h += m * 1700 * (0.35 + 0.65 * this.mountain(x, z, 2200));
      h += smoothstep(380, 900, ax) * 60 * (0.5 + 0.5 * n.fbm(x / 300, z / 300, 3));
    } else if (this.kind === 'terraces') {
      h += t.relief * (0.65 * n.fbm(x / 420, z / 420, 5) + 0.35 * n.ridged(x / 260, z / 260, 4));
      h += x * 0.11; // the land climbs eastwards from the coast
      if (t.seaWest) {
        h -= smoothstep(-900, -3200, x) * (t.baseHeight + 230);
      }
      h += smoothstep(900, 5200, x) * 2300 * (0.4 + 0.6 * this.mountain(x, z, 2600));
    } else if (this.kind === 'forest') {
      h += t.relief * (0.6 * n.fbm(x / 380, z / 380, 5) + 0.4 * n.ridged(x / 520, z / 520, 4));
      h += smoothstep(700, 3800, r) * 1400 * (0.3 + 0.7 * this.mountain(x, z, 2200));
    } else {
      // highland: broken limestone ridges with high peaks around.
      h += t.relief * (0.5 * n.fbm(x / 350, z / 350, 5) + 0.5 * n.ridged(x / 300, z / 300, 5));
      h += smoothstep(600, 3200, r) * 1400 * (0.35 + 0.65 * this.mountain(x, z, 2000));
    }
    // fine roughness
    h += 1.2 * this.noise2.fbm(x / 22, z / 22, 3);
    return h;
  }

  // Rounded mountain ranges with soft ridge lines (0..1).
  mountain(x, z, s) {
    const n = this.noise;
    // a softened |f| rounds the crests: massive limestone ridges, not teeth
    const f = n.fbm(x / s, z / s, 4);
    const a = 1 - Math.sqrt(f * f + 0.006);
    const b = n.fbm(x / (s * 0.6) + 9, z / (s * 0.6) - 4, 3) * 0.5 + 0.5;
    return a * a * 0.65 + b * 0.35;
  }

  makeRoad() {
    // A winding dirt track crossing the hunting ground.
    const n = new Noise2D(this.hunt.seed + 99);
    return (x, z) => {
      const cz = 140 * n.noise(x / 600, 0.5) + 40 * n.noise(x / 170, 1.7) - 60;
      return Math.abs(z - cz);
    };
  }

  terraceMaskAt(x, z, slope) {
    if (this.kind !== 'terraces') return 0;
    const m = smoothstep(-0.25, 0.1, this.noise2.fbm(x / 260, z / 260, 3));
    return m * smoothstep(0.04, 0.12, slope) * (1 - smoothstep(0.55, 0.8, slope));
  }

  generate(onProgress) {
    const N = this.N;
    const S = CORE_SIZE;
    const step = this.step;
    const half = S / 2;
    const raw = new Float32Array((N + 1) * (N + 1));
    for (let j = 0; j <= N; j++) {
      const z = -half + j * step;
      for (let i = 0; i <= N; i++) {
        raw[j * (N + 1) + i] = this.rawHeight(-half + i * step, z);
      }
      if (onProgress && j % 40 === 0) onProgress(0.5 * (j / N));
    }
    this.rawGrid = raw;

    // Terraces: quantise the height on gentle-moderate slopes, leaving a
    // short steep riser that the shader paints as a dry-stone wall.
    const H = new Float32Array(raw.length);
    const terrace = new Float32Array(raw.length);
    const stepH = TERRACE_STEP;
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        const k = j * (N + 1) + i;
        const h = raw[k];
        const i0 = Math.max(0, i - 2), i1 = Math.min(N, i + 2);
        const j0 = Math.max(0, j - 2), j1 = Math.min(N, j + 2);
        const gx = (raw[j * (N + 1) + i1] - raw[j * (N + 1) + i0]) / ((i1 - i0) * step);
        const gz = (raw[j1 * (N + 1) + i] - raw[j0 * (N + 1) + i]) / ((j1 - j0) * step);
        const slope = Math.hypot(gx, gz);
        const x = -half + i * step;
        const z = -half + j * step;
        let tm = this.terraceMaskAt(x, z, slope);
        // keep the track flat-ish and un-terraced
        tm *= smoothstep(4, 9, this.road(x, z));
        terrace[k] = tm;
        if (tm > 0) {
          const t = h / stepH;
          const f = t - Math.floor(t);
          const q = (Math.floor(t) + smoothstep(RISER_START, 1.0, f)) * stepH;
          H[k] = lerp(h, q, tm);
        } else {
          H[k] = h;
        }
      }
      if (onProgress && j % 40 === 0) onProgress(0.5 + 0.3 * (j / N));
    }
    // Flatten the road bed slightly by smoothing heights along it.
    this.heights = H;
    this.terraceGrid = terrace;
    this.buildMasks();
    if (onProgress) onProgress(0.9);
  }

  buildMasks() {
    const M = MASK_RES;
    const data = new Uint8Array(M * M * 4);
    const n = this.noise2;
    const kind = this.kind;
    const half = CORE_SIZE / 2;
    this.maskData = new Float32Array(M * M * 4);
    for (let j = 0; j < M; j++) {
      for (let i = 0; i < M; i++) {
        const x = -half + ((i + 0.5) / M) * CORE_SIZE;
        const z = -half + ((j + 0.5) / M) * CORE_SIZE;
        const h = this.height(x, z);
        const nrm = this.normal(x, z);
        const slope = 1 - nrm.y;
        const terr = this.sampleGrid(this.terraceGrid, x, z);
        const road = 1 - smoothstep(2.2, 4.2, this.road(x, z));
        const f1 = n.fbm(x / 210 + 11, z / 210 - 7, 4);
        const f2 = n.fbm(x / 70 - 3, z / 70 + 5, 3);
        let forest = 0;
        let field = 0;
        let snow = 0;
        if (kind === 'plain') {
          // mostly stubble (grass layer); some ploughed red-soil fields
          field = 0.85 * smoothstep(0.1, 0.35, f1) * (1 - smoothstep(0.35, 0.6, f2 + 0.2 * f1));
          forest = smoothstep(0.55, 0.75, f2) * 0.4;
        } else if (kind === 'terraces') {
          field = terr * 0.85 * smoothstep(-0.4, 0.0, f2);
          forest = (1 - terr) * smoothstep(-0.15, 0.25, f1) * smoothstep(0.03, 0.15, slope);
        } else if (kind === 'forest') {
          forest = smoothstep(-0.45, -0.1, f1) * (0.75 + 0.25 * smoothstep(-0.3, 0.3, f2));
          field = (1 - forest) * smoothstep(0.1, 0.4, f2) * 0.5;
        } else {
          forest = smoothstep(-0.05, 0.35, f1) * 0.85;
          field = 0;
          const north = clamp(-nrm.z * 0.5 + 0.5, 0, 1);
          snow = smoothstep(0.3, 0.65, n.fbm(x / 90, z / 90, 4) * 0.8 + north * 0.35 + (h - this.hunt.terrain.baseHeight - 60) / 260);
        }
        field = Math.max(field, road);
        forest *= 1 - road;
        const k = (j * M + i) * 4;
        this.maskData[k] = forest;
        this.maskData[k + 1] = field;
        this.maskData[k + 2] = terr;
        this.maskData[k + 3] = snow;
        data[k] = clamp(forest * 255, 0, 255);
        data[k + 1] = clamp(field * 255, 0, 255);
        data[k + 2] = clamp(terr * 255, 0, 255);
        data[k + 3] = clamp(snow * 255, 0, 255);
      }
    }
    const tex = new THREE.DataTexture(data, M, M, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    this.maskTex = tex;
  }

  // forest, field, terrace, snow in [0,1]
  maskAt(x, z) {
    const M = MASK_RES;
    const u = clamp(((x + CORE_SIZE / 2) / CORE_SIZE) * M - 0.5, 0, M - 1);
    const v = clamp(((z + CORE_SIZE / 2) / CORE_SIZE) * M - 0.5, 0, M - 1);
    const i = Math.floor(u);
    const j = Math.floor(v);
    const k = (j * M + i) * 4;
    const d = this.maskData;
    return { forest: d[k], field: d[k + 1], terrace: d[k + 2], snow: d[k + 3] };
  }

  sampleGrid(grid, x, z) {
    const N = this.N;
    const fx = clamp((x + CORE_SIZE / 2) / this.step, 0, N - 0.0001);
    const fz = clamp((z + CORE_SIZE / 2) / this.step, 0, N - 0.0001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const tx = fx - i;
    const tz = fz - j;
    const w = N + 1;
    const a = grid[j * w + i];
    const b = grid[j * w + i + 1];
    const c = grid[(j + 1) * w + i];
    const d = grid[(j + 1) * w + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  inCore(x, z) {
    const h = CORE_SIZE / 2 - 1;
    return x > -h && x < h && z > -h && z < h;
  }

  height(x, z) {
    if (this.heights && this.inCore(x, z)) return this.sampleGrid(this.heights, x, z);
    return this.rawHeight(x, z);
  }

  normal(x, z, out = new THREE.Vector3()) {
    const e = this.step;
    const hl = this.height(x - e, z);
    const hr = this.height(x + e, z);
    const hd = this.height(x, z - e);
    const hu = this.height(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  // ---------- meshes ----------
  // How wooded the land round the hunting ground is (0..1): patches of forest
  // or scattered trees by kind of country, none above the tree line, on
  // cliffs or by the sea.
  buildFarCover() {
    const R = FAR_COVER_RES;
    const S = FAR_COVER_SIZE;
    const n = this.noise2;
    const amount = { forest: 0.62, terraces: 0.42, highland: 0.36, plain: 0.12 }[this.kind] ?? 0.3;
    const data = new Uint8Array(R * R);
    this.farCover = new Float32Array(R * R);
    const e = S / R;
    const H = new Float32Array(R * R);
    for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) H[j * R + i] = this.rawHeight(-S / 2 + (i + 0.5) * e, -S / 2 + (j + 0.5) * e);
    // the share of the country under trees sets the noise threshold
    const c0 = 0.5 + (0.5 - amount) * 0.35;
    for (let j = 0; j < R; j++) {
      for (let i = 0; i < R; i++) {
        const x = -S / 2 + (i + 0.5) * e;
        const z = -S / 2 + (j + 0.5) * e;
        const h = H[j * R + i];
        const sl = Math.hypot(H[j * R + Math.min(R - 1, i + 1)] - h, H[Math.min(R - 1, j + 1) * R + i] - h) / e;
        const f = n.fbm(x / 520 + 17, z / 520 - 5, 4) * 0.75 + n.fbm(x / 130, z / 130, 2) * 0.25;
        let c = smoothstep(c0 - 0.06, c0 + 0.06, f * 0.5 + 0.5);
        c *= 1 - smoothstep(1500, 1950, h); // tree line
        c *= 1 - smoothstep(0.45, 0.8, sl); // cliffs
        c *= smoothstep(4, 12, h); // not on the beach
        this.farCover[j * R + i] = c;
        data[j * R + i] = Math.round(c * 255);
      }
    }
    const t = new THREE.DataTexture(data, R, R, THREE.RedFormat);
    t.magFilter = t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    this.farCoverTex = t;
  }

  farCoverAt(x, z) {
    const R = FAR_COVER_RES;
    const i = Math.floor((x / FAR_COVER_SIZE + 0.5) * R);
    const j = Math.floor((z / FAR_COVER_SIZE + 0.5) * R);
    if (!this.farCover || i < 0 || j < 0 || i >= R || j >= R) return 0;
    return this.farCover[j * R + i];
  }

  // Height of the drawn far ring (its triangles, not the smooth function),
  // so things placed on it sit on the ground you see.
  farHeight(x, z) {
    const o = this.outer;
    if (!o) return this.rawHeight(x, z);
    const r = Math.hypot(x, z);
    const t = Math.pow(Math.max(0, (r - 380) / (OUTER_SIZE / 2)), 1 / 2.2);
    const fr = Math.min(o.RN - 1e-4, t * o.RN);
    let ang = Math.atan2(z, x);
    if (ang < 0) ang += Math.PI * 2;
    const fa = (ang / (Math.PI * 2)) * o.AN;
    const i = Math.floor(fr);
    const j = Math.floor(fa) % o.AN;
    const j1 = (j + 1) % o.AN;
    const u = fr - i;
    const v = fa - Math.floor(fa);
    const H = o.h;
    const h00 = H[i * o.AN + j], h01 = H[i * o.AN + j1], h10 = H[(i + 1) * o.AN + j], h11 = H[(i + 1) * o.AN + j1];
    // the quad's two triangles: (a0, a1, b0) and (a1, b1, b0)
    if (u + v <= 1) return h00 + v * (h01 - h00) + u * (h10 - h00);
    return h11 + (1 - v) * (h10 - h11) + (1 - u) * (h01 - h11);
  }

  async buildMeshes(scene) {
    this.buildFarCover();
    const mat = await this.makeMaterial(true);
    const matOuter = await this.makeMaterial(false);

    // Core, split into tiles so the camera and the sharp shadow map only draw
    // the pieces they can see. The ground casts shadows too: hills and
    // terrace risers shade the land behind them when the sun is low.
    scene.userData.terrain = this;
    const N = this.N;
    const w = N + 1;
    const half = CORE_SIZE / 2;
    const H = this.heights;
    const TILES = 8;
    const per = N / TILES;
    const tw = per + 1;
    this.tiles = [];
    for (let ty = 0; ty < TILES; ty++) {
      for (let tx = 0; tx < TILES; tx++) {
        const pos = new Float32Array(tw * tw * 3);
        const nor = new Float32Array(tw * tw * 3);
        for (let jj = 0; jj <= per; jj++) {
          const j = ty * per + jj;
          for (let ii = 0; ii <= per; ii++) {
            const i = tx * per + ii;
            const k = j * w + i;
            const o = (jj * tw + ii) * 3;
            pos[o] = -half + i * this.step;
            pos[o + 1] = H[k];
            pos[o + 2] = -half + j * this.step;
            const hl = H[j * w + Math.max(0, i - 1)];
            const hr = H[j * w + Math.min(N, i + 1)];
            const hd = H[Math.max(0, j - 1) * w + i];
            const hu = H[Math.min(N, j + 1) * w + i];
            const nx = hl - hr;
            const ny = 2 * this.step;
            const nz = hd - hu;
            const l = Math.hypot(nx, ny, nz);
            nor[o] = nx / l;
            nor[o + 1] = ny / l;
            nor[o + 2] = nz / l;
          }
        }
        const idx = new Uint32Array(per * per * 6);
        let p = 0;
        for (let j = 0; j < per; j++) {
          for (let i = 0; i < per; i++) {
            const a = j * tw + i;
            const b = a + 1;
            const c = a + tw;
            const d = c + 1;
            idx[p++] = a; idx[p++] = c; idx[p++] = b;
            idx[p++] = b; idx[p++] = c; idx[p++] = d;
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        geo.setIndex(new THREE.BufferAttribute(idx, 1));
        geo.computeBoundingSphere();
        geo.computeBoundingBox();
        const tile = new THREE.Mesh(geo, mat);
        tile.receiveShadow = true;
        tile.castShadow = this.castShadows;
        scene.add(tile);
        this.tiles.push(tile);
      }
    }

    // Outer ring (radial spacing grows with distance)
    const [RN, AN] = this.outerRes;
    const opos = [];
    const oidx = [];
    for (let r = 0; r <= RN; r++) {
      const t = r / RN;
      const rad = 380 + Math.pow(t, 2.2) * (OUTER_SIZE / 2);
      for (let a = 0; a < AN; a++) {
        const ang = (a / AN) * Math.PI * 2;
        const x = Math.cos(ang) * rad;
        const z = Math.sin(ang) * rad;
        let h = this.rawHeight(x, z);
        // drop below the core so the detailed mesh always wins
        if (Math.abs(x) < half - 2 && Math.abs(z) < half - 2) h -= 4;
        opos.push(x, h, z);
      }
    }
    for (let r = 0; r < RN; r++) {
      for (let a = 0; a < AN; a++) {
        const a0 = r * AN + a;
        const a1 = r * AN + ((a + 1) % AN);
        const b0 = a0 + AN;
        const b1 = a1 + AN;
        oidx.push(a0, a1, b0, a1, b1, b0);
      }
    }
    this.outer = { RN, AN, h: new Float32Array(opos.filter((_, k) => k % 3 === 1)) };
    const ogeo = new THREE.BufferGeometry();
    ogeo.setAttribute('position', new THREE.Float32BufferAttribute(opos, 3));
    ogeo.setIndex(oidx);
    ogeo.computeVertexNormals();
    const outer = new THREE.Mesh(ogeo, matOuter);
    outer.receiveShadow = false;
    scene.add(outer);
    this.outerMesh = outer;

    if (this.kind === 'terraces') await this.buildTerraceWalls(scene);
    if (this.hunt.terrain.seaWest) this.buildSea(scene);
  }

  // Dry-stone terrace walls (سناسل): a vertical stone face along the middle
  // of every riser, from the lower bed up to the upper bed, with a flat cap
  // reaching back over the bank. Traced as contour lines of the raw height
  // (marching squares) and built per terrain tile; hidden beyond ~280 m where
  // the ground texture's wall pattern takes over.
  async buildTerraceWalls(scene) {
    const [wallD, wallN] = await Promise.all([loadTex('stacked_stone_wall_diff.jpg', true), loadTex('stacked_stone_wall_nor_gl.jpg')]);
    const mat = new THREE.MeshStandardMaterial({ map: wallD, normalMap: wallN, roughness: 0.95, color: 0xffffff });
    // the photo is of reddish sandstone; Lebanese walls are pale limestone
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWet = wetness;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uWet;')
        .replace(
          '#include <map_fragment>',
          `#include <map_fragment>
          float wl = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          diffuseColor.rgb = mix(vec3(wl), diffuseColor.rgb, 0.35) * vec3(1.32, 1.28, 1.2) * (1.0 - 0.3 * uWet);`
        )
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.5, uWet * 0.7);');
    };
    mat.customProgramCacheKey = () => 'terrace-wall';
    const N = this.N;
    const w = N + 1;
    const step = this.step;
    const half = CORE_SIZE / 2;
    const raw = this.rawGrid;
    const stepH = TERRACE_STEP;
    const mid = (RISER_START + 1) / 2; // riser centre, as a fraction of a step
    const TILES = 8;
    const per = N / TILES;
    const tileSize = CORE_SIZE / TILES;
    const UVS = 1 / 2.2; // texture repeats every 2.2 m
    this.wallGroup = new THREE.Group();
    const lerpEdge = (va, vb, iso) => (iso - va) / (vb - va || 1e-6);
    for (let ty = 0; ty < TILES; ty++) {
      for (let tx = 0; tx < TILES; tx++) {
        const pos = [];
        const nor = [];
        const uv = [];
        const quad = (a, b, c, d, n, ua, ub, va, vb) => {
          pos.push(...a, ...b, ...c, ...a, ...c, ...d);
          for (let k = 0; k < 6; k++) nor.push(...n);
          uv.push(ua, va, ub, va, ub, vb, ua, va, ub, vb, ua, vb);
        };
        for (let jj = 0; jj < per; jj++) {
          const j = ty * per + jj;
          for (let ii = 0; ii < per; ii++) {
            const i = tx * per + ii;
            const x0 = -half + i * step;
            const z0 = -half + j * step;
            const tm = this.terraceGrid[j * w + i];
            if (tm < 0.72 || this.road(x0 + step / 2, z0 + step / 2) < 6) continue;
            const a = raw[j * w + i];
            const b = raw[j * w + i + 1];
            const c = raw[(j + 1) * w + i + 1];
            const d = raw[(j + 1) * w + i];
            const lo = Math.min(a, b, c, d);
            const hi = Math.max(a, b, c, d);
            // gradient (uphill) across the cell
            const gx = (b - a + c - d) / (2 * step);
            const gz = (d - a + c - b) / (2 * step);
            const gl = Math.hypot(gx, gz);
            if (gl < 0.02) continue;
            const nx = -gx / gl;
            const nz = -gz / gl; // faces downhill
            for (let k = Math.floor(lo / stepH - mid); k <= Math.floor(hi / stepH - mid) + 1; k++) {
              const iso = (k + mid) * stepH;
              if (iso <= lo || iso >= hi) continue;
              // marching squares: crossing points on the cell's four edges
              const pts = [];
              if ((a < iso) !== (b < iso)) pts.push([x0 + step * lerpEdge(a, b, iso), z0]);
              if ((b < iso) !== (c < iso)) pts.push([x0 + step, z0 + step * lerpEdge(b, c, iso)]);
              if ((d < iso) !== (c < iso)) pts.push([x0 + step * lerpEdge(d, c, iso), z0 + step]);
              if ((a < iso) !== (d < iso)) pts.push([x0, z0 + step * lerpEdge(a, d, iso)]);
              if (pts.length < 2) continue;
              const segs = pts.length === 4 ? [[pts[0], pts[1]], [pts[2], pts[3]]] : [[pts[0], pts[1]]];
              const low = k * stepH;
              const top = ((k + 1) * stepH) * tm + iso * (1 - tm) + 0.06;
              const bot = low * tm + iso * (1 - tm) - 0.45;
              // cap reaches back over the bank to where it meets the upper bed
              const capD = Math.min(1.6, Math.max(0.55, ((1 - mid) * stepH) / gl + 0.15));
              for (let [p, q] of segs) {
                // wind the face so it looks downhill
                const ex = q[0] - p[0];
                const ez = q[1] - p[1];
                if (ex * nz - ez * nx < 0) [p, q] = [q, p];
                const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
                const u0 = (p[0] + p[1]) * UVS;
                const u1 = u0 + len * UVS;
                // front face
                quad([p[0], bot, p[1]], [q[0], bot, q[1]], [q[0], top, q[1]], [p[0], top, p[1]], [nx, 0, nz], u0, u1, bot * UVS, top * UVS);
                // cap
                const pb = [p[0] - nx * capD, top, p[1] - nz * capD];
                const qb = [q[0] - nx * capD, top, q[1] - nz * capD];
                quad([p[0], top, p[1]], [q[0], top, q[1]], qb, pb, [0, 1, 0], u0, u1, 0, capD * UVS);
              }
            }
          }
        }
        if (!pos.length) continue;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = this.castShadows;
        mesh.receiveShadow = true;
        const lod = new THREE.LOD();
        lod.position.set(-half + (tx + 0.5) * tileSize, this.hunt.terrain.baseHeight, -half + (ty + 0.5) * tileSize);
        mesh.position.copy(lod.position).negate();
        lod.addLevel(mesh, 0);
        lod.addLevel(new THREE.Object3D(), 280 + tileSize * 0.7);
        this.wallGroup.add(lod);
      }
    }
    scene.add(this.wallGroup);
  }

  buildSea(scene) {
    const geo = new THREE.PlaneGeometry(40000, 40000, 1, 1);
    geo.rotateX(-Math.PI / 2);
    // Two layers of small waves scrolling different ways: the base normal map
    // for the swell, the clear-coat normal map for the chop. With a near-mirror
    // clear coat the low sun scatters into a glittering path on the water.
    const normalTex = makeWaterNormal();
    normalTex.repeat.set(1400, 1400);
    const chop = normalTex.clone();
    chop.repeat.set(4200, 4200);
    chop.needsUpdate = true;
    const mat = new THREE.MeshPhysicalMaterial({
      color: 0x0d3048,
      roughness: 0.22,
      metalness: 0.0,
      normalMap: normalTex,
      normalScale: new THREE.Vector2(0.45, 0.45),
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      clearcoatNormalMap: chop,
      clearcoatNormalScale: new THREE.Vector2(0.6, 0.6),
      envMapIntensity: 1.0,
    });
    const sea = new THREE.Mesh(geo, mat);
    sea.position.set(0, 0, 0);
    scene.add(sea);
    this.sea = sea;
    this.seaNormal = normalTex;
    this.seaChop = chop;
  }

  update(dt) {
    if (this.seaNormal) {
      this.seaNormal.offset.x += dt * 0.0016;
      this.seaNormal.offset.y += dt * 0.001;
      this.seaChop.offset.x -= dt * 0.0011;
      this.seaChop.offset.y += dt * 0.0019;
    }
  }

  async makeMaterial(useMask) {
    const hunt = this.hunt;
    const soilName = 'red_dirt_mud_01';
    const [grassD, grassN, soilD, soilN, forD, forN, rockD, rockN, snowD, wallD, wallN] = await Promise.all([
      loadTex('aerial_grass_rock_diff.jpg', true),
      loadTex('aerial_grass_rock_nor_gl.jpg'),
      loadTex(`${soilName}_diff.jpg`, true),
      loadTex(`${soilName}_nor_gl.jpg`),
      loadTex('forest_leaves_02_diff.jpg', true),
      loadTex('forest_leaves_02_nor_gl.jpg'),
      loadTex('rocky_terrain_02_diff.jpg', true),
      loadTex('rocky_terrain_02_nor_gl.jpg'),
      loadTex('snow_02_diff.jpg', true),
      loadTex('stacked_stone_wall_diff.jpg', true),
      loadTex('stacked_stone_wall_nor_gl.jpg'),
    ]);
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
    const g = hunt.ground.grass;
    const uniforms = {
      tGrass: { value: grassD }, nGrass: { value: grassN },
      tSoil: { value: soilD }, nSoil: { value: soilN },
      tForest: { value: forD }, nForest: { value: forN },
      tRock: { value: rockD }, nRock: { value: rockN },
      tSnow: { value: snowD },
      tWall: { value: wallD }, nWall: { value: wallN },
      tMask: { value: this.maskTex },
      tFarCover: { value: this.farCoverTex },
      uFarCover: { value: FAR_COVER_SIZE },
      uCore: { value: CORE_SIZE },
      uGrassTint: { value: new THREE.Vector3(g[0], g[1], g[2]) },
      uSnowLine: { value: hunt.snow ? hunt.terrain.baseHeight + 420 : ({ November: 2500, December: 1850, January: 1600 })[hunt.month] || 99999 },
      uSea: { value: hunt.terrain.seaWest ? 1 : 0 },
      uWet: wetness,
    };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.defines = shader.defines || {};
      if (useMask) shader.defines.USE_TMASK = '';
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNor;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNor = normalize(mat3(modelMatrix) * objectNormal);'
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${TERRAIN_FRAG_PARS}`)
        .replace('#include <map_fragment>', TERRAIN_FRAG_MAP)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(mix(0.97, 0.55, wSnow), 0.5, wetK * 0.75);\nroughnessFactor = mix(roughnessFactor, 0.06, puddle);')
        .replace('#include <normal_fragment_maps>', TERRAIN_FRAG_NORMAL);
    };
    mat.customProgramCacheKey = () => (useMask ? 'terrain-core' : 'terrain-outer');
    return mat;
  }
}

const TERRAIN_FRAG_PARS = /* glsl */ `
varying vec3 vWPos;
varying vec3 vWNor;
uniform sampler2D tGrass, nGrass, tSoil, nSoil, tForest, nForest, tRock, nRock, tSnow, tWall, nWall, tMask, tFarCover;
uniform float uFarCover;
uniform float uCore, uSnowLine, uSea, uWet;
uniform vec3 uGrassTint;

float h21(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), f.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), f.x), f.y);
}
// Two differently-scaled, rotated lookups break up visible tiling.
vec3 sampleAT(sampler2D t, vec2 uv){
  vec3 a = texture2D(t, uv).rgb;
  vec2 uv2 = mat2(0.8, -0.6, 0.6, 0.8) * uv * 0.37 + 0.31;
  vec3 b = texture2D(t, uv2).rgb;
  float m = smoothstep(0.3, 0.7, vnoise(uv * 0.15));
  return mix(a, b, m * 0.6);
}
vec3 triplanar(sampler2D t, vec3 p, vec3 n, float s){
  vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
  return texture2D(t, p.zy * s).rgb * w.x + texture2D(t, p.xz * s).rgb * w.y + texture2D(t, p.xy * s).rgb * w.z;
}
vec3 triplanarN(sampler2D t, vec3 p, vec3 n, float s){
  vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z);
  vec3 tx = texture2D(t, p.zy * s).xyz * 2.0 - 1.0;
  vec3 ty = texture2D(t, p.xz * s).xyz * 2.0 - 1.0;
  vec3 tz = texture2D(t, p.xy * s).xyz * 2.0 - 1.0;
  return vec3(0.0, tx.y, tx.x) * sign(n.x) * w.x + vec3(ty.x, 0.0, ty.y) * w.y + vec3(tz.x, tz.y, 0.0) * sign(n.z) * w.z;
}
`;

const TERRAIN_FRAG_MAP = /* glsl */ `
vec3 gN = normalize(vWNor);
float slope = 1.0 - gN.y;
vec4 msk = vec4(0.0);
#ifdef USE_TMASK
  vec2 muv = vWPos.xz / uCore + 0.5;
  msk = texture2D(tMask, muv);
  float inside = step(0.0, muv.x) * step(muv.x, 1.0) * step(0.0, muv.y) * step(muv.y, 1.0);
  msk *= inside;
#endif
float macro = vnoise(vWPos.xz * 0.012) * 0.6 + vnoise(vWPos.xz * 0.05) * 0.4;
vec2 uvG = vWPos.xz / 7.0;
vec3 cGrass = sampleAT(tGrass, uvG) * uGrassTint * 1.55;
vec3 cSoil = sampleAT(tSoil, vWPos.xz / 5.0);
vec3 cForest = sampleAT(tForest, vWPos.xz / 4.0) * 0.95;
vec3 cRock = triplanar(tRock, vWPos, gN, 1.0 / 9.0) * vec3(1.08, 1.04, 0.98);
vec3 cWall = triplanar(tWall, vWPos, gN, 1.0 / 2.2);
vec3 cSnow = sampleAT(tSnow, vWPos.xz / 6.0);

float wForest = msk.r;
float wSoil = msk.g * (0.75 + 0.5 * macro);
float wWall = msk.b * smoothstep(0.22, 0.42, slope);
float wRock = (1.0 - msk.b) * smoothstep(0.28 + macro * 0.12, 0.5, slope);
#ifndef USE_TMASK
  wRock = smoothstep(0.22, 0.5, slope + macro * 0.15);
  // distant hillsides: scrub & pine cover reads as dark olive green
  float cover = smoothstep(0.35, 0.65, vnoise(vWPos.xz * 0.004) * 0.7 + macro * 0.3) * (1.0 - smoothstep(1700.0, 2200.0, vWPos.y));
  // nearer in, the woods follow the cover map the far tree cards stand on
  vec2 fcuv = vWPos.xz / uFarCover + 0.5;
  float fcIn = 1.0 - smoothstep(0.42, 0.5, max(abs(fcuv.x - 0.5), abs(fcuv.y - 0.5)));
  cover = mix(cover, texture2D(tFarCover, fcuv).r * (0.75 + 0.5 * macro), fcIn);
  cForest = mix(vec3(0.075, 0.09, 0.05), vec3(0.11, 0.12, 0.07), macro);
  wForest = cover * (1.0 - wRock) * 0.85;
  wSoil = 0.0;
#endif
float wSnow = 0.0;
#ifdef USE_TMASK
  wSnow = msk.a;
#endif
wSnow = max(wSnow, smoothstep(uSnowLine, uSnowLine + 220.0, vWPos.y + macro * 160.0));
wSnow *= 1.0 - smoothstep(0.45, 0.7, slope);
// beaches near the sea
float wBeach = uSea * (1.0 - smoothstep(1.5, 6.0, vWPos.y));

float wGrass = max(0.0, 1.0 - wForest - wSoil);
// height-aware blending (use texture luminance as a height cue)
float hG = dot(cGrass, vec3(0.33)) + 0.1, hS = dot(cSoil, vec3(0.33)), hF = dot(cForest, vec3(0.33));
vec3 wts = vec3(wGrass * (hG + 0.5), wSoil * (hS + 0.5), wForest * (hF + 0.5));
wts = pow(wts, vec3(2.0));
wts /= max(1e-4, wts.x + wts.y + wts.z);
vec3 base = cGrass * wts.x + cSoil * wts.y + cForest * wts.z;
base = mix(base, cRock, clamp(wRock, 0.0, 1.0));
base = mix(base, cWall, clamp(wWall, 0.0, 1.0));
base = mix(base, cSnow * 1.05, clamp(wSnow, 0.0, 1.0));
base = mix(base, vec3(0.76, 0.70, 0.58), wBeach);
base *= 0.86 + 0.28 * macro;
// Wet ground: bare earth darkens most, grass and stone less; snow doesn't.
// Once it is well soaked, water stands in the flat hollows of bare earth.
float wetK = uWet * (1.0 - wSnow);
float puddle = wetK * smoothstep(0.5, 0.85, uWet) * wts.y * (1.0 - smoothstep(0.015, 0.06, slope))
  * smoothstep(0.58, 0.7, vnoise(vWPos.xz * 0.45) * 0.7 + macro * 0.3);
base *= 1.0 - wetK * (0.2 + 0.25 * wts.y) - 0.3 * puddle;
diffuseColor.rgb *= base;
`;

const TERRAIN_FRAG_NORMAL = /* glsl */ `
{
  vec3 pn = vec3(0.0);
  vec3 ng = (texture2D(nGrass, uvG).xyz * 2.0 - 1.0);
  vec3 ns = (texture2D(nSoil, vWPos.xz / 5.0).xyz * 2.0 - 1.0);
  vec3 nf = (texture2D(nForest, vWPos.xz / 4.0).xyz * 2.0 - 1.0);
  vec3 flatP = vec3(ng.x, 0.0, -ng.y) * wts.x + vec3(ns.x, 0.0, -ns.y) * wts.y + vec3(nf.x, 0.0, -nf.y) * wts.z;
  vec3 rp = triplanarN(nRock, vWPos, gN, 1.0 / 9.0);
  vec3 wp = triplanarN(nWall, vWPos, gN, 1.0 / 2.2);
  pn = flatP * 0.9;
  pn = mix(pn, rp * 1.2, clamp(wRock, 0.0, 1.0));
  pn = mix(pn, wp * 1.6, clamp(wWall, 0.0, 1.0));
  pn *= 1.0 - wSnow * 0.8;
  pn *= 1.0 - puddle; // standing water is flat
  vec3 wn = normalize(gN + pn);
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
}
`;

function makeWaterNormal() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const n = new Noise2D(5);
  const hgt = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // tileable by sampling a torus
      const a = (x / size) * Math.PI * 2;
      const b = (y / size) * Math.PI * 2;
      hgt[y * size + x] =
        n.noise(Math.cos(a) * 1.5 + 5, Math.sin(a) * 1.5 + Math.cos(b) * 1.5) * 0.6 +
        n.noise(Math.cos(a) * 4 + Math.sin(b) * 4, Math.sin(a) * 4 - 7 + Math.cos(b)) * 0.4;
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = hgt[y * size + ((x - 1 + size) % size)];
      const r = hgt[y * size + ((x + 1) % size)];
      const d = hgt[((y - 1 + size) % size) * size + x];
      const u = hgt[((y + 1) % size) * size + x];
      const nx = (l - r) * 2;
      const ny = (d - u) * 2;
      const len = Math.hypot(nx, ny, 1);
      const k = (y * size + x) * 4;
      img.data[k] = ((nx / len) * 0.5 + 0.5) * 255;
      img.data[k + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      img.data[k + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[k + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
