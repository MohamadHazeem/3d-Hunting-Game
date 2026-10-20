import * as THREE from 'three';

// The colour grade for the current light. Atmosphere writes it as the sun
// moves; the post-processing pipeline reads it every frame.
export const look = {
  whiteBalance: new THREE.Vector3(1, 1, 1), // multiplies linear colour
  saturation: 1,
  contrast: 1, // around mid-grey, in log space
  shadowTint: new THREE.Vector3(1, 1, 1), // split toning: dark tones
  highlightTint: new THREE.Vector3(1, 1, 1), // bright tones
  vignette: 0.16,
  bloom: 0.16, // bloom strength
};

// Grade in linear light, before tone mapping (OutputPass applies ACES and sRGB).
export const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uWB: { value: look.whiteBalance },
    uSat: { value: 1 },
    uContrast: { value: 1 },
    uShadowTint: { value: look.shadowTint },
    uHighTint: { value: look.highlightTint },
    uVignette: { value: 0.16 },
    uAspect: { value: 1.7 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 uWB, uShadowTint, uHighTint;
    uniform float uSat, uContrast, uVignette, uAspect;
    varying vec2 vUv;
    void main() {
      vec4 tex = texture2D(tDiffuse, vUv);
      vec3 c = max(tex.rgb, vec3(0.0)) * uWB;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      // split toning by luminance (mid-grey is about 0.18 here)
      float t = smoothstep(0.02, 0.6, l);
      c *= mix(uShadowTint, uHighTint, t);
      // contrast around mid grey in log2 space
      vec3 lc = log2(max(c, vec3(1e-5)) / 0.18);
      c = 0.18 * exp2(lc * uContrast);
      l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSat);
      // soft optical vignette
      vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);
      c *= 1.0 - uVignette * smoothstep(0.35, 1.05, length(d));
      gl_FragColor = vec4(c, tex.a);
    }`,
};
