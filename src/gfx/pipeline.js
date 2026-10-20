import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { tierSettings, gfxSettings, registerPipeline } from './quality.js';
import { look, GradeShader } from './look.js';
import { SceneLife } from './life.js';

// Ambient occlusion from the scene's own depth buffer (so alpha-tested leaves
// occlude correctly), optionally at half resolution.
class SceneAO extends GTAOPass {
  constructor(scene, camera, w, h, half) {
    super(scene, camera, w, h);
    this.half = half;
    // Only near the hunter: far away the depth buffer is too coarse to rebuild
    // normals from (distant hills would come out striped), and AO there is
    // invisible anyway.
    const fs = this.gtaoMaterial.fragmentShader
      .replace(
        'vec3 viewPos = getViewPosition(vUv, depth);',
        'vec3 viewPos = getViewPosition(vUv, depth);\n\t\t\tif (-viewPos.z > 160.0) { discard; return; }'
      )
      .replace('ao = pow(ao, scale);', 'ao = pow(ao, scale);\n\t\t\tao = mix(ao, 1.0, smoothstep(90.0, 160.0, -viewPos.z));');
    this.gtaoMaterial.fragmentShader = fs;
    this.gtaoMaterial.needsUpdate = true;
    this.updateGtaoMaterial({ radius: 1.4, distanceExponent: 1.6, thickness: 2.5, distanceFallOff: 1, scale: 1, samples: half ? 8 : 12 });
    this.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: half ? 8 : 12 });
    this.blendIntensity = 0.75;
  }

  setSize(w, h) {
    const k = this.half ? 0.5 : 1;
    super.setSize(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
  }

  render(renderer, writeBuffer, readBuffer, dt, mask) {
    // the composer ping-pongs, so pick up whichever buffer the scene went into
    if (readBuffer.depthTexture && this.depthTexture !== readBuffer.depthTexture) this.setGBuffer(readBuffer.depthTexture);
    super.render(renderer, writeBuffer, readBuffer, dt, mask);
  }
}

// Renders the game: post-processing for the quality tier, dynamic resolution
// to hold ~60 fps, and the purely visual scene life (dust, falling leaves,
// grass bending) that rides along with each frame.
export class GfxPipeline {
  constructor(renderer, scene, camera, tier) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.tier = tier;
    this.T = tierSettings(tier);
    this.base = Math.min(window.devicePixelRatio || 1, this.T.pixelRatio);
    this.scale = gfxSettings.renderScale ?? 1;
    this.applied = 0;
    this.fps = 60;
    this.last = performance.now();
    this.window = [];
    this.windowStart = this.last;
    this.started = this.last;
    this.lastDown = -1e9;
    this.lastUp = -1e9;
    this.probeWait = 4000;
    this.cssW = innerWidth;
    this.cssH = innerHeight;
    this.life = null;
    renderer.setPixelRatio(this.base * this.scale);
    this.applied = this.scale;
    if (this.T.post) this.buildComposer();
    registerPipeline(this);
  }

  buildComposer() {
    const T = this.T;
    const r = this.renderer;
    const pr = r.getPixelRatio();
    const rt = new THREE.WebGLRenderTarget(this.cssW * pr, this.cssH * pr, {
      type: THREE.HalfFloatType,
      samples: T.msaa,
    });
    if (T.ao) rt.depthTexture = new THREE.DepthTexture(this.cssW * pr, this.cssH * pr);
    const composer = new EffectComposer(r, rt);
    composer.addPass(new RenderPass(this.scene, this.camera));
    if (T.ao) {
      this.ao = new SceneAO(this.scene, this.camera, this.cssW * pr, this.cssH * pr, T.ao === 'half');
      composer.addPass(this.ao);
    }
    if (T.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(this.cssW * pr, this.cssH * pr), look.bloom, 0.55, 3.0);
      composer.addPass(this.bloom);
    }
    if (T.grade) {
      this.grade = new ShaderPass(GradeShader);
      composer.addPass(this.grade);
    }
    composer.addPass(new OutputPass());
    composer.setPixelRatio(pr);
    composer.setSize(this.cssW, this.cssH);
    this.composer = composer;
  }

  setSize(w, h) {
    this.cssW = w;
    this.cssH = h;
    if (this.composer) this.composer.setSize(w, h);
    if (this.grade) this.grade.uniforms.uAspect.value = w / Math.max(1, h);
  }

  // Settings menu changed the fixed render scale (or back to dynamic).
  applyRenderScale() {
    if (gfxSettings.renderScale != null) this.scale = gfxSettings.renderScale;
    this.setScale(this.scale);
  }

  setScale(s) {
    this.scale = s;
    if (Math.abs(s - this.applied) < 0.01) return;
    this.applied = s;
    const pr = this.base * s;
    this.renderer.setPixelRatio(pr);
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(this.cssW, this.cssH);
    }
  }

  // Dynamic resolution: watch frame times in half-second windows; drop the
  // render scale when we fall under ~55 fps, raise it when there is clear
  // headroom, and on 60 Hz screens probe upwards now and then, backing off
  // each time a probe fails so the scale never oscillates.
  updateDynamic(now, interval) {
    if (gfxSettings.renderScale != null) return;
    if (interval > 250) {
      // a pause or a hidden tab: start a fresh window
      this.window.length = 0;
      this.windowStart = now;
      return;
    }
    this.window.push(interval);
    if (now - this.windowStart < 500) return;
    const w = this.window.sort((a, b) => a - b);
    const med = w[w.length >> 1];
    this.window.length = 0;
    this.windowStart = now;
    this.fps = 1000 / med;
    if (now - this.started < 2500) return; // shaders still compiling
    const T = this.T;
    let s = this.scale;
    if (med > 18) {
      s = Math.max(T.minScale, s * (med > 26 ? 0.84 : 0.92));
      if (now - this.lastUp < 2500) this.probeWait = Math.min(60000, this.probeWait * 2); // the last raise was too much
      this.lastDown = now;
    } else if (s < 1 && now - this.lastDown > 3000) {
      if (med < 12.5) {
        s = Math.min(1, s * 1.06);
        this.lastUp = now;
      } else if (now - this.lastDown > this.probeWait && now - this.lastUp > this.probeWait) {
        s = Math.min(1, s * 1.05);
        this.lastUp = now;
      }
    }
    s = Math.round(s * 40) / 40;
    if (s !== this.scale) this.setScale(s);
  }

  updateLook() {
    if (this.grade) {
      const u = this.grade.uniforms;
      u.uWB.value.copy(look.whiteBalance);
      u.uSat.value = look.saturation;
      u.uContrast.value = look.contrast;
      u.uShadowTint.value.copy(look.shadowTint);
      u.uHighTint.value.copy(look.highlightTint);
      u.uVignette.value = look.vignette;
      u.uAspect.value = this.cssW / Math.max(1, this.cssH);
    }
    if (this.bloom) this.bloom.strength = look.bloom;
  }

  render(game) {
    const now = performance.now();
    const interval = now - this.last;
    this.last = now;
    const dt = Math.min(0.1, interval / 1000);
    this.updateDynamic(now, interval);
    if (!this.life && game.terrain) this.life = new SceneLife(game, this.T);
    if (this.life) this.life.update(game, dt);
    // particles are sized in pixels: keep them right as resolution and zoom change
    if (game.fx) game.fx.setViewportHeight(this.renderer.domElement.height, this.camera.fov);
    this.updateLook();
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }
}
