import * as THREE from 'three';

// Materials for everything that grows: bark and leaves of the trees and
// shrubs, and (through the helpers) the grass. Shared pieces:
//  - wind: trunks lean with the gusts, limbs bob on their own phase, leaves
//    flutter; driven by `aux` = (occlusion, bend, phase, leaf) per vertex
//  - occlusion baked into the trees (inner and lower leaves darker)
//  - light through the leaves: thin leaves glow when the sun is behind them

export const windUniforms = { uTime: { value: 0 }, uWind: { value: 1 } };
// the prevailing westerly, in world space (the trees all lean the same way)
const WIND_DIR = new THREE.Vector3(0.95, 0, 0.3).normalize();

// Translucency, added to the sun's direct light for leaf materials. The sun's
// colour here already has its shadow applied, so shaded leaves don't glow.
export function translucentLights(trans) {
  return THREE.ShaderChunk.lights_physical_pars_fragment.replace(
    'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );\n}',
    `reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );
  {
    // wrapped round the dark side, and strongest looking towards the sun
    float lbhBack = saturate( dot( - geometryNormal, directLight.direction ) * 0.6 + 0.4 );
    float lbhFwd = pow( saturate( dot( geometryViewDir, - directLight.direction ) ), 5.0 );
    reflectedLight.directDiffuse += directLight.color * material.diffuseColor * RECIPROCAL_PI * ${trans.toFixed(3)} * ( 0.35 * lbhBack + 2.2 * lbhFwd );
  }
}`
  );
}

const WIND_PARS = /* glsl */ `
uniform float uTime;
uniform float uWind;
attribute vec4 aux;
varying float vAO;
`;

const WIND_VERTEX = /* glsl */ `
{
  vec3 ip = vec3(0.0);
  mat3 im = mat3(1.0);
  #ifdef USE_INSTANCING
    ip = instanceMatrix[3].xyz;
    im = mat3(instanceMatrix);
  #endif
  float tph = ip.x * 0.21 + ip.z * 0.17;
  float b = aux.y * aux.y;
  // the whole tree leans with the gusts, downwind
  float gust = 0.55 + sin(uTime * 0.8 + tph) * 0.3 + sin(uTime * 2.1 + tph * 1.7) * 0.15;
  vec3 wd = normalize(transpose(im) * vec3(${WIND_DIR.x.toFixed(3)}, 0.0, ${WIND_DIR.z.toFixed(3)}));
  transformed += wd * gust * b * 0.07 * uWind;
  // limbs bob and swing on their own
  float ph = aux.z * 6.2832 + tph;
  transformed.y += sin(uTime * 1.9 + ph) * 0.035 * b * uWind;
  transformed.xz += vec2(cos(uTime * 1.5 + ph), sin(uTime * 1.7 + ph * 1.3)) * 0.03 * aux.y * uWind;
  // leaves flutter
  transformed += objectNormal * sin(uTime * 7.5 + aux.z * 41.0 + position.x * 3.1 + position.y * 2.3) * 0.022 * aux.w * min(aux.y, 1.0) * uWind;
  vAO = aux.x;
}
`;

// kind: 'leaf' or 'bark'. For leaves: tex is the foliage atlas; opts.trans
// how much light comes through, opts.a2c alpha to coverage (needs MSAA).
export function treeMaterial(kind, opts) {
  const leaf = kind === 'leaf';
  const m = new THREE.MeshStandardMaterial({
    map: opts.map || null,
    normalMap: opts.normalMap || null,
    color: opts.color ?? 0xffffff,
    roughness: opts.roughness ?? (leaf ? 0.72 : 0.93),
    metalness: 0,
    side: leaf ? THREE.DoubleSide : THREE.FrontSide,
    alphaTest: leaf ? 0.5 : 0,
    alphaToCoverage: leaf && !!opts.a2c,
  });
  const trans = opts.trans ?? 0.6;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.uniforms.uWind = windUniforms.uWind;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + WIND_PARS)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + WIND_VERTEX);
    let fs = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAO;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= vAO;')
      // occlusion also dims the sky light
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= vAO * 0.35 + 0.65;\nreflectedLight.indirectSpecular *= vAO;');
    if (leaf) {
      fs = fs
        // cards carry crown-shaped normals; keep them on both faces
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n normal = normalize(vNormal); nonPerturbedNormal = normal;')
        .replace('#include <lights_physical_pars_fragment>', translucentLights(trans));
    }
    shader.fragmentShader = fs;
  };
  m.customProgramCacheKey = () => (leaf ? 'tree-leaf:' + trans : 'tree-bark');
  return m;
}
