import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { clamp, smoothstep } from '../core/rng.js';
import { tierSettings } from '../gfx/quality.js';
import { look } from '../gfx/look.js';
import { mistParams, mistColor, sunScatter, sunDirection, mistTime, aerial } from './shading.js';
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
const _c2 = new THREE.Color();
const _v = new THREE.Vector3();
const OVERCAST_GREY = new THREE.Color(0.58, 0.61, 0.65);
const FOG_WHITE = new THREE.Color(0.74, 0.76, 0.79);
const COOL_SUN = new THREE.Color(0.86, 0.9, 1.0);
const GREY_SKY_LIGHT = new THREE.Color(0.74, 0.77, 0.82);
const DUST = new THREE.Color(0.8, 0.73, 0.6);
// The physical sky model reads a little pale and milky with the grounds'
// haze numbers; a touch more Rayleigh and less turbidity gives the deeper
// Mediterranean blue overhead while the horizon keeps its haze.
const RAYLEIGH_MUL = 1.35;
const TURBIDITY_MUL = 0.75;
const MIE = 0.0038;
const MIE_G = 0.82;

// Overcast and fog grey the sky dome towards the colour of the cloud base or
// the fog (the Sky shader has no fog of its own, so without this a foggy
// valley would sit under a clear blue sky).
function greySky(sky) {
  const m = sky.material;
  m.uniforms.uGrey = { value: 0 };
  m.uniforms.uGreyCol = { value: new THREE.Color() };
  m.fragmentShader = m.fragmentShader
    .replace('uniform vec3 up;', 'uniform vec3 up;\nuniform float uGrey;\nuniform vec3 uGreyCol;')
    .replace(
      'gl_FragColor = vec4( retColor, 1.0 );',
      // a deeper, cleaner blue overhead on a clear day
      'retColor *= mix( vec3( 1.0 ), vec3( 0.86, 0.93, 1.04 ), smoothstep( 0.05, 0.85, direction.y ) * ( 1.0 - uGrey ) );\n' +
        // the sun: a bright core and a soft aureole round it (seen even without bloom), dimmed by cloud
        '\t\t\tfloat lbhCs = max( dot( direction, vSunDirection ), 0.0 );\n' +
        '\t\t\tretColor += vec3( 1.0, 0.9, 0.75 ) * ( pow( lbhCs, 9000.0 ) * 2.5 + pow( lbhCs, 900.0 ) * 0.35 + pow( lbhCs, 90.0 ) * 0.05 ) * ( 1.0 - uGrey ) * smoothstep( -0.04, 0.03, vSunDirection.y );\n' +
        '\t\t\tretColor = mix( retColor, uGreyCol, uGrey );\n\t\t\tgl_FragColor = vec4( retColor, 1.0 );'
    );
  return m.uniforms;
}

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
    u.turbidity.value = hunt.weather.turbidity * TURBIDITY_MUL;
    u.rayleigh.value = hunt.weather.rayleigh * RAYLEIGH_MUL;
    u.mieCoefficient.value = MIE;
    u.mieDirectionalG.value = MIE_G;
    greySky(sky);
    this.sky = sky;
    scene.add(sky);

    // a second sky used only for generating the environment map
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(1000);
    Object.assign(this.envSky.material.uniforms.turbidity, { value: hunt.weather.turbidity * TURBIDITY_MUL });
    this.envSky.material.uniforms.rayleigh.value = hunt.weather.rayleigh * RAYLEIGH_MUL;
    this.envSky.material.uniforms.mieCoefficient.value = MIE;
    this.envSky.material.uniforms.mieDirectionalG.value = MIE_G;
    greySky(this.envSky);
    this.envScene.add(this.envSky);
    // The lower half of the image lighting is the sunlit ground, not more sky:
    // undersides and shade pick up a warm, earthy bounce instead of blue.
    this.envGround = new THREE.Mesh(new THREE.CircleGeometry(950, 48), new THREE.MeshBasicMaterial({ color: 0x302a20, side: THREE.DoubleSide, fog: false }));
    this.envGround.rotation.x = -Math.PI / 2;
    this.envGround.position.y = -45;
    this.envScene.add(this.envGround);
    // ground albedo: what the grass, soil and leaf litter average out to
    const gg = hunt.ground.grass;
    const lit = hunt.terrain.kind === 'forest' ? 0.16 : hunt.terrain.kind === 'highland' ? 0.2 : 0.24;
    this.groundAlbedo = new THREE.Color(gg[0] * lit, gg[1] * lit, gg[2] * lit * 0.9);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this.lastEnvHour = -10;
    this.lastEnvGrey = 0;
    this.lastEnvTime = -10;
    // the day's Weather (cloud, rain, snow, fog, haze 0..1), set by the Game
    this.weather = null;

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
        uOpacity: { value: 1 },
        // under a grey sky the deck fades into the haze with distance, so hills
        // reaching up into it vanish in cloud instead of standing out pale
        uFogCol: { value: new THREE.Color() },
        uFogDen: { value: 0 },
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
        uniform float uTime, uCover, uOpacity, uFogDen;
        uniform vec3 uSunDir, uSunCol, uShadeCol, uCam, uFogCol;
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
          float fd = length(vW - uCam) * uFogDen;
          col = mix(col, uFogCol, 1.0 - exp(-fd * fd));
          float dist = length(vW.xz - uCam.xz);
          float fade = 1.0 - smoothstep(8000.0, 26000.0, dist);
          gl_FragColor = vec4(col, c * fade * 0.94 * uOpacity);
          // like every other material when drawing straight to the screen (the
          // low tier has no post-processing); a no-op into the composer's target
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
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

    // The weather: overcast hides the sun and flattens the light, fog greys
    // everything out, rain darkens the cloud base.
    const W = this.weather || { cloud: this.hunt.weather.clouds, rain: 0, snow: 0, fog: 0, haze: 0.25, precip: 0, lowFog: 0 };
    const over = smoothstep(0.35, 0.95, W.cloud); // how much of the sun the cloud hides
    // ground fog lies in a shallow layer: most of it goes into the valley mist
    // below, and the sky above stays clear
    const airFog = W.fog * (1 - 0.75 * W.lowFog);
    const grey = clamp(Math.max(over * 0.9, airFog * 0.95) + W.precip * 0.08, 0, 1);

    // light colour & strength (no golden hour under a grey sky)
    const e = clamp(elev / 50, -0.2, 1);
    const warm = (1 - smoothstep(2, 22, elev)) * (1 - 0.8 * grey);
    const night = 1 - smoothstep(-4, 3, elev);
    const sunCol = new THREE.Color(1, 0.97, 0.92).lerp(new THREE.Color(1.0, 0.58, 0.32), warm).lerp(COOL_SUN, 0.5 * grey);
    this.sun.color.copy(sunCol);
    this.sun.intensity = 3.4 * smoothstep(-2, 8, elev) * (0.65 + 0.35 * e) * (1 - 0.85 * over) * (1 - 0.55 * airFog);
    // under cloud the sky dome is the light: softer, greyer, a little stronger
    this.hemi.intensity = (0.25 + 0.55 * smoothstep(-6, 20, elev)) * (1 + 0.3 * grey);
    this.hemi.color.setRGB(0.62, 0.74, 0.95).lerp(_c.setRGB(0.9, 0.7, 0.6), warm * 0.5).lerp(GREY_SKY_LIGHT, grey);
    // soft, faint shadows under a thin deck; none worth the name under a thick one
    const shade = clamp(1 - 0.8 * over - 0.5 * airFog, 0.1, 1);
    this.sun.shadow.intensity = shade;
    if (this.farSun) this.farSun.shadow.intensity = shade;

    this.updateShadows(camera, playerPos);
    const structures = this.scene.userData.structures;
    if (structures) structures.update(elev);

    // fog colour ~ horizon colour; grey under cloud, white-grey in fog, darker in rain
    const day = new THREE.Color(0.66, 0.74, 0.82);
    const dawn = new THREE.Color(0.86, 0.68, 0.56);
    const dusk = new THREE.Color(0.12, 0.13, 0.18);
    const greyC = OVERCAST_GREY.clone().lerp(FOG_WHITE, airFog / (airFog + over + 1e-3)).multiplyScalar(1 - 0.22 * W.rain);
    // a hot, dusty day turns the haze the colour of the dust
    const dusty = 0.55 * smoothstep(0.5, 1, W.haze) * (1 - grey);
    const fogC = day.clone().lerp(DUST, dusty).lerp(dawn, warm * 0.75).lerp(greyC, grey).lerp(dusk, night);
    this.scene.fog.color.copy(fogC);
    // haze (a quarter is the ground's usual), thicker under cloud and in falling
    // rain or snow, and fog closing in to a couple of hundred metres
    this.scene.fog.density = this.hunt.weather.haze * (0.6 + 1.6 * W.haze) * (1 + 0.8 * over) + 0.0006 * W.rain + 0.0024 * W.snow + 0.0058 * Math.pow(airFog, 1.4);
    // aerial perspective: in clear air the haze builds steadily with distance
    // and thins with height, and blue light scatters out first, so ridge after
    // ridge fades into blue; fog and falling rain keep the plain grey wall
    aerial.x = clamp(1 - 1.4 * airFog - 0.6 * W.precip, 0, 1);
    aerial.y = this.mistBase();
    // eyes adapt: open up a little in the low light of dawn and dusk, and on a dull day
    // the eyes adapt to the dim half hour round sunrise and sunset: the land
    // stays readable under the glowing sky instead of going black
    const twilight = (1 - smoothstep(-1, 8, elev)) * smoothstep(-6, -2, elev);
    this.renderer.toneMappingExposure = 0.6 + 0.1 * smoothstep(0, 30, elev) + 0.12 * (1 - smoothstep(2, 14, elev)) * (1 - night) + 0.1 * grey * (1 - night) + 0.35 * twilight;

    // the sky dome follows: whiter with haze, greyed by cloud and fog
    const turb = this.hunt.weather.turbidity * TURBIDITY_MUL + 3 * grey + 4 * Math.max(0, W.haze - 0.25);
    for (const s of [this.sky, this.envSky]) {
      const su = s.material.uniforms;
      su.turbidity.value = turb;
      su.uGrey.value = grey * 0.92;
      su.uGreyCol.value.copy(fogC).multiplyScalar(1.05);
    }

    // sun glow in the haze, valley mist
    const daylight = smoothstep(-3, 6, elev);
    sunDirection.x = this.sunDir.x;
    sunDirection.y = this.sunDir.y;
    sunDirection.z = this.sunDir.z;
    const sc = 0.36 * daylight * (0.6 + 0.8 * warm) * (1 - 0.7 * grey);
    sunScatter.x = sunCol.r * sc;
    sunScatter.y = sunCol.g * sc;
    sunScatter.z = sunCol.b * sc;
    // the weather's fog fills the valleys too
    const amt = this.T.mist ? Math.max(this.mistAmount(this.hour), W.fog * (1.1 + 0.9 * W.lowFog)) : 0;
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

    this.updateGrade(elev, warm, night, amt, grey, W);

    // clouds: more of them, lower, flatter-lit and darker as the deck thickens;
    // lost in the grey when the fog is down
    const cu = this.clouds.material.uniforms;
    cu.uTime.value += dt;
    cu.uCover.value = this.weather ? 0.08 + 0.92 * W.cloud : this.hunt.weather.clouds;
    cu.uSunDir.value.copy(this.sunDir);
    cu.uSunCol.value.copy(sunCol).multiplyScalar((0.6 + 0.6 * smoothstep(-3, 15, elev)) * (1 - 0.45 * over));
    cu.uShadeCol.value.copy(fogC).multiplyScalar(0.85 * (1 - 0.18 * over - 0.25 * W.precip));
    cu.uCam.value.copy(camera.position);
    cu.uOpacity.value = 1 - 0.85 * airFog;
    cu.uFogCol.value.copy(fogC);
    cu.uFogDen.value = this.scene.fog.density * grey;
    this.clouds.position.set(camera.position.x, this.hunt.terrain.baseHeight + 2600 - 1200 * over - 300 * W.precip, camera.position.z);

    // image lighting: as the sun moves, and when the sky has greyed or
    // cleared noticeably (at most every 6 s: a refresh costs a few ms)
    const greyChanged = Math.abs(grey - this.lastEnvGrey) > 0.08 && this.time - this.lastEnvTime > 6;
    if (Math.abs(this.hour - this.lastEnvHour) > 0.08 || greyChanged) {
      this.lastEnvHour = this.hour;
      this.lastEnvGrey = grey;
      this.lastEnvTime = this.time;
      if (this.envRT) this.envRT.dispose();
      // the ground's own light: sun and sky on its albedo (Lambert), in the
      // sky shader's units (its radiance runs ~3x three's light units)
      const gE = _c.copy(sunCol).multiplyScalar(this.sun.intensity * Math.max(0, this.sunDir.y)).add(_c2.copy(this.hemi.color).multiplyScalar(this.hemi.intensity));
      this.envGround.material.color.copy(this.groundAlbedo).multiply(gE).multiplyScalar(1.1 / Math.PI / Math.max(0.1, this.scene.environmentIntensity || 0.5));
      this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 2000);
      this.scene.environment = this.envRT.texture;
      this.scene.environmentIntensity = 0.5 * smoothstep(-7, 12, elev) + 0.1;
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
  // little hazy and desaturated at midday, cooler in winter, blue at night;
  // flat, cool and muted on a grey day, more so in the rain.
  updateGrade(elev, warm, night, mist, grey = 0, W = null) {
    const noon = smoothstep(25, 45, elev) * (1 - grey);
    const w = this.winter;
    const rain = W ? W.precip : 0;
    const wb = look.whiteBalance;
    wb.set(1, 1, 1);
    wb.x *= 1 + 0.07 * warm - 0.03 * w - 0.12 * night - 0.03 * grey;
    wb.y *= 1 - 0.01 * warm - 0.06 * night;
    wb.z *= 1 - 0.1 * warm + 0.04 * w + 0.1 * night + 0.02 * noon + 0.035 * grey;
    // a touch richer than neutral: the photo-scanned ground and foliage are
    // captured flat and read a little grey under the haze
    look.saturation = 1.1 + 0.06 * warm - 0.08 * noon - 0.2 * night - 0.05 * mist - 0.14 * grey - 0.06 * rain;
    look.contrast = 1.09 + 0.06 * warm - 0.04 * noon - 0.06 * mist - 0.08 * grey;
    look.shadowTint.set(1 - 0.06 * warm - 0.02 * w, 1 - 0.02 * warm, 1 + 0.07 * warm + 0.03 * w + 0.02 * grey);
    look.highlightTint.set(1 + 0.04 * warm, 1 + 0.005 * warm, 1 - 0.05 * warm);
    look.vignette = 0.16 + 0.06 * night + 0.03 * grey;
    look.bloom = (0.12 + 0.12 * warm) * (1 - 0.4 * grey);
  }

  get light() {
    return this.sunDir.y;
  }
}
