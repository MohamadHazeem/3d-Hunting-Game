import * as THREE from 'three';
import { hash2 } from '../core/rng.js';
import { makeGrassTexture } from './foliageTextures.js';
import { windUniforms } from './vegetation.js';
import { tierSettings } from '../gfx/quality.js';
import { NearGround } from './ground.js';

// Dense tufts of dry grass around the player, rebuilt as you walk.

const CELL = 4;
// where the hunter is standing, so the tufts can bend away underfoot
const uPlayer = { value: new THREE.Vector3(0, -1e5, 0) };

export class Grass {
  constructor(hunt, terrain, quality) {
    this.hunt = hunt;
    this.terrain = terrain;
    this.quality = quality;
    this.radius = { low: 28, medium: 42, high: 56, ultra: 70 }[quality] ?? 56;
    this.perCell = { low: 10, medium: 16, high: 22, ultra: 26 }[quality] ?? 22;
    this.capacity = Math.ceil((Math.PI * this.radius * this.radius) / (CELL * CELL) * this.perCell * (hunt.terrain.kind === 'plain' ? 1.5 : 1)) + 200;
    this.center = new THREE.Vector2(1e9, 1e9);
    this.height = hunt.terrain.kind === 'plain' ? 0.38 : 0.5;
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
      const cx = Math.cos(a) * 0.4;
      const cz = Math.sin(a) * 0.4;
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

    const tint = this.hunt.ground.grass;
    const tex = makeGrassTexture(tint, this.hunt.ground.dryness, this.hunt.seed);
    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      alphaTest: 0.5,
      alphaToCoverage: tierSettings(this.quality).msaa > 0,
      side: THREE.DoubleSide,
      roughness: 0.9,
      color: new THREE.Color(tint[0] * 1.15, tint[1] * 1.15, tint[2] * 1.15),
    });
    const radius = this.radius;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = windUniforms.uTime;
      shader.uniforms.uWind = windUniforms.uWind;
      shader.uniforms.uPlayer = uPlayer;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uWind;\nuniform vec3 uPlayer;')
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
      // two-sided cards: don't flip the normal on the back face
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_begin>',
        '#include <normal_fragment_begin>\n normal = normalize(vNormal); nonPerturbedNormal = normal;'
      );
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
    if (this.center.distanceTo(new THREE.Vector2(playerPos.x, playerPos.z)) < 6) return;
    this.center.set(playerPos.x, playerPos.z);
    const R = this.radius;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();
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
        if ((mx - playerPos.x) ** 2 + (mz - playerPos.z) ** 2 > R * R) continue;
        const m = this.terrain.maskAt(mx, mz);
        let dens = (1 - m.forest * 0.75) * (1 - m.snow) * (this.terrain.kind === 'plain' ? 1 : 1 - m.field * 0.55);
        if (this.terrain.road(mx, mz) < 1.8) dens *= 0.15;
        const count = Math.round(this.perCell * dens * (this.terrain.kind === 'plain' ? 1.5 : 1));
        for (let i = 0; i < count && n < this.capacity; i++) {
          const x = cx * CELL + hash2(cx, cz, i * 3 + seed) * CELL;
          const z = cz * CELL + hash2(cx, cz, i * 3 + 1 + seed) * CELL;
          const y = this.terrain.height(x, z);
          this.terrain.normal(x, z, nrm);
          if (nrm.y < 0.72) continue;
          const r = hash2(cx, cz, i * 3 + 2 + seed);
          q.setFromAxisAngle(up, r * Math.PI * 2);
          const hs = this.height * (0.6 + r * 0.8);
          s.set(0.7 + r * 0.6, hs, 0.7 + r * 0.6);
          p.set(x, y - 0.03, z);
          m4.compose(p, q, s);
          this.mesh.setMatrixAt(n, m4);
          color.setHSL(0.1 + r * 0.04, 0.2, 0.75 + r * 0.25);
          this.mesh.setColorAt(n, color);
          n++;
        }
      }
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
