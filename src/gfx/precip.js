import * as THREE from 'three';
import { smoothstep } from '../core/rng.js';
import { wetness } from '../world/shading.js';

// Rain and snow around the hunter, raindrops splashing at his feet, and the
// wet ground (the shared `wetness` uniform).
//
// Drops fill a box that follows the camera. Each drop's place is worked out on
// the GPU from its seed and the time, and wraps round the box with mod(), so
// the rain is anchored to the world: walking through it doesn't drag it along,
// and the CPU only sets a few uniforms a frame. Heavier rain draws more of the
// drops. Streaks fall at the drops' speed and lean with the wind. Splashes
// (high and ultra) are a few hundred rings on the ground near the player.

const FALL_VERT = /* glsl */ `
  attribute vec4 aSeed; // xyz: place in the box (0..1), w: size and speed variation
  uniform float uTime, uLen, uWidth, uPix;
  uniform vec3 uVel, uBox;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    vec3 vel = uVel * (0.8 + 0.4 * aSeed.w);
    vec3 origin = cameraPosition - uBox * 0.5;
    vec3 p = aSeed.xyz * uBox + vel * uTime;
    #ifdef SNOW
      // flakes flutter and wander as they fall
      float ph = aSeed.w * 40.0;
      p.x += sin(uTime * 1.1 + ph) * 0.4;
      p.z += cos(uTime * 0.85 + ph * 1.3) * 0.4;
    #endif
    p = mod(p - origin, uBox) + origin;
    vec3 toCam = cameraPosition - p;
    float d = length(toCam);
    // never thinner than about a pixel: far drops widen and fade instead of flickering
    float wb = uWidth * (0.7 + 0.6 * aSeed.w);
    float w = max(wb, d * uPix);
    float cover = wb / w;
    #ifdef SNOW
      vec3 camR = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
      vec3 camU = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
      vec3 pos = p + (camR * position.x + camU * (position.y - 0.5)) * w;
      cover *= cover; // a flake shrinks both ways
    #else
      vec3 dir = normalize(vel);
      vec3 side = normalize(cross(dir, toCam));
      vec3 pos = p - dir * (length(vel) * uLen * position.y) + side * (w * position.x);
    #endif
    // fade out right at the eye and where drops wrap round the box
    vec3 rel = (p - cameraPosition) / (uBox * 0.5);
    float edge = max(length(rel.xz), abs(rel.y));
    vAlpha = cover * smoothstep(0.5, 2.0, d) * (1.0 - smoothstep(0.7, 1.0, edge));
    vUv = vec2(position.x + 0.5, position.y);
    gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
  }`;

const FALL_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vAlpha;
  void main() {
    #ifdef SNOW
      float a = 1.0 - smoothstep(0.2, 0.5, length(vUv - vec2(0.5)));
    #else
      // soft across the streak, the head brighter than the tail
      float a = (1.0 - abs(vUv.x * 2.0 - 1.0)) * (0.35 + 0.65 * (1.0 - vUv.y));
    #endif
    gl_FragColor = vec4(uColor, a * vAlpha * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const SPLASH_VERT = /* glsl */ `
  attribute vec4 aSplash; // xyz: where it landed, w: age 0..1
  uniform float uSize;
  varying vec2 vUv;
  varying float vAge;
  void main() {
    vUv = position.xy + 0.5;
    vAge = aSplash.w;
    float r = uSize * (0.35 + 0.65 * aSplash.w);
    vec3 p = aSplash.xyz + vec3(position.x, 0.0, position.y) * r * 2.0;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;

const SPLASH_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  varying float vAge;
  void main() {
    if (vAge >= 1.0) discard;
    float r = length(vUv - 0.5) * 2.0;
    // a ring spreading out, and a bright fleck in the first instant
    float ring = smoothstep(0.55, 0.82, r) * (1.0 - smoothstep(0.82, 1.0, r)) * (1.0 - vAge);
    float fleck = (1.0 - smoothstep(0.0, 0.3, r)) * (1.0 - smoothstep(0.0, 0.25, vAge));
    gl_FragColor = vec4(uColor, (ring + fleck) * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

const BOX = { rain: new THREE.Vector3(24, 16, 24), snow: new THREE.Vector3(24, 16, 24) };
const SPLASH_LIFE = 0.32; // s
const _col = new THREE.Color();

function quad(y0) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, y0, 0, 0.5, y0, 0, -0.5, y0 + 1, 0, 0.5, y0 + 1, 0], 3));
  g.setIndex([0, 2, 1, 1, 2, 3]);
  return g;
}

export class Precipitation {
  constructor(game, T) {
    this.scene = game.scene;
    this.terrain = game.terrain;
    this.max = T.precip || 1400;
    this.splashN = T.splashes || 0;
    this.time = 0;
    this.fall = {}; // 'rain' | 'snow' -> mesh
    this.splash = null;
    // Build what today's weather can bring straight away and draw it (empty)
    // on the first frame, so its shaders compile while the hunt is loading
    // rather than with a stutter when the first shower arrives.
    const W = game.weather;
    if (W && W.canRain) {
      this.fall.rain = this.makeFall('rain');
      if (this.splashN) this.makeSplashes();
    }
    if (W && W.canSnow) this.fall.snow = this.makeFall('snow');
    this.warm = true;
  }

  makeFall(kind) {
    const snow = kind === 'snow';
    const g = quad(0);
    const seeds = new Float32Array(this.max * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    g.instanceCount = 0;
    const m = new THREE.ShaderMaterial({
      vertexShader: FALL_VERT,
      fragmentShader: FALL_FRAG,
      defines: snow ? { SNOW: '' } : {},
      uniforms: {
        uTime: { value: 0 }, uLen: { value: 0.08 }, uWidth: { value: 0.008 }, uPix: { value: 0.001 },
        uVel: { value: new THREE.Vector3(0, -8, 0) }, uBox: { value: BOX[kind] },
        uColor: { value: new THREE.Color(1, 1, 1) }, uOpacity: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5; // after the leaves and other see-through things
    this.scene.add(mesh);
    return mesh;
  }

  makeSplashes() {
    const g = quad(-0.5);
    this.splashData = new Float32Array(this.splashN * 4).fill(1); // all spent
    this.splashAttr = new THREE.InstancedBufferAttribute(this.splashData, 4);
    this.splashAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aSplash', this.splashAttr);
    g.instanceCount = this.splashN;
    const m = new THREE.ShaderMaterial({
      vertexShader: SPLASH_VERT,
      fragmentShader: SPLASH_FRAG,
      uniforms: { uSize: { value: 0.075 }, uColor: { value: new THREE.Color(1, 1, 1) }, uOpacity: { value: 0.35 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.splash = new THREE.Mesh(g, m);
    this.splash.frustumCulled = false;
    this.splash.renderOrder = 4;
    this.scene.add(this.splash);
  }

  update(game, dt) {
    const W = game.weather;
    wetness.value = W ? W.wetness : 0;
    if (!W) return;
    this.time = (this.time + dt) % 3600;
    const fog = game.scene.fog.color;
    const lum = fog.r * 0.2126 + fog.g * 0.7152 + fog.b * 0.0722;
    // ~1 pixel in metres per metre of distance
    const pix = (2 * Math.tan(THREE.MathUtils.degToRad(game.camera.fov) / 2)) / Math.max(1, game.renderer.domElement.height);
    const wind = game.wind ? game.wind.vec : new THREE.Vector3();

    // rain: drizzle is fine, slow and faint; a downpour is fast, long streaks
    const r = W.rain;
    const rain = this.layer('rain', r);
    if (rain) {
      const u = rain.material.uniforms;
      u.uTime.value = this.time;
      u.uVel.value.set(wind.x * 0.9, -(3 + 6 * smoothstep(0.1, 0.7, r)), wind.z * 0.9);
      u.uWidth.value = 0.006 + 0.004 * r;
      u.uPix.value = pix;
      u.uOpacity.value = (0.24 + 0.32 * r) * smoothstep(0, 0.06, r);
      // lit by the grey sky: pale streaks against the ground
      u.uColor.value.copy(fog).multiplyScalar(1.2);
    }

    // snow: slow flakes carried by the wind
    const s = W.snow;
    const snow = this.layer('snow', s);
    if (snow) {
      const u = snow.material.uniforms;
      u.uTime.value = this.time;
      u.uVel.value.set(wind.x * 0.7, -1.1, wind.z * 0.7);
      u.uWidth.value = 0.06; // a flake and its blur as it falls
      u.uPix.value = pix;
      u.uOpacity.value = 0.95 * smoothstep(0, 0.06, s);
      u.uColor.value.copy(_col.setRGB(0.95, 0.97, 1.0).multiplyScalar(Math.min(1.25, 0.5 + lum)));
    }

    if (this.splashN && game.player) this.updateSplashes(game, dt, r, fog);
    this.warm = false;
  }

  // The drops of one kind for the amount falling (0..1); null when none fall.
  layer(kind, amount) {
    let mesh = this.fall[kind];
    if (!mesh) {
      if (amount < 0.005) return null;
      mesh = this.fall[kind] = this.makeFall(kind);
    }
    const on = amount >= 0.005;
    mesh.visible = on || this.warm;
    mesh.geometry.instanceCount = on ? Math.round(this.max * (0.25 + 0.75 * amount)) : 0;
    return on ? mesh : null;
  }

  // Each splash lives a third of a second; when it is spent, a new drop lands
  // somewhere near the hunter, more often the harder it rains.
  updateSplashes(game, dt, rain, fog) {
    if (!this.splash) {
      if (rain < 0.05) return;
      this.makeSplashes();
    }
    const d = this.splashData;
    const p = game.player.pos;
    let alive = 0;
    for (let i = 0; i < this.splashN; i++) {
      const k = i * 4;
      let age = d[k + 3];
      if (age < 1) age += dt / SPLASH_LIFE;
      if (age >= 1 && Math.random() < rain * 1.3) {
        const a = Math.random() * Math.PI * 2;
        const rr = 1.2 + Math.sqrt(Math.random()) * 9;
        const x = p.x + Math.cos(a) * rr;
        const z = p.z + Math.sin(a) * rr;
        d[k] = x;
        d[k + 1] = this.terrain.height(x, z) + 0.04;
        d[k + 2] = z;
        age = Math.random() * 0.25;
      }
      d[k + 3] = Math.min(1, age);
      if (age < 1) alive++;
    }
    this.splashAttr.needsUpdate = true;
    this.splash.visible = alive > 0 || this.warm;
    this.splash.material.uniforms.uColor.value.copy(fog).multiplyScalar(1.5);
  }
}
