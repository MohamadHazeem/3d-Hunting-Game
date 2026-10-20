// Graphics quality tiers, automatic detection, and the settings the menus
// read and change.
//
//   resolveQuality(requested, renderer) -> 'low' | 'medium' | 'high' | 'ultra'
//   TIERS[tier]                         -> what each tier turns on
//   gfxSettings                         -> what the player chose (persisted)
//   setRenderScale(v | null)            -> fixed render scale, or null = dynamic
//   getQualityInfo()                    -> live numbers for a settings screen

import * as THREE from 'three';

export const QUALITY_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'low', label: 'Low (laptops)' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High (gaming PC)' },
  { value: 'ultra', label: 'Ultra' },
];

// pixelRatio is the most a tier renders at (capped by the screen's own ratio);
// dynamic resolution scales below it when frames get slow.
export const TIERS = {
  low: {
    pixelRatio: 1, minScale: 0.6,
    post: false, msaa: 0, bloom: false, ao: false, grade: false,
    shadows: false, shadowMap: 0, shadowExt: 0, farShadowMap: 0,
    detail: 0.5, mist: true, leaves: true,
  },
  medium: {
    pixelRatio: 1.5, minScale: 0.55,
    post: true, msaa: 4, bloom: true, ao: false, grade: true,
    shadows: true, shadowMap: 2048, shadowExt: 55, farShadowMap: 2048,
    detail: 0.8, mist: true, leaves: true,
  },
  high: {
    pixelRatio: 2, minScale: 0.5,
    post: true, msaa: 4, bloom: true, ao: 'half', grade: true,
    shadows: true, shadowMap: 4096, shadowExt: 70, farShadowMap: 4096,
    detail: 1, mist: true, leaves: true,
  },
  ultra: {
    pixelRatio: 2, minScale: 0.5,
    post: true, msaa: 4, bloom: true, ao: 'full', grade: true,
    shadows: true, shadowMap: 4096, shadowExt: 95, farShadowMap: 4096,
    detail: 1.25, mist: true, leaves: true,
  },
};

const ORDER = ['low', 'medium', 'high', 'ultra'];

function load(k, d) {
  try {
    return localStorage.getItem('lbh.' + k) ?? d;
  } catch {
    return d;
  }
}
function save(k, v) {
  try {
    if (v == null) localStorage.removeItem('lbh.' + k);
    else localStorage.setItem('lbh.' + k, v);
  } catch {}
}

export const gfxSettings = {
  // fixed render scale (0.5–1) or null for dynamic resolution
  renderScale: (() => {
    const v = parseFloat(load('renderScale', ''));
    return Number.isFinite(v) ? Math.min(1, Math.max(0.5, v)) : null;
  })(),
};

const state = {
  requested: null,
  tier: null,
  gpu: '',
  detectedBy: '',
  benchMs: null,
  pipeline: null, // set by the GfxPipeline so settings changes apply live
};

export function gpuName(renderer) {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  } catch {
    return '';
  }
}

// First guess from the GPU's name (null when the name tells us nothing).
// Laptops with high-density screens get 'high' rather than 'ultra': dynamic
// resolution keeps them smooth, and ultra's full-resolution effects at
// 3000+ pixels wide cost more than they show.
function tierFromName(name) {
  const n = name.toLowerCase();
  if (/swiftshader|llvmpipe|software|basic render|microsoft basic/.test(n)) return 'low';
  if (/mali|adreno|powervr|apple a\d/.test(n)) return 'low';
  const m = n.match(/apple m(\d+)\s*(pro|max|ultra)?/);
  if (m) return m[2] || +m[1] >= 3 ? 'high' : 'medium';
  if (/apple/.test(n)) return 'high';
  if (/rtx\s*[2-9]\d|rx\s*[6-9]\d{3}|radeon pro w|arc\s*a7/.test(n)) return 'ultra';
  if (/nvidia|geforce|gtx|quadro|rx\s*\d|radeon pro|arc/.test(n)) return 'high';
  if (/iris|radeon\(tm\) graphics|radeon graphics|vega/.test(n)) return 'medium';
  if (/intel|uhd|hd graphics/.test(n)) return 'low';
  return null;
}

// A quick fill-rate test: a heavy fragment shader over 1024x1024 pixels a few
// times, timed with a readPixels to wait for the GPU. ~1 ms on a fast GPU.
function fillBench(renderer) {
  const rt = new THREE.WebGLRenderTarget(1024, 1024, { depthBuffer: false });
  const mat = new THREE.ShaderMaterial({
    vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform float uSeed;
      void main(){
        vec2 p = gl_FragCoord.xy * 0.01 + uSeed;
        float s = 0.0;
        for (int i = 0; i < 48; i++) { s += sin(p.x * 1.3 + float(i)) * cos(p.y * 0.7 - s); p = p.yx * 1.01; }
        gl_FragColor = vec4(vec3(s * 0.01), 1.0);
      }`,
    uniforms: { uSeed: { value: 0 } },
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.Camera();
  const gl = renderer.getContext();
  const px = new Uint8Array(4);
  const prev = renderer.getRenderTarget();
  const run = (n) => {
    renderer.setRenderTarget(rt);
    for (let i = 0; i < n; i++) {
      mat.uniforms.uSeed.value = i;
      renderer.render(scene, cam);
    }
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  };
  run(1); // compile + warm up
  const t0 = performance.now();
  run(4);
  const ms = (performance.now() - t0) / 4;
  renderer.setRenderTarget(prev);
  rt.dispose();
  mat.dispose();
  quad.geometry.dispose();
  return ms;
}

// Turn the menu choice into a concrete tier. 'auto' guesses from the GPU name
// and checks it with a short benchmark.
export async function resolveQuality(requested, renderer) {
  state.requested = requested;
  state.gpu = gpuName(renderer);
  if (ORDER.includes(requested)) {
    state.tier = requested;
    state.detectedBy = 'chosen';
    return requested;
  }
  const named = tierFromName(state.gpu);
  let tier = named || 'medium';
  state.detectedBy = 'gpu';
  try {
    const ms = fillBench(renderer);
    state.benchMs = +ms.toFixed(2);
    // measured: ~0.6 ms on an Apple M5 Pro; integrated GPUs land around 4–10 ms
    const byBench = ms < 1.2 ? 'ultra' : ms < 2.5 ? 'high' : ms < 6 ? 'medium' : 'low';
    // a known GPU is never raised above its name, only lowered if it
    // benchmarks slower (thermal limits, power saving); an unknown one goes
    // by the benchmark alone
    const a = ORDER.indexOf(tier);
    const b = ORDER.indexOf(byBench);
    tier = named ? ORDER[Math.min(a, b)] : byBench;
    state.detectedBy = named ? 'gpu+benchmark' : 'benchmark';
  } catch (e) {
    console.warn('Quality benchmark failed', e);
  }
  state.tier = tier;
  return tier;
}

export function tierSettings(tier) {
  return TIERS[tier] || TIERS.medium;
}

export function setRenderScale(v) {
  gfxSettings.renderScale = v == null ? null : Math.min(1, Math.max(0.5, v));
  save('renderScale', gfxSettings.renderScale);
  if (state.pipeline) state.pipeline.applyRenderScale();
}

export function registerPipeline(p) {
  state.pipeline = p;
}

export function getQualityInfo() {
  const p = state.pipeline;
  return {
    requested: state.requested,
    tier: state.tier,
    gpu: state.gpu,
    detectedBy: state.detectedBy,
    benchMs: state.benchMs,
    renderScale: p ? +p.scale.toFixed(2) : null,
    dynamic: gfxSettings.renderScale == null,
    pixelRatio: p ? +p.renderer.getPixelRatio().toFixed(2) : null,
    fps: p ? Math.round(p.fps) : null,
  };
}
