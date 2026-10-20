import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { clamp, smoothstep } from '../core/rng.js';
import { tierSettings } from '../gfx/quality.js';
import { look } from '../gfx/look.js';
import { mistParams, mistColor, sunScatter, sunDirection, mistTime } from './shading.js';
import { CORE_SIZE } from './terrain.js';

// Atmospheric sky, sun, clouds, fog, valley mist and image-based lighting,
// driven by the time of day and the month (Lebanon sits at ~34°N). Also sets
// the colour grade for the light of the moment.

const MONTH_INFO = {
  September: { rise: 6.25, set: 18.9, maxElev: 54 },
  October: { rise: 6.5, set: 18.0, maxElev: 45 },
  November: { rise: 6.0, set: 16.6, maxElev: 37 },
  December: { rise: 6.4, set: 16.5, maxElev: 33 },
  January: { rise: 6.6, set: 16.8, maxElev: 35 },
};

// Mist that gathers in the valleys: how thick at dawn and towards dusk, how
// quickly it thins with height (m), and how patchy it is.
const MIST = {
  koura: { dawn: 1.0, dusk: 0.25, falloff: 24, patch: 0.75 }, // coastal valleys, sea haze
  bekaa: { dawn: 1.15, dusk: 0.2, falloff: 12, patch: 0.6 }, // ground mist over the stubble
  chouf: { dawn: 0.6, dusk: 0.95, falloff: 30, patch: 0.8 }, // winter mist rising at dusk
  akkar: { dawn: 0.85, dusk: 0.7, falloff: 34, patch: 0.85 }, // cold highland valleys
  free: { dawn: 0.9, dusk: 0.4, falloff: 24, patch: 0.75 },
};
const WINTER = { December: 1, January: 1, November: 0.4 };

const _c = new THREE.Color();
const _v = new THREE.Vector3();

export class Atmosphere {
  constructor(renderer, scene, hunt, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.hunt = hunt;
    this.hour = hunt.startHour;
    this.month = MONTH_INFO[hunt.month] || MONTH_INFO.October;
    this.sunDir = new THREE.Vector3();
    this.mist = MIST[hunt.id] || MIST.free;
    this.winter = WINTER[hunt.month] || 0;
    this.time = 0;
    const T = tierSettings(quality);
    this.T = T;

    const sky = new Sky();
    sky.scale.setScalar(20000); // must stay inside the camera far plane
    const u = sky.material.uniforms;
    u.turbidity.value = hunt.weather.turbidity;
    u.rayleigh.value = hunt.weather.rayleigh;
    u.mieCoefficient.value = 0.005;
    u.mieDirectionalG.value = 0.8;
    this.sky = sky;
    scene.add(sky);

    // a second sky used only for generating the environment map
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(1000);
    Object.assign(this.envSky.material.uniforms.turbidity, { value: hunt.weather.turbidity });
    this.envSky.material.uniforms.rayleigh.value = hunt.weather.rayleigh;
    this.envSky.material.uniforms.mieCoefficient.value = 0.005;
    this.envSky.material.uniforms.mieDirectionalG.value = 0.8;
    this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this.lastEnvHour = -10;

    // The sun, with a sharp shadow map that follows the hunter.
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = T.shadows;
    if (T.shadows) {
      this.sun.shadow.mapSize.set(T.shadowMap, T.shadowMap);
      const ext = T.shadowExt;
      this.shadowExt = ext;
      const cam = this.sun.shadow.camera;
      cam.left = -ext;
      cam.right = ext;
      cam.top = ext;
      cam.bottom = -ext;
      cam.near = 1;
      cam.far = 700;
      this.sun.shadow.bias = -0.0003;
      this.sun.shadow.normalBias = 0.35;
    }
    scene.add(this.sun);
    scene.add(this.sun.target);

    // A second, light-less "sun" that only owns a shadow map covering the
    // whole hunting ground: long hill and tree shadows far away. It is
    // re-rendered only when the sun has moved a little.
    if (T.shadows && T.farShadowMap) {
      const far = new THREE.DirectionalLight(0xffffff, 0);
      far.castShadow = true;
      far.shadow.mapSize.set(T.farShadowMap, T.farShadowMap);
      const half = CORE_SIZE / 2 + 60;
      const c = far.shadow.camera;
      c.left = -half;
      c.right = half;
      c.top = half;
      c.bottom = -half;
      c.near = 10;
      c.far = 7000;
      far.shadow.bias = -0.00004;
      far.shadow.normalBias = 0.6;
      far.shadow.autoUpdate = false;
      far.shadow.needsUpdate = true;
      scene.add(far); // after the sun, so it is directional light #1
      scene.add(far.target);
      this.farSun = far;
      this.farDir = new THREE.Vector3(0, -1, 0);
    }

    this.hemi = new THREE.HemisphereLight(0xbfd6ff, 0x6b5a40, 0.6);
    scene.add(this.hemi);

    scene.fog = new THREE.FogExp2(0xb8c4cc, hunt.weather.haze);

    this.clouds = this.makeClouds(hunt.weather.clouds);
    scene.add(this.clouds);
  }

  makeClouds(coverage) {
    const geo = new THREE.PlaneGeometry(60000, 60000, 1, 1);
    geo.rotateX(Math.PI / 2);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uCover: { value: coverage },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunCol: { value: new THREE.Color(1, 1, 1) },
        uShadeCol: { value: new THREE.Color(0.6, 0.65, 0.72) },
        uCam: { value: new THREE.Vector3() },
      },
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main(){
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vW;
        uniform float uTime, uCover;
        uniform vec3 uSunDir, uSunCol, uShadeCol, uCam;
        float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<6;i++){ s+=a*n(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return s; }
        void main(){
          vec2 p = vW.xz * 0.00022 + vec2(uTime * 0.004, uTime * 0.0015);
          // large cloud banks shaped by a slow low-frequency field, with
          // billowy detail on top
          float big = n(p * 0.35 + 7.0);
          float d = fbm(p) * 0.8 + big * 0.35 - 0.1;
          float c = smoothstep(1.0 - uCover - 0.16, 1.0 - uCover + 0.22, d);
          // thicker cores, wispy edges
          float core = smoothstep(1.0 - uCover + 0.05, 1.0 - uCover + 0.45, d);
          // light: step towards the sun through the cloud field
          float dl = fbm(p + uSunDir.xz * 0.025) * 0.8 + n((p + uSunDir.xz * 0.025) * 0.35 + 7.0) * 0.35 - 0.1;
          float lit = clamp(0.6 + (d - dl) * 4.5, 0.0, 1.0);
          vec3 col = mix(uShadeCol, uSunCol, lit);
          col = mix(col, uShadeCol * 0.85, core * 0.45);
          // silver lining when looking towards the sun
          vec3 vd = normalize(vW - uCam);
          float toward = pow(max(dot(vd, uSunDir), 0.0), 12.0);
          col += uSunCol * toward * (1.0 - core) * 0.8;
          float dist = length(vW.xz - uCam.xz);
          float fade = 1.0 - smoothstep(8000.0, 26000.0, dist);
          gl_FragColor = vec4(col, c * fade * 0.94);
        }`,
    });
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = -1;
    m.frustumCulled = false;
    return m;
  }

  sunElevationDeg(hour) {
    const { rise, set, maxElev } = this.month;
    const t = (hour - rise) / (set - rise);
    return maxElev * Math.sin(Math.PI * t) - 1.5;
  }

  // valley floor height for the mist, from the terrain once it exists
  mistBase() {
    if (this._mistBase != null) return this._mistBase;
    const terrain = this.scene.userData.terrain;
    if (!terrain || !terrain.heights) return this.hunt.terrain.baseHeight;
    const H = terrain.heights;
    const sample = [];
    for (let i = 0; i < H.length; i += 97) sample.push(H[i]);
    sample.sort((a, b) => a - b);
    this._mistBase = sample[Math.floor(sample.length * 0.12)];
    return this._mistBase;
  }

  mistAmount(hour) {
    const { rise, set } = this.month;
    const m = this.mist;
    // dawn mist peaks just after sunrise and burns off over ~2 hours
    const dawn = m.dawn * Math.exp(-(((hour - (rise + 0.5)) / 1.3) ** 2)) * (hour < rise + 0.5 ? 1 : 1);
    // dusk mist rises as the air cools in the last hours of light
    const dusk = m.dusk * smoothstep(set - 2.4, set + 0.4, hour);
    return Math.max(dawn, dusk);
  }

  update(dt, camera, playerPos, timeScale) {
    this.hour += (dt * timeScale) / 3600;
    this.time += dt;
    const { rise, set } = this.month;
    const elev = this.sunElevationDeg(this.hour);
    const t = clamp((this.hour - rise) / (set - rise), 0, 1);
    const az = THREE.MathUtils.degToRad(100 + 160 * t); // east -> south -> west
    const el = THREE.MathUtils.degToRad(elev);
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    this.envSky.material.uniforms.sunPosition.value.copy(this.sunDir);
    this.sky.position.copy(camera.position);

    // light colour & strength
    const e = clamp(elev / 50, -0.2, 1);
    const warm = 1 - smoothstep(2, 22, elev);
    const night = 1 - smoothstep(-4, 3, elev);
    const sunCol = new THREE.Color(1, 0.97, 0.92).lerp(new THREE.Color(1.0, 0.58, 0.32), warm);
    this.sun.color.copy(sunCol);
    this.sun.intensity = 3.4 * smoothstep(-2, 8, elev) * (0.65 + 0.35 * e);
    this.hemi.intensity = 0.25 + 0.55 * smoothstep(-6, 20, elev);
    this.hemi.color.setRGB(0.62, 0.74, 0.95).lerp(_c.setRGB(0.9, 0.7, 0.6), warm * 0.5);

    this.updateShadows(camera, playerPos);
    const structures = this.scene.userData.structures;
    if (structures) structures.update(elev);

    // fog colour ~ horizon colour
    const day = new THREE.Color(0.66, 0.74, 0.82);
    const dawn = new THREE.Color(0.86, 0.68, 0.56);
    const dusk = new THREE.Color(0.12, 0.13, 0.18);
    const fogC = day.clone().lerp(dawn, warm * 0.75).lerp(dusk, night);
    this.scene.fog.color.copy(fogC);
    // eyes adapt: open up a little in the low light of dawn and dusk
    this.renderer.toneMappingExposure = 0.6 + 0.1 * smoothstep(0, 30, elev) + 0.12 * (1 - smoothstep(2, 14, elev)) * (1 - night);

    // sun glow in the haze, valley mist
    const daylight = smoothstep(-3, 6, elev);
    sunDirection.x = this.sunDir.x;
    sunDirection.y = this.sunDir.y;
    sunDirection.z = this.sunDir.z;
    const sc = 0.36 * daylight * (0.6 + 0.8 * warm);
    sunScatter.x = sunCol.r * sc;
    sunScatter.y = sunCol.g * sc;
    sunScatter.z = sunCol.b * sc;
    const amt = this.T.mist ? this.mistAmount(this.hour) : 0;
    mistParams.x = 0.0032 * amt;
    mistParams.y = this.mistBase();
    mistParams.z = this.mist.falloff;
    mistParams.w = this.mist.patch;
    // mist is whiter and brighter than the haze; lit warm by a low sun
    const mc = _c.setRGB(0.78, 0.8, 0.84).multiplyScalar(0.35 + 0.65 * daylight).lerp(fogC, 0.35);
    mc.lerp(sunCol, 0.18 * warm * daylight);
    mistColor.x = mc.r;
    mistColor.y = mc.g;
    mistColor.z = mc.b;
    mistTime.x = this.time;

    this.updateGrade(elev, warm, night, amt);

    // clouds
    const cu = this.clouds.material.uniforms;
    cu.uTime.value += dt;
    cu.uSunDir.value.copy(this.sunDir);
    cu.uSunCol.value.copy(sunCol).multiplyScalar(0.6 + 0.6 * smoothstep(-3, 15, elev));
    cu.uShadeCol.value.copy(fogC).multiplyScalar(0.85);
    cu.uCam.value.copy(camera.position);
    this.clouds.position.set(camera.position.x, this.hunt.terrain.baseHeight + 2600, camera.position.z);

    if (Math.abs(this.hour - this.lastEnvHour) > 0.08) {
      this.lastEnvHour = this.hour;
      if (this.envRT) this.envRT.dispose();
      this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 2000);
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = 0.55 * smoothstep(-6, 15, elev) + 0.08;
    }
    return elev;
  }

  // Near map: centred a little ahead of where the hunter looks, and snapped to
  // whole shadow texels in the light's own space so edges never shimmer.
  // Far map: re-rendered whenever the sun has moved ~0.35°.
  updateShadows(camera, playerPos) {
    if (!this.sun.castShadow) {
      this.sun.target.position.copy(playerPos);
      this.sun.position.copy(playerPos).addScaledVector(this.sunDir, 400);
      return;
    }
    const ext = this.shadowExt;
    const fwd = _v.set(0, 0, -1).applyQuaternion(camera.quaternion);
    fwd.y = 0;
    if (fwd.lengthSq() > 1e-6) fwd.normalize();
    const cx = playerPos.x + fwd.x * ext * 0.45;
    const cz = playerPos.z + fwd.z * ext * 0.45;
    const cy = playerPos.y;
    // light-space axes, matching how three.js orients the shadow camera
    const L = this.sunDir;
    const up = Math.abs(L.y) > 0.99 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
    const R = new THREE.Vector3().crossVectors(up, L).normalize();
    const U = new THREE.Vector3().crossVectors(L, R).normalize();
    const texel = (ext * 2) / this.sun.shadow.mapSize.x;
    const cr = cx * R.x + cy * R.y + cz * R.z;
    const cu = cx * U.x + cy * U.y + cz * U.z;
    const dr = Math.round(cr / texel) * texel - cr;
    const du = Math.round(cu / texel) * texel - cu;
    const tx = cx + R.x * dr + U.x * du;
    const ty = cy + R.y * dr + U.y * du;
    const tz = cz + R.z * dr + U.z * du;
    this.sun.target.position.set(tx, ty, tz);
    this.sun.position.set(tx, ty, tz).addScaledVector(L, 300);

    if (this.farSun) {
      if (this.sunDir.y > -0.05 && this.farDir.dot(this.sunDir) < Math.cos(THREE.MathUtils.degToRad(0.35))) {
        this.farDir.copy(this.sunDir);
        const midY = this.hunt.terrain.baseHeight + this.hunt.terrain.relief * 0.3;
        this.farSun.target.position.set(0, midY, 0);
        this.farSun.position.set(0, midY, 0).addScaledVector(this.sunDir, 3500);
        this.farSun.target.updateMatrixWorld();
        this.farSun.updateMatrixWorld();
        this.farSun.shadow.needsUpdate = true;
      }
    }
  }

  // Colour grade: warm and contrasty at golden hour with cool shadows, a
  // little hazy and desaturated at midday, cooler in winter, blue at night.
  updateGrade(elev, warm, night, mist) {
    const noon = smoothstep(25, 45, elev);
    const w = this.winter;
    const wb = look.whiteBalance;
    wb.set(1, 1, 1);
    wb.x *= 1 + 0.07 * warm - 0.03 * w - 0.12 * night;
    wb.y *= 1 - 0.01 * warm - 0.06 * night;
    wb.z *= 1 - 0.1 * warm + 0.04 * w + 0.1 * night + 0.02 * noon;
    look.saturation = 1.04 + 0.06 * warm - 0.08 * noon - 0.2 * night - 0.05 * mist;
    look.contrast = 1.05 + 0.06 * warm - 0.04 * noon - 0.06 * mist;
    look.shadowTint.set(1 - 0.06 * warm - 0.02 * w, 1 - 0.02 * warm, 1 + 0.07 * warm + 0.03 * w);
    look.highlightTint.set(1 + 0.04 * warm, 1 + 0.005 * warm, 1 - 0.05 * warm);
    look.vignette = 0.16 + 0.06 * night;
    look.bloom = 0.12 + 0.12 * warm;
  }

  get light() {
    return this.sunDir.y;
  }
}
