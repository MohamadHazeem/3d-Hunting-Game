import * as THREE from 'three';
import { buildShotgunModel } from '../player/shotgun.js';

// Other hunters: camo jacket, hunter-orange cap, shotgun in hand, name tag.

function nameTag(name) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = '700 30px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  const w = Math.min(250, ctx.measureText(name).width + 28);
  ctx.fillRect(128 - w / 2, 10, w, 44);
  ctx.fillStyle = '#ffd38a';
  ctx.fillText(name, 128, 33);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, transparent: true }));
  sp.scale.set(1.2, 0.3, 1);
  sp.renderOrder = 10;
  return sp;
}

export class Avatar {
  constructor(scene, name) {
    this.scene = scene;
    const g = new THREE.Group();
    const camo = new THREE.MeshStandardMaterial({ color: 0x5a5a3a, roughness: 0.95 });
    const pants = new THREE.MeshStandardMaterial({ color: 0x4a4334, roughness: 0.95 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xc89a7a, roughness: 0.8 });
    const orange = new THREE.MeshStandardMaterial({ color: 0xff6a10, roughness: 0.7 });
    const boots = new THREE.MeshStandardMaterial({ color: 0x2a2018, roughness: 0.8 });
    this.legs = [];
    for (const sx of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(sx * 0.11, 0.9, 0);
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.72, 4, 8), pants);
      leg.position.y = -0.42;
      hip.add(leg);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.12, 0.26), boots);
      boot.position.set(0, -0.86, 0.05);
      hip.add(boot);
      g.add(hip);
      this.legs.push(hip);
    }
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.46, 4, 10), camo);
    torso.position.y = 1.22;
    torso.scale.z = 0.75;
    g.add(torso);
    // cartridge belt
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.03, 6, 20), new THREE.MeshStandardMaterial({ color: 0x6a4a2a }));
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.98;
    belt.scale.y = 0.75;
    g.add(belt);
    const head = new THREE.Group();
    head.position.y = 1.66;
    head.add(new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 12), skin));
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.122, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), orange);
    cap.position.y = 0.02;
    head.add(cap);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.01, 12, 1, false, -Math.PI / 2, Math.PI), orange);
    brim.position.set(0, 0.03, -0.09);
    head.add(brim);
    g.add(head);
    this.head = head;
    // arms + gun as one unit that pitches with the aim
    const aim = new THREE.Group();
    aim.position.set(0, 1.45, 0);
    for (const sx of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.42, 4, 8), camo);
      arm.rotation.x = Math.PI / 2.4;
      arm.position.set(sx * 0.17, -0.12, -0.2);
      aim.add(arm);
    }
    const gun = buildShotgunModel().gun;
    gun.position.set(0.05, -0.05, -0.15);
    gun.traverse((o) => o.isMesh && (o.castShadow = true));
    aim.add(gun);
    g.add(aim);
    this.aim = aim;
    this.tag = nameTag(name);
    this.tag.position.y = 2.15;
    g.add(this.tag);
    g.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    scene.add(g);
    this.root = g;
    this.samples = [];
    this.walk = 0;
    this.lastPos = new THREE.Vector3();
  }

  push(s) {
    this.samples.push({ ...s, t: performance.now() / 1000 });
    if (this.samples.length > 10) this.samples.shift();
  }

  update(dt) {
    const rt = performance.now() / 1000 - 0.1;
    const s = this.samples;
    if (!s.length) return;
    let i = s.length - 1;
    while (i > 0 && s[i - 1].t > rt) i--;
    const a = s[Math.max(0, i - 1)];
    const b = s[i];
    const k = b.t > a.t ? Math.min(1, Math.max(0, (rt - a.t) / (b.t - a.t))) : 1;
    const x = a.p[0] + (b.p[0] - a.p[0]) * k;
    const y = a.p[1] + (b.p[1] - a.p[1]) * k;
    const z = a.p[2] + (b.p[2] - a.p[2]) * k;
    this.root.position.set(x, y, z);
    let dy = b.yaw - a.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.root.rotation.y = a.yaw + dy * k;
    this.aim.rotation.x = a.pitch + (b.pitch - a.pitch) * k;
    this.head.rotation.x = this.aim.rotation.x * 0.6;
    const crouch = b.crouch ? 0.55 : 0;
    this.root.scale.y = 1 - crouch * 0.4;
    const speed = this.lastPos.distanceTo(this.root.position) / Math.max(dt, 1e-3);
    this.lastPos.copy(this.root.position);
    this.walk += dt * Math.min(speed, 7) * 2.4;
    const sw = Math.sin(this.walk) * Math.min(1, speed / 2) * 0.6;
    this.legs[0].rotation.x = sw;
    this.legs[1].rotation.x = -sw;
  }

  dispose() {
    this.scene.remove(this.root);
  }
}
