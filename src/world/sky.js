import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { clamp, smoothstep } from '../core/rng.js';

// Atmospheric sky, sun, clouds, fog and image-based lighting, driven by the
// time of day and the month (Lebanon sits at ~34°N).

const MONTH_INFO = {
  September: { rise: 6.25, set: 18.9, maxElev: 54 },
  October: { rise: 6.5, set: 18.0, maxElev: 45 },
  November: { rise: 6.0, set: 16.6, maxElev: 37 },
  December: { rise: 6.4, set: 16.5, maxElev: 33 },
  January: { rise: 6.6, set: 16.8, maxElev: 35 },
};

export class Atmosphere {
  constructor(renderer, scene, hunt, quality) {
    this.renderer = renderer;
    this.scene = scene;
    this.hunt = hunt;
    this.hour = hunt.startHour;
    this.month = MONTH_INFO[hunt.month] || MONTH_INFO.October;
    this.sunDir = new THREE.Vector3();

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

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = quality !== 'low';
    const sz = quality === 'high' ? 4096 : 2048;
    this.sun.shadow.mapSize.set(sz, sz);
    const ext = quality === 'high' ? 80 : 60;
    this.shadowExt = ext;
    const cam = this.sun.shadow.camera;
    cam.left = -ext;
    cam.right = ext;
    cam.top = ext;
    cam.bottom = -ext;
    cam.near = 1;
    cam.far = 900;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    scene.add(this.sun);
    scene.add(this.sun.target);

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
          float d = fbm(p);
          float c = smoothstep(1.0 - uCover - 0.18, 1.0 - uCover + 0.25, d);
          float dl = fbm(p + uSunDir.xz * 0.02);
          float lit = clamp(0.55 + (d - dl) * 4.0, 0.0, 1.0);
          vec3 col = mix(uShadeCol, uSunCol, lit);
          float dist = length(vW.xz - uCam.xz);
          float fade = 1.0 - smoothstep(8000.0, 26000.0, dist);
          gl_FragColor = vec4(col, c * fade * 0.92);
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

  update(dt, camera, playerPos, timeScale) {
    this.hour += (dt * timeScale) / 3600;
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
    const sunCol = new THREE.Color(1, 0.97, 0.92).lerp(new THREE.Color(1.0, 0.58, 0.32), warm);
    this.sun.color.copy(sunCol);
    this.sun.intensity = 3.4 * smoothstep(-2, 8, elev) * (0.65 + 0.35 * e);
    this.hemi.intensity = 0.25 + 0.55 * smoothstep(-6, 20, elev);
    this.hemi.color.setRGB(0.62, 0.74, 0.95).lerp(new THREE.Color(0.9, 0.7, 0.6), warm * 0.5);

    // shadow camera follows the player, snapped to texels
    const ext = this.shadowExt;
    const texel = (ext * 2) / this.sun.shadow.mapSize.x;
    const cx = Math.round(playerPos.x / texel) * texel;
    const cz = Math.round(playerPos.z / texel) * texel;
    this.sun.target.position.set(cx, playerPos.y, cz);
    this.sun.position.set(cx, playerPos.y, cz).addScaledVector(this.sunDir, 400);

    // fog colour ~ horizon colour
    const day = new THREE.Color(0.66, 0.74, 0.82);
    const dawn = new THREE.Color(0.86, 0.68, 0.56);
    const dusk = new THREE.Color(0.12, 0.13, 0.18);
    const fogC = day.clone().lerp(dawn, warm * 0.75).lerp(dusk, 1 - smoothstep(-4, 4, elev));
    this.scene.fog.color.copy(fogC);
    this.renderer.toneMappingExposure = 0.55 + 0.1 * smoothstep(0, 30, elev);

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

  get light() {
    return this.sunDir.y;
  }
}
