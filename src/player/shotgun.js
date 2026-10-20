import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { audio } from '../audio/audio.js';
import { Random } from '../core/rng.js';

// 12-gauge over-under ("جفت") with a walnut stock. Two shots, then break it
// open to reload. Each shot is ~400 real #8 pellets flying with drag and
// time of flight, so crossing birds need proper lead.

const PELLETS = 400;
const MUZZLE_V = 385; // m/s
const DRAG = 0.0187; // quadratic drag: speed halves at ~37 m
const MIN_LETHAL_V = 120;
// pattern spread (radians, 1 sigma) for the two chokes
const CHOKES = [
  { name: 'Improved Cylinder', sigma: 0.0118 },
  { name: 'Full', sigma: 0.0072 },
];

function walnutTexture() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#4a2814';
  ctx.fillRect(0, 0, 512, 128);
  const r = new Random(4);
  for (let i = 0; i < 90; i++) {
    const y = r.float(0, 128);
    ctx.strokeStyle = `rgba(${r.int(20, 50)},${r.int(8, 20)},0,${r.float(0.2, 0.6)})`;
    ctx.lineWidth = r.float(0.5, 3);
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= 512; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * r.float(2, 9));
    ctx.stroke();
  }
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = `rgba(140,80,40,${r.float(0.05, 0.15)})`;
    ctx.fillRect(r.float(0, 512), r.float(0, 128), r.float(20, 120), r.float(2, 8));
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function engravingTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#a9a9a6';
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = 'rgba(40,40,40,0.55)';
  ctx.lineWidth = 1.2;
  const r = new Random(9);
  for (let i = 0; i < 26; i++) {
    const x = r.float(0, 256);
    const y = r.float(0, 256);
    const s = r.float(8, 28);
    ctx.beginPath();
    for (let a = 0; a < Math.PI * 4; a += 0.2) ctx.lineTo(x + Math.cos(a) * s * (a / 12), y + Math.sin(a) * s * (a / 12));
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildShotgunModel() {
  const gun = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x18191c, metalness: 0.9, roughness: 0.32 });
  const silver = new THREE.MeshStandardMaterial({ map: engravingTexture(), metalness: 1.0, roughness: 0.28 });
  const wood = new THREE.MeshStandardMaterial({ map: walnutTexture(), roughness: 0.45, metalness: 0 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });

  // Barrel assembly hinges at the front of the action.
  const hinge = new THREE.Group();
  hinge.position.set(0, -0.062, -0.095);
  gun.add(hinge);
  const bar = new THREE.Group();
  bar.position.set(0, 0.062, 0.095);
  hinge.add(bar);
  const BL = 0.71;
  for (const [y, i] of [[-0.0235, 0], [-0.0475, 1]]) {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.0108, 0.0118, BL, 20), steel);
    b.rotation.x = Math.PI / 2;
    b.position.set(0, y, -0.095 - BL / 2);
    bar.add(b);
    const bore = new THREE.Mesh(new THREE.CircleGeometry(0.0092, 16), new THREE.MeshBasicMaterial({ color: 0x000000 }));
    bore.position.set(0, y, -0.095 - BL - 0.0005);
    bore.rotation.y = Math.PI;
    bar.add(bore);
  }
  const rib = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.004, BL), steel);
  rib.position.set(0, -0.0105, -0.095 - BL / 2);
  bar.add(rib);
  const bead = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 10, 8), new THREE.MeshStandardMaterial({ color: 0xf2e6c0, emissive: 0x332a10, roughness: 0.3 }));
  bead.position.set(0, -0.0072, -0.095 - BL + 0.01);
  bar.add(bead);
  const foreGeo = new RoundedBoxGeometry(0.046, 0.036, 0.27, 3, 0.012);
  const fore = new THREE.Mesh(foreGeo, wood);
  fore.position.set(0, -0.069, -0.26);
  bar.add(fore);
  // shells sitting in the chambers (visible when broken open)
  const chambers = [];
  for (const y of [-0.0235, -0.0475]) {
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.0112, 0.0112, 0.003, 14), new THREE.MeshStandardMaterial({ color: 0xc8a050, metalness: 1, roughness: 0.3 }));
    rim.rotation.x = Math.PI / 2;
    rim.position.set(0, y, -0.0935);
    bar.add(rim);
    chambers.push(rim);
  }

  // Action / receiver
  const action = new THREE.Mesh(new RoundedBoxGeometry(0.042, 0.062, 0.1, 2, 0.006), silver);
  action.position.set(0, -0.04, -0.045);
  gun.add(action);
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.006, 0.04), steel);
  lever.position.set(0.006, -0.006, 0.0);
  lever.rotation.y = -0.3;
  gun.add(lever);
  const guard = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.003, 6, 16, Math.PI), steel);
  guard.rotation.set(0, Math.PI / 2, Math.PI);
  guard.position.set(0, -0.075, -0.01);
  gun.add(guard);
  const trigger = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.02, 0.006), silver);
  trigger.position.set(0, -0.08, -0.012);
  trigger.rotation.x = 0.3;
  gun.add(trigger);

  // Stock: extruded profile with comb, pistol grip and butt.
  const s = new THREE.Shape();
  s.moveTo(0.0, -0.016);
  s.lineTo(0.08, -0.03);
  s.quadraticCurveTo(0.14, -0.04, 0.2, -0.046);
  s.lineTo(0.365, -0.064);
  s.lineTo(0.37, -0.2);
  s.quadraticCurveTo(0.25, -0.15, 0.13, -0.11);
  s.quadraticCurveTo(0.08, -0.115, 0.07, -0.13);
  s.lineTo(0.035, -0.125);
  s.quadraticCurveTo(0.03, -0.085, 0.0, -0.072);
  s.lineTo(0.0, -0.016);
  const stockGeo = new THREE.ExtrudeGeometry(s, { depth: 0.032, bevelEnabled: true, bevelThickness: 0.007, bevelSize: 0.006, bevelSegments: 3, curveSegments: 10 });
  stockGeo.translate(0, 0, -0.016);
  stockGeo.rotateY(-Math.PI / 2);
  const uv = stockGeo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2.6, uv.getY(i) * 2.6);
  const stockGroup = new THREE.Group();
  gun.add(stockGroup);
  const stock = new THREE.Mesh(stockGeo, wood);
  stockGroup.add(stock);
  const pad = new THREE.Mesh(new RoundedBoxGeometry(0.048, 0.14, 0.018, 2, 0.006), rubber);
  pad.position.set(0, -0.132, 0.375);
  pad.rotation.x = -0.04;
  stockGroup.add(pad);

  gun.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = false;
      o.receiveShadow = false;
      o.frustumCulled = false;
    }
  });
  return { gun, hinge, bar, chambers, stock: stockGroup, muzzleLocal: [new THREE.Vector3(0, -0.0475, -0.095 - BL), new THREE.Vector3(0, -0.0235, -0.095 - BL)] };
}

export class Shotgun {
  constructor(camera, scene, world, fx, hulls) {
    this.camera = camera;
    this.scene = scene;
    this.world = world;
    this.fx = fx;
    this.hulls = hulls;
    const m = buildShotgunModel();
    this.model = m;
    this.holder = new THREE.Group();
    this.holder.add(m.gun);
    camera.add(this.holder);
    this.loaded = [true, true];
    this.fired = [false, false];
    this.reserve = 100;
    this.barrel = 0;
    this.ads = 0;
    this.recoil = 0;
    this.recoilV = 0;
    this.reloading = null;
    this.shots = [];
    this.flash = new THREE.PointLight(0xffb060, 0, 18, 2);
    scene.add(this.flash);
    this.flashT = 0;
    this.flashSprite = this.makeFlashSprite();
    m.gun.add(this.flashSprite);
    this.sway = new THREE.Vector2();
    this.lastYaw = 0;
    this.lastPitch = 0;
    this.onShot = null; // (origin, dir, barrel) -> void
    this.onBirdHits = null; // (birdId, hits, impulse, distance) -> void
    this.lower = 0;
  }

  makeFlashSprite() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,240,200,1)');
    g.addColorStop(0.3, 'rgba(255,170,60,0.8)');
    g.addColorStop(1, 'rgba(255,120,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    sp.scale.set(0.18, 0.18, 0.18);
    sp.position.copy(this.model.muzzleLocal[0]).add(new THREE.Vector3(0, 0, -0.05));
    sp.visible = false;
    return sp;
  }

  get canFire() {
    return !this.reloading && (this.loaded[0] || this.loaded[1]);
  }

  trigger() {
    if (this.reloading) return false;
    let b = this.loaded[0] ? 0 : this.loaded[1] ? 1 : -1;
    if (b < 0) {
      audio.play('dry', null, { gain: 0.6 });
      return false;
    }
    this.fire(b);
    return true;
  }

  fire(b) {
    this.loaded[b] = false;
    this.fired[b] = true;
    const cam = this.camera;
    cam.updateMatrixWorld();
    const origin = new THREE.Vector3();
    cam.getWorldPosition(origin);
    // the shot follows where the barrels point (centre of view when mounted)
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()));
    if (this.ads < 0.8) {
      // shooting from the hip is less precise
      dir.x += (Math.random() - 0.5) * 0.035;
      dir.y += (Math.random() - 0.5) * 0.035 - 0.01;
      dir.normalize();
    }
    this.spawnShot(origin, dir, b, true);
    audio.gunshot(origin, true);
    this.recoilV += 9;
    this.flashT = 0.05;
    const muzzleWorld = this.model.muzzleLocal[b].clone();
    this.model.gun.localToWorld(muzzleWorld);
    this.flash.position.copy(muzzleWorld);
    this.fx.smoke(muzzleWorld, dir);
    this.world.birds.gunshot(origin, 'me');
    if (this.onShot) this.onShot(origin, dir, b);
    return true;
  }

  // Simulate a shot. `local` shots resolve hits against birds; remote ones are visual only.
  spawnShot(origin, dir, barrel, local, seed = Math.random() * 1e9) {
    const r = new Random(seed | 0);
    const sigma = CHOKES[barrel].sigma;
    const up = Math.abs(dir.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(dir, up).normalize();
    const up2 = new THREE.Vector3().crossVectors(right, dir).normalize();
    const pos = new Float32Array(PELLETS * 3);
    const vel = new Float32Array(PELLETS * 3);
    const alive = new Uint8Array(PELLETS).fill(1);
    for (let i = 0; i < PELLETS; i++) {
      const ax = r.gauss() * sigma;
      const ay = r.gauss() * sigma;
      const v = MUZZLE_V * (0.97 + r.next() * 0.06);
      const dx = dir.x + right.x * ax + up2.x * ay;
      const dy = dir.y + right.y * ax + up2.y * ay;
      const dz = dir.z + right.z * ax + up2.z * ay;
      const l = Math.hypot(dx, dy, dz);
      pos[i * 3] = origin.x + dir.x * 0.8;
      pos[i * 3 + 1] = origin.y + dir.y * 0.8;
      pos[i * 3 + 2] = origin.z + dir.z * 0.8;
      vel[i * 3] = (dx / l) * v;
      vel[i * 3 + 1] = (dy / l) * v;
      vel[i * 3 + 2] = (dz / l) * v;
    }
    // trunks near the shot line block pellets
    const trunks = this.world.veg.treesNear(origin.x + dir.x * 40, origin.z + dir.z * 40, 50);
    this.shots.push({ pos, vel, alive, t: 0, local, origin: origin.clone(), dir: dir.clone(), hits: new Map(), done: new Set(), trunks });
  }

  updateShots(dt) {
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const birds = this.world.birds;
    const terrain = this.world.terrain;
    for (const s of this.shots) {
      s.t += dt;
      const steps = Math.ceil(dt / (1 / 120));
      const h = dt / steps;
      for (let st = 0; st < steps; st++) {
        for (let i = 0; i < PELLETS; i++) {
          if (!s.alive[i]) continue;
          const k = i * 3;
          let vx = s.vel[k], vy = s.vel[k + 1], vz = s.vel[k + 2];
          const sp = Math.hypot(vx, vy, vz);
          if (sp < 40) {
            s.alive[i] = 0;
            continue;
          }
          const f = 1 / (1 + DRAG * sp * h);
          vx *= f;
          vy = vy * f - 9.81 * h;
          vz *= f;
          s.vel[k] = vx;
          s.vel[k + 1] = vy;
          s.vel[k + 2] = vz;
          a.set(s.pos[k], s.pos[k + 1], s.pos[k + 2]);
          b.set(a.x + vx * h, a.y + vy * h, a.z + vz * h);
          // birds
          if (s.local) {
            const bird = birds.testSegment(a, b, s.done);
            if (bird) {
              s.alive[i] = 0;
              if (sp > MIN_LETHAL_V) {
                const n = (s.hits.get(bird.id) || 0) + 1;
                s.hits.set(bird.id, n);
                if (n >= bird.sp.toughness) {
                  s.done.add(bird.id);
                  this.reportHit(s, bird, n);
                }
              }
              continue;
            }
          }
          // trunks
          let blocked = false;
          for (const t of s.trunks) {
            const dx = b.x - t.x;
            const dz = b.z - t.z;
            if (dx * dx + dz * dz < t.r * t.r && b.y < t.y + t.crownY && b.y > t.y - 0.3) {
              blocked = true;
              break;
            }
          }
          if (blocked) {
            s.alive[i] = 0;
            continue;
          }
          // ground
          const gy = terrain.height(b.x, b.z);
          if (b.y < gy) {
            s.alive[i] = 0;
            if (i % 9 === 0 && b.distanceTo(s.origin) < 60) this.fx.dust(new THREE.Vector3(b.x, gy + 0.05, b.z), [0.6, 0.52, 0.4]);
            continue;
          }
          s.pos[k] = b.x;
          s.pos[k + 1] = b.y;
          s.pos[k + 2] = b.z;
        }
      }
    }
    // resolve partial hits once the shot has passed
    for (const s of this.shots) {
      if (s.t > 0.6 && !s.resolved) {
        s.resolved = true;
        if (s.local) {
          for (const [id, n] of s.hits) {
            if (s.done.has(id)) continue;
            const bird = birds.birds.get(id);
            if (bird) this.reportHit(s, bird, n);
          }
        }
      }
    }
    this.shots = this.shots.filter((s) => s.t < 0.7);
  }

  reportHit(s, bird, n) {
    const p = bird.renderPos || bird.pos;
    const dist = p.distanceTo(s.origin);
    const impulse = s.dir.clone().multiplyScalar(1.5 + n * 0.3);
    if (this.onBirdHits) this.onBirdHits(bird.id, n, impulse, dist);
  }

  reload() {
    if (this.reloading) return;
    if (this.loaded[0] && this.loaded[1]) return;
    if (this.reserve <= 0) return;
    this.reloading = { t: 0, ejected: false, inserted: 0, closed: false };
    audio.play('breakOpen', null, { gain: 0.8 });
  }

  update(dt, player, input) {
    const m = this.model;
    // aim-down-sights blend
    const wantAds = input.mouseDown(2) && !this.reloading && !player.binocs;
    player.ads = wantAds;
    this.ads += ((wantAds ? 1 : 0) - this.ads) * Math.min(1, dt * 11);

    // recoil spring
    this.recoilV += (-this.recoil * 180 - this.recoilV * 22) * dt;
    this.recoil += this.recoilV * dt;

    // weapon sway from look movement
    const dyaw = player.yaw - this.lastYaw;
    const dpitch = player.pitch - this.lastPitch;
    this.lastYaw = player.yaw;
    this.lastPitch = player.pitch;
    this.sway.x += (-dyaw * 2.2 - this.sway.x) * Math.min(1, dt * 8);
    this.sway.y += (-dpitch * 2.2 - this.sway.y) * Math.min(1, dt * 8);

    // reload sequence
    let open = 0;
    if (this.reloading) {
      const R = this.reloading;
      R.t += dt;
      open = Math.min(1, R.t / 0.25);
      if (R.t > 0.35 && !R.ejected) {
        R.ejected = true;
        for (let i = 0; i < 2; i++) {
          if (this.fired[i]) {
            const p = m.chambers[i].getWorldPosition(new THREE.Vector3());
            const back = new THREE.Vector3(0, 0, 1).applyQuaternion(this.camera.quaternion);
            const up = new THREE.Vector3(0, 1, 0);
            this.hulls.eject(p, back.multiplyScalar(2.5).add(up.multiplyScalar(2.2)).add(player.vel));
            this.fired[i] = false;
          }
        }
        audio.play('shellOut', null, { gain: 0.7 });
      }
      const need = [0, 1].filter((i) => !this.loaded[i]);
      if (R.t > 0.75 && R.inserted === 0 && need.length) {
        R.inserted = 1;
        this.loaded[need[0]] = true;
        this.reserve--;
        audio.play('shellIn', null, { gain: 0.8 });
      }
      if (R.t > 1.05 && R.inserted === 1 && need.length && this.reserve > 0) {
        R.inserted = 2;
        this.loaded[need[0]] = true;
        this.reserve--;
        audio.play('shellIn', null, { gain: 0.8 });
      }
      if (R.t > 1.35) {
        open = Math.max(0, 1 - (R.t - 1.35) / 0.15);
        if (!R.closed) {
          R.closed = true;
          audio.play('breakClose', null, { gain: 0.9 });
        }
      }
      if (R.t > 1.6) this.reloading = null;
    }
    m.hinge.rotation.x = -open * 0.55;
    for (let i = 0; i < 2; i++) m.chambers[i].visible = this.loaded[i] || this.fired[i];

    const sprinting = player.speed > 4.5;
    this.lower += ((this.reloading ? 1 : sprinting ? 0.7 : 0) - this.lower) * Math.min(1, dt * 7);

    // hip vs mounted positions (camera space)
    const hip = new THREE.Vector3(0.16, -0.17, -0.42);
    // mounted: looking along the rib, bead just under the target
    const mounted = new THREE.Vector3(0.0, -0.075, -0.45);
    const p = hip.lerp(mounted, this.ads);
    p.x += this.sway.x * 0.06 * (1 - this.ads * 0.7);
    p.y += this.sway.y * 0.06 * (1 - this.ads * 0.7) - this.lower * 0.12;
    const t = performance.now() / 1000;
    const breathe = (1 - this.ads * 0.6) * 0.003;
    p.y += Math.sin(t * 1.4) * breathe;
    p.z += this.recoil * 0.05;
    this.holder.position.copy(p);
    this.holder.rotation.set(
      this.recoil * 0.4 + this.lower * 0.5 + Math.sin(t * 1.1) * breathe + this.ads * 0.097,
      (1 - this.ads) * 0.06 + this.lower * 0.5,
      (1 - this.ads) * -0.05 + this.lower * 0.3
    );
    this.holder.visible = !player.binocs;

    // muzzle flash
    this.flashT -= dt;
    this.flash.intensity = this.flashT > 0 ? 40 : 0;
    this.flashSprite.visible = this.flashT > 0;
    if (this.flashT > 0) this.flashSprite.material.rotation = Math.random() * 6;

    this.updateShots(dt);
  }
}
