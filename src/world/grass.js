import * as THREE from 'three';
import { hash2, smoothstep } from '../core/rng.js';
import { loadFoliageAtlas, makeGrassTexture } from './foliageTextures.js';
import { windUniforms, translucentLights } from './foliage.js';
import { tierSettings } from '../gfx/quality.js';
import { NearGround } from './ground.js';
import { wetness } from './shading.js';

// Dense tufts of grass around the player, rebuilt as you walk. The tufts are
// photographed grass (public/models/foliage/grass): fanned blades and whole
// clumps, dry or green, picked per tuft by how dry the ground is.

const CELL = 4;
// where the hunter is standing, so the tufts can bend away underfoot
const uPlayer = { value: new THREE.Vector3(0, -1e5, 0) };

export class Grass {
  constructor(hunt, terrain, quality) {
    this.hunt = hunt;
    this.terrain = terrain;
    this.quality = quality;
    this.radius = { low: 28, medium: 42, high: 56, ultra: 70 }[quality] ?? 56;
    this.perCell = { low: 12, medium: 20, high: 28, ultra: 34 }[quality] ?? 28;
    // extra tufts right round the hunter's feet, where the ground is seen up close
    this.nearExtra = { low: 0.8, medium: 1.3, high: 1.6, ultra: 1.8 }[quality] ?? 1.6;
    const plain = hunt.terrain.kind === 'plain' ? 1.5 : 1;
    this.capacity = Math.ceil(((Math.PI * this.radius * this.radius) / (CELL * CELL)) * this.perCell * plain + ((Math.PI * 18 * 18) / (CELL * CELL)) * this.perCell * this.nearExtra * plain) + 200;
    this.center = new THREE.Vector2(1e9, 1e9);
    this.height = hunt.terrain.kind === 'plain' ? 0.42 : 0.55;
  }

  build(scene) {
    const g = new THREE.BufferGeometry();
    const planes = 3;
    const pos = [];
    const uv = [];
    const nor = [];
    const idx = [];
    for (let p = 0; p < planes; p++) {
      const a = (p / planes) * Math.PI;
      const cx = Math.cos(a) * 0.5;
      const cz = Math.sin(a) * 0.5;
      const base = pos.length / 3;
      pos.push(-cx, 0, -cz, cx, 0, cz, cx, 1, cz, -cx, 1, -cz);
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      for (let i = 0; i < 4; i++) nor.push(0, 1, 0);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex(idx);
    this.cells = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity), 1);
    g.setAttribute('aCell', this.cells);

    // painted stand-in until (or if) the photographed atlas arrives
    const tint = this.hunt.ground.grass;
    const painted = makeGrassTexture(tint, this.hunt.ground.dryness, this.hunt.seed);
    const mat = new THREE.MeshStandardMaterial({
      map: painted,
      alphaTest: 0.5,
      alphaToCoverage: tierSettings(this.quality).msaa > 0,
      side: THREE.DoubleSide,
      roughness: 0.85,
      color: new THREE.Color(tint[0] * 1.15, tint[1] * 1.15, tint[2] * 1.15),
    });
    this.atlas = false;
    const uAtlas = { value: 0 };
    loadFoliageAtlas('grass').then((tex) => {
      if (!tex) return;
      mat.map = tex;
      // the photo carries its own colour: only a soft pull towards the ground's tint
      const k = 0.6;
      mat.color.setRGB(1 - k + k * tint[0] * 1.3, 1 - k + k * tint[1] * 1.3, 1 - k + k * tint[2] * 1.3);
      uAtlas.value = 1;
      this.atlas = true;
      mat.needsUpdate = true;
    });
    const radius = this.radius;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = windUniforms.uTime;
      shader.uniforms.uWind = windUniforms.uWind;
      shader.uniforms.uPlayer = uPlayer;
      shader.uniforms.uWet = wetness;
      shader.uniforms.uAtlas = uAtlas;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;\nuniform vec3 uPlayer;\nuniform float uAtlas;\nattribute float aCell;')
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
          // one of the atlas' four tufts (2x2, top row first)
          if (uAtlas > 0.5) vMapUv = vMapUv * 0.49 + vec2(mod(aCell, 2.0) * 0.5 + 0.005, aCell < 1.5 ? 0.502 : 0.002);`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          {
            vec3 ip = instanceMatrix[3].xyz;
            float d = distance(ip, cameraPosition);
            float fade = 1.0 - smoothstep(${(radius * 0.65).toFixed(1)}, ${radius.toFixed(1)}, d);
            transformed.y *= fade;
            float k = uv.y * uv.y;
            float ph = ip.x * 0.4 + ip.z * 0.3;
            transformed.x += (sin(uTime * 1.8 + ph) * 0.12 + sin(uTime * 4.1 + ph * 2.0) * 0.04) * k * uWind;
            transformed.z += cos(uTime * 1.5 + ph) * 0.07 * k * uWind;
            // pressed down and pushed aside where the hunter walks
            vec2 away = ip.xz - uPlayer.xz;
            float pd = length(away);
            float push = (1.0 - smoothstep(0.25, 1.15, pd)) * step(abs(ip.y - uPlayer.y), 1.5);
            vec3 wpush = vec3(away / max(pd, 0.05), 0.0).xzy * push * 0.45 * k;
            vec3 c0 = instanceMatrix[0].xyz, c1 = instanceMatrix[1].xyz, c2 = instanceMatrix[2].xyz;
            transformed += vec3(dot(c0, wpush) / dot(c0, c0), dot(c1, wpush) / dot(c1, c1), dot(c2, wpush) / dot(c2, c2));
            transformed.y *= 1.0 - push * 0.45 * k;
          }`
        );
      // two-sided cards: don't flip the normal on the back face. Wet blades
      // are a little darker and glossier; thin blades glow against the sun.
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uWet;')
        .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= 1.0 - 0.16 * uWet;')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.55, uWet * 0.6);')
        .replace(
          '#include <normal_fragment_begin>',
          '#include <normal_fragment_begin>\n normal = normalize(vNormal); nonPerturbedNormal = normal;'
        )
        .replace('#include <lights_physical_pars_fragment>', translucentLights(0.35));
    };
    mat.customProgramCacheKey = () => 'grass';
    this.mesh = new THREE.InstancedMesh(g, mat, this.capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);

    // pebbles, thistles and terrace-wall stones around the hunter
    this.near = new NearGround(this.hunt, this.terrain, tierSettings(this.quality));
    this.near.build(scene).catch((e) => console.warn('ground detail', e));
  }

  update(playerPos) {
    uPlayer.value.copy(playerPos);
    if (this.near) this.near.update(playerPos);
    if (this.center.distanceTo(new THREE.Vector2(playerPos.x, playerPos.z)) < 6 && this.builtAtlas === this.atlas) return;
    this.builtAtlas = this.atlas;
    this.center.set(playerPos.x, playerPos.z);
    const R = this.radius;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();
    const dry = this.hunt.ground.dryness;
    const plain = this.terrain.kind === 'plain';
    let n = 0;
    const c0x = Math.floor((playerPos.x - R) / CELL);
    const c1x = Math.floor((playerPos.x + R) / CELL);
    const c0z = Math.floor((playerPos.z - R) / CELL);
    const c1z = Math.floor((playerPos.z + R) / CELL);
    const seed = this.hunt.seed;
    for (let cz = c0z; cz <= c1z; cz++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const mx = cx * CELL + CELL / 2;
        const mz = cz * CELL + CELL / 2;
        const d2 = (mx - playerPos.x) ** 2 + (mz - playerPos.z) ** 2;
        if (d2 > R * R) continue;
        const m = this.terrain.maskAt(mx, mz);
        let dens = (1 - m.forest * 0.75) * (1 - m.snow) * (plain ? 1 : 1 - m.field * 0.55);
        if (this.terrain.road(mx, mz) < 1.8) dens *= 0.15;
        // patchy: thick drifts and thin, bare stretches
        dens *= 0.55 + 0.9 * smoothstep(0.2, 0.8, hash2(Math.floor(cx / 3), Math.floor(cz / 3), seed + 77));
        const near = 1 + this.nearExtra * (1 - smoothstep(8, 18, Math.sqrt(d2)));
        const count = Math.round(this.perCell * dens * near * (plain ? 1.5 : 1));
        for (let i = 0; i < count && n < this.capacity; i++) {
          const x = cx * CELL + hash2(cx, cz, i * 3 + seed) * CELL;
          const z = cz * CELL + hash2(cx, cz, i * 3 + 1 + seed) * CELL;
          const y = this.terrain.height(x, z);
          this.terrain.normal(x, z, nrm);
          if (nrm.y < 0.72) continue;
          const r = hash2(cx, cz, i * 3 + 2 + seed);
          const r2 = hash2(cx, cz, i * 7 + 5 + seed);
          // dry or green tuft, fanned blades or a whole clump
          const isDry = r2 < 0.15 + 0.8 * dry;
          const clump = hash2(cx, cz, i * 5 + 9 + seed) < 0.6;
          const cell = (isDry ? 0 : 2) + (clump ? 1 : 0);
          this.cells.array[n] = cell;
          q.setFromAxisAngle(up, r * Math.PI * 2);
          const hs = this.height * (0.6 + r * 0.8) * (clump ? 1.25 : 1);
          const ws = (0.7 + r * 0.6) * (clump ? 1.5 : 1) * (this.atlas ? 1 : 0.8);
          s.set(ws, hs, ws);
          p.set(x, y - 0.03, z);
          m4.compose(p, q, s);
          this.mesh.setMatrixAt(n, m4);
          // darker and lighter tufts, a little warmer or cooler
          const l = 0.62 + r2 * 0.32;
          color.setRGB(l, l * (0.95 + r * 0.05), l * (0.84 + r * 0.1));
          this.mesh.setColorAt(n, color);
          n++;
        }
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.cells.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
