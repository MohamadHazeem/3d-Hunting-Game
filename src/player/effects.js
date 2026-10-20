import * as THREE from 'three';

// Soft particles for gun smoke and dust kicked up by shot hitting the ground,
// plus ejected shell hulls.

function softDot() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Particles {
  constructor(scene, cap = 1500) {
    this.cap = cap;
    this.n = 0;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 4);
    this.size = new Float32Array(cap);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { tex: { value: softDot() }, scale: { value: 600 } },
      vertexShader: /* glsl */ `
        attribute float size; attribute vec4 color; varying vec4 vC;
        uniform float scale;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tex; varying vec4 vC;
        void main(){ vec4 t = texture2D(tex, gl_PointCoord); gl_FragColor = vec4(vC.rgb, vC.a * t.a); if (gl_FragColor.a < 0.01) discard; }`,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
    this.list = [];
  }

  setViewportHeight(h, fov) {
    this.points.material.uniforms.scale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2));
  }

  emit(p, v, opt) {
    if (this.list.length >= this.cap) this.list.shift();
    this.list.push({
      p: p.clone(), v: v.clone(), life: opt.life, max: opt.life,
      s0: opt.size, s1: opt.grow ?? opt.size * 3, c: opt.color, a: opt.alpha ?? 0.5,
      drag: opt.drag ?? 1.5, rise: opt.rise ?? 0.3,
    });
  }

  smoke(p, dir) {
    for (let i = 0; i < 14; i++) {
      const v = dir.clone().multiplyScalar(2 + Math.random() * 8).add(new THREE.Vector3((Math.random() - 0.5) * 0.6, Math.random() * 0.4, (Math.random() - 0.5) * 0.6));
      this.emit(p, v, { life: 2 + Math.random() * 1.5, size: 0.12, grow: 1.4, color: [0.82, 0.82, 0.8], alpha: 0.32, drag: 3.5, rise: 0.25 });
    }
  }

  dust(p, color) {
    for (let i = 0; i < 3; i++) {
      const v = new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.6 + Math.random() * 1.2, (Math.random() - 0.5) * 1.2);
      this.emit(p, v, { life: 1.2 + Math.random(), size: 0.15, grow: 0.7, color, alpha: 0.55, drag: 2.5, rise: -0.6 });
    }
  }

  update(dt) {
    this.list = this.list.filter((q) => (q.life -= dt) > 0);
    const n = this.list.length;
    for (let i = 0; i < n; i++) {
      const q = this.list[i];
      q.v.multiplyScalar(Math.max(0, 1 - q.drag * dt));
      q.v.y += q.rise * dt;
      q.p.addScaledVector(q.v, dt);
      const t = 1 - q.life / q.max;
      this.pos[i * 3] = q.p.x;
      this.pos[i * 3 + 1] = q.p.y;
      this.pos[i * 3 + 2] = q.p.z;
      this.col[i * 4] = q.c[0];
      this.col[i * 4 + 1] = q.c[1];
      this.col[i * 4 + 2] = q.c[2];
      this.col[i * 4 + 3] = q.a * (1 - t) * Math.min(1, t * 20);
      this.size[i] = q.s0 + (q.s1 - q.s0) * Math.sqrt(t);
    }
    const g = this.points.geometry;
    g.setDrawRange(0, n);
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
  }
}

export class ShellHulls {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    const hull = new THREE.CylinderGeometry(0.0105, 0.0105, 0.07, 10);
    hull.translate(0, 0.035, 0);
    const brass = new THREE.CylinderGeometry(0.0112, 0.0112, 0.012, 10);
    brass.translate(0, 0.006, 0);
    this.geoHull = hull;
    this.geoBrass = brass;
    this.matHull = new THREE.MeshStandardMaterial({ color: 0x9a1f1a, roughness: 0.6 });
    this.matBrass = new THREE.MeshStandardMaterial({ color: 0xc8a050, metalness: 1, roughness: 0.35 });
    this.list = [];
  }

  makeShell() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(this.geoHull, this.matHull));
    g.add(new THREE.Mesh(this.geoBrass, this.matBrass));
    return g;
  }

  eject(pos, vel) {
    const m = this.makeShell();
    m.position.copy(pos);
    this.scene.add(m);
    this.list.push({ m, v: vel.clone(), spin: new THREE.Vector3(Math.random() * 12, Math.random() * 8, Math.random() * 12), t: 0, rest: false });
    if (this.list.length > 40) {
      const old = this.list.shift();
      this.scene.remove(old.m);
    }
  }

  update(dt) {
    for (const s of this.list) {
      s.t += dt;
      if (s.rest) continue;
      s.v.y -= 9.81 * dt;
      s.m.position.addScaledVector(s.v, dt);
      s.m.rotation.x += s.spin.x * dt;
      s.m.rotation.z += s.spin.z * dt;
      const g = this.terrain.height(s.m.position.x, s.m.position.z) + 0.011;
      if (s.m.position.y < g) {
        s.m.position.y = g;
        if (Math.abs(s.v.y) < 1) {
          s.rest = true;
          s.m.rotation.set(Math.PI / 2, s.m.rotation.y, 0);
        } else {
          s.v.y *= -0.3;
          s.v.x *= 0.5;
          s.v.z *= 0.5;
        }
      }
    }
  }
}
