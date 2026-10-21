import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Random, clamp } from '../core/rng.js';
import { createBirdMesh, poseWings } from '../birds/birdModel.js';
import { audio } from '../audio/audio.js';
import { PLAY_RADIUS } from '../world/terrain.js';

// كلب الصيد: a white-and-liver pointer. It quarters the ground ahead of the
// hunter, scents hidden birds on the wind and freezes on point (the bell
// goes quiet), flushes when sent in, and brings back the birds you drop.

const POSES = ['run', 'point', 'sniff', 'sit', 'carry'];
const WHITE = '#efe9df';
const LIVER = '#5a3624';

function coatTexture(seed) {
  const W = 256;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const r = new Random(seed);
  g.fillStyle = WHITE;
  g.fillRect(0, 0, W, H);
  // big liver patches on the back and flanks
  g.fillStyle = LIVER;
  for (let i = 0; i < 5; i++) {
    g.beginPath();
    g.ellipse(r.float(20, W - 20), r.float(0, H * 0.55), r.float(14, 34), r.float(10, 22), r.float(0, 3), 0, Math.PI * 2);
    g.fill();
  }
  // ticking
  for (let i = 0; i < 420; i++) {
    g.globalAlpha = r.float(0.4, 0.9);
    g.fillRect(r.float(0, W), r.float(0, H), r.float(1, 2.5), r.float(1, 2.5));
  }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildDogModel(seed = 3) {
  const root = new THREE.Group();
  const coat = new THREE.MeshStandardMaterial({ map: coatTexture(seed), roughness: 0.85 });
  const liver = new THREE.MeshStandardMaterial({ color: LIVER, roughness: 0.8 });
  const white = new THREE.MeshStandardMaterial({ color: WHITE, roughness: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 0.5 });
  const collar = new THREE.MeshStandardMaterial({ color: 0xd2531c, roughness: 0.6 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xc9a040, metalness: 0.9, roughness: 0.3 });

  const body = new THREE.Group();
  body.position.y = 0.56;
  root.add(body);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.135, 0.5, 6, 12), coat);
  torso.rotation.x = Math.PI / 2;
  torso.scale.set(1, 1, 1.12);
  body.add(torso);
  const chest = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), coat);
  chest.position.set(0, -0.03, 0.22);
  chest.scale.set(0.95, 1.15, 1);
  body.add(chest);

  // neck + head
  const neck = new THREE.Group();
  neck.position.set(0, 0.06, 0.3);
  body.add(neck);
  const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 0.24, 10), coat);
  neckMesh.position.set(0, 0.1, 0.05);
  neckMesh.rotation.x = 0.7;
  neck.add(neckMesh);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.014, 6, 16), collar);
  ring.position.set(0, 0.08, 0.04);
  ring.rotation.x = Math.PI / 2 + 0.7;
  neck.add(ring);
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), brass);
  bell.position.set(0, 0.0, 0.1);
  neck.add(bell);
  const head = new THREE.Group();
  head.position.set(0, 0.2, 0.13);
  neck.add(head);
  const skull = new THREE.Mesh(new RoundedBoxGeometry(0.115, 0.11, 0.15, 3, 0.04), liver);
  skull.position.set(0, 0.02, 0.0);
  head.add(skull);
  const blaze = new THREE.Mesh(new RoundedBoxGeometry(0.028, 0.112, 0.153, 2, 0.012), white);
  blaze.position.set(0, 0.022, 0.0);
  head.add(blaze);
  const muzzle = new THREE.Mesh(new RoundedBoxGeometry(0.075, 0.07, 0.15, 3, 0.025), liver);
  muzzle.position.set(0, -0.01, 0.13);
  head.add(muzzle);
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), dark);
  nose.position.set(0, 0.012, 0.2);
  head.add(nose);
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(new RoundedBoxGeometry(0.018, 0.14, 0.075, 2, 0.008), liver);
    ear.position.set(sx * 0.066, -0.035, -0.02);
    ear.rotation.set(0.15, 0, sx * 0.1);
    head.add(ear);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 5), dark);
    eye.position.set(sx * 0.045, 0.045, 0.07);
    head.add(eye);
  }
  const mouthPoint = new THREE.Object3D();
  mouthPoint.position.set(0, -0.05, 0.16);
  head.add(mouthPoint);

  // legs: hip/shoulder -> upper -> knee -> lower -> paw
  const legs = [];
  for (const [x, z, front] of [[-0.09, 0.24, 1], [0.09, 0.24, 1], [-0.09, -0.25, 0], [0.09, -0.25, 0]]) {
    const hip = new THREE.Group();
    hip.position.set(x, -0.02, z);
    body.add(hip);
    const upper = new THREE.Mesh(new THREE.CapsuleGeometry(front ? 0.04 : 0.05, 0.2, 4, 8), coat);
    upper.position.y = -0.13;
    hip.add(upper);
    const knee = new THREE.Group();
    knee.position.y = -0.25;
    hip.add(knee);
    const lower = new THREE.Mesh(new THREE.CapsuleGeometry(0.028, 0.2, 4, 8), white);
    lower.position.y = -0.12;
    knee.add(lower);
    const paw = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6), white);
    paw.position.set(0, -0.25, 0.02);
    paw.scale.set(1, 0.6, 1.3);
    knee.add(paw);
    legs.push({ hip, knee, front });
  }

  const tail = new THREE.Group();
  tail.position.set(0, 0.05, -0.38);
  body.add(tail);
  const tailMesh = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.32, 8), coat);
  tailMesh.position.y = 0.15;
  tail.add(tailMesh);
  tail.rotation.x = -2.1;

  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = false;
    }
  });
  return { root, body, neck, head, legs, tail, mouthPoint };
}

export class Dog {
  // world: { terrain, veg, birds }, opts: { remote, onFlush(bird, pos), onDeliver(birdId), onPoint(bird), myId }
  constructor(scene, world, opts = {}) {
    this.scene = scene;
    this.world = world;
    this.opts = opts;
    this.remote = !!opts.remote;
    this.m = buildDogModel(opts.seed || 3);
    scene.add(this.m.root);
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.speed = 0;
    this.phase = 0;
    this.pose = 'run';
    this.mode = 'hunt'; // or 'heel'
    this.state = 'quarter';
    this.side = 1;
    this.target = new THREE.Vector3();
    this.retarget = 0;
    this.scentBird = null;
    this.fetchBird = null;
    this.carryMesh = null;
    this.pointT = 0;
    this.lostT = 0;
    this.rnd = new Random(77);
    this.bell = null;
    this.pant = null;
    this.samples = [];
  }

  dispose() {
    this.scene.remove(this.m.root);
    if (this.bell) this.bell.stop();
    if (this.pant) this.pant.stop();
    this.dropCarry();
  }

  place(x, z) {
    this.pos.set(x, this.world.terrain.height(x, z), z);
  }

  // F: send the dog in when it's on point, otherwise heel / hunt on.
  command() {
    audio.play('dogWhistle', null, { gain: 0.5 });
    if (this.state === 'point' && this.scentBird) {
      this.state = 'flush';
      return 'flush';
    }
    this.mode = this.mode === 'hunt' ? 'heel' : 'hunt';
    if (this.state !== 'fetch' && this.state !== 'carry') this.state = this.mode === 'heel' ? 'heel' : 'quarter';
    return this.mode;
  }

  // ------------------------------------------------ simulation (owner)

  update(dt, hunter, wind) {
    if (this.remote) return this.updateRemote(dt);
    const H = hunter.pos;
    const fwd = new THREE.Vector3(-Math.sin(hunter.yaw), 0, -Math.cos(hunter.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const toHunter = Math.hypot(H.x - this.pos.x, H.z - this.pos.z);
    let goal = null;
    let want = 0;

    // a dead bird of ours lying out there: go and get it
    if (this.state !== 'fetch' && this.state !== 'carry' && this.state !== 'point' && this.state !== 'flush') {
      const b = this.findFetch(H);
      if (b) {
        this.fetchBird = b;
        this.state = 'fetch';
      }
    }

    switch (this.state) {
      case 'quarter': {
        // zig-zag across the hunter's front, 15-30 m out
        this.retarget -= dt;
        const far = Math.hypot(this.target.x - H.x, this.target.z - H.z) > 55;
        if (this.retarget <= 0 || this.reached(this.target, 3) || far) {
          this.side = -this.side;
          this.retarget = 7;
          const ahead = this.rnd.float(14, 30);
          const lat = this.rnd.float(14, 28) * this.side;
          this.target.set(H.x + fwd.x * ahead + right.x * lat, 0, H.z + fwd.z * ahead + right.z * lat);
          const r = Math.hypot(this.target.x, this.target.z);
          if (r > PLAY_RADIUS - 10) this.target.multiplyScalar((PLAY_RADIUS - 10) / r);
        }
        goal = this.target;
        want = toHunter > 45 ? 8 : 6.5;
        this.pose = 'run';
        const b = this.sniff(wind);
        if (b) {
          this.scentBird = b;
          this.state = 'scent';
        }
        break;
      }
      case 'scent': {
        // creep in on the scent until it's strong, then lock up
        const b = this.scentBird;
        if (!this.birdStillThere(b)) {
          this.state = 'quarter';
          break;
        }
        const d = this.dist(b.pos);
        goal = b.pos;
        want = 2.2;
        this.pose = 'sniff';
        if (d < (b.spId === 'woodcock' ? 5 : 6.5)) {
          this.state = 'point';
          this.pointT = 0;
          if (this.opts.onPoint) this.opts.onPoint(b);
        }
        break;
      }
      case 'point': {
        const b = this.scentBird;
        this.pose = 'point';
        this.pointT += dt;
        this.faceTowards(b ? b.pos : this.target, dt, 6);
        if (!this.birdStillThere(b)) {
          // it got up (or ran): stay staunch a moment, then hunt on
          this.lostT += dt;
          if (this.lostT > 1.2) {
            this.lostT = 0;
            this.state = this.mode === 'heel' ? 'heel' : 'quarter';
            this.scentBird = null;
          }
          break;
        }
        // a running quail drags the point along ("roading")
        if (this.dist(b.pos) > 8) this.state = 'scent';
        break;
      }
      case 'flush': {
        const b = this.scentBird;
        if (!this.birdStillThere(b)) {
          this.state = this.mode === 'heel' ? 'heel' : 'quarter';
          this.scentBird = null;
          break;
        }
        goal = b.pos;
        want = 7;
        this.pose = 'run';
        if (this.dist(b.pos) < 1.6) {
          if (this.opts.onFlush) this.opts.onFlush(b, this.pos.clone());
          this.scentBird = null;
          this.state = 'quarter';
          this.retarget = 2;
        }
        break;
      }
      case 'fetch': {
        const b = this.fetchBird;
        if (!b || !this.world.birds.birds.has(b.id) || b.state !== 'dead') {
          this.fetchBird = null;
          this.state = this.mode === 'heel' ? 'heel' : 'quarter';
          break;
        }
        const p = b.renderPos || b.pos;
        goal = p;
        want = this.dist(p) > 6 ? 8 : 3;
        this.pose = 'run';
        if (this.dist(p) < 0.9) {
          this.pickUp(b);
          this.state = 'carry';
        }
        break;
      }
      case 'carry': {
        const b = this.fetchBird;
        goal = H;
        want = toHunter > 6 ? 7 : 2.5;
        this.pose = 'carry';
        if (!b || !this.world.birds.birds.has(b.id)) {
          this.dropCarry();
          this.state = this.mode === 'heel' ? 'heel' : 'quarter';
          break;
        }
        if (toHunter < 1.8) {
          this.dropCarry();
          if (this.opts.onDeliver) this.opts.onDeliver(b.id);
          audio.play('dogShake', this.pos, { gain: 0.5, ref: 3 });
          this.fetchBird = null;
          this.state = this.mode === 'heel' ? 'heel' : 'quarter';
          this.retarget = 0;
        }
        break;
      }
      default: {
        // heel: a couple of metres behind the hunter's left boot
        const spot = new THREE.Vector3(H.x - fwd.x * 1.6 - right.x * 0.8, 0, H.z - fwd.z * 1.6 - right.z * 0.8);
        goal = spot;
        const d = this.dist(spot);
        want = d > 6 ? 6 : d > 1 ? Math.max(1.2, hunter.speed) : 0;
        this.pose = want > 0 ? 'run' : 'sit';
        if (want === 0) this.faceTowards(H.clone().addScaledVector(fwd, 10), dt, 3);
        // even at heel a good dog will point a bird right under its nose
        const b = this.sniff(wind, 0.35);
        if (b) {
          this.scentBird = b;
          this.state = 'scent';
        }
      }
    }

    // move
    if (goal) {
      const dx = goal.x - this.pos.x;
      const dz = goal.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.25) want = 0;
      if (want > 0) this.faceTowards(goal, dt, want > 4 ? 4.5 : 6);
    }
    this.speed += (want - this.speed) * Math.min(1, dt * 4);
    this.pos.x += Math.sin(this.yaw) * this.speed * dt;
    this.pos.z += Math.cos(this.yaw) * this.speed * dt;
    this.world.veg.collide(this.pos, 0.3);
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > PLAY_RADIUS) this.pos.multiplyScalar(PLAY_RADIUS / r);
    this.pos.y = this.world.terrain.height(this.pos.x, this.pos.z);
    this.animate(dt);
    this.sounds(hunter);
  }

  reached(p, r) {
    return Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < r;
  }

  dist(p) {
    return Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
  }

  faceTowards(p, dt, rate) {
    const tgt = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
    let d = tgt - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw += clamp(d, -rate * dt, rate * dt);
  }

  birdStillThere(b) {
    return b && this.world.birds.birds.has(b.id) && (b.state === 'hidden' || b.state === 'running');
  }

  // A hidden bird's scent drifts downwind: the dog winds it from much
  // further when the breeze carries the scent to it.
  sniff(wind, k = 1) {
    const ws = Math.hypot(wind.x, wind.z);
    const wx = ws > 0.1 ? wind.x / ws : 0;
    const wz = ws > 0.1 ? wind.z / ws : 0;
    let best = null;
    let bestScore = 0;
    for (const b of this.world.birds.birds.values()) {
      if ((b.state !== 'hidden' && b.state !== 'running') || b.sp.behaviour !== 'ground') continue;
      const dx = this.pos.x - b.pos.x;
      const dz = this.pos.z - b.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 40) continue;
      const downwind = d > 0.01 ? (dx * wx + dz * wz) / d : 0; // 1 = straight downwind of the bird
      const range = (4 + Math.max(0, downwind) * (10 + ws * 2.2)) * k;
      if (d < range) {
        const score = range - d;
        if (score > bestScore) {
          bestScore = score;
          best = b;
        }
      }
    }
    return best;
  }

  findFetch(H) {
    let best = null;
    let bd = 140;
    for (const b of this.world.birds.birds.values()) {
      if (b.state !== 'dead' || b.owner !== this.opts.myId || b.carried) continue;
      const p = b.renderPos || b.pos;
      const d = Math.hypot(p.x - H.x, p.z - H.z);
      // the hunter is right by it: let him pick it up himself
      if (d < 4) continue;
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  pickUp(b) {
    b.carried = true;
    this.carryMesh = createBirdMesh(b.spId, { scale: b.size || 1 });
    poseWings(this.carryMesh, 'limp', 0, 0.3, 0);
    this.carryMesh.root.rotation.set(0, Math.PI / 2, Math.PI / 2);
    this.m.mouthPoint.add(this.carryMesh.root);
  }

  dropCarry() {
    if (this.fetchBird) this.fetchBird.carried = false;
    if (this.carryMesh) {
      this.carryMesh.root.removeFromParent();
      this.carryMesh = null;
    }
  }

  // ------------------------------------------------ looks & sound

  animate(dt) {
    const m = this.m;
    m.root.position.copy(this.pos);
    m.root.rotation.y = this.yaw;
    const sp = this.speed;
    const gallop = sp > 4.5;
    this.phase += dt * (gallop ? 2.6 + sp * 0.5 : 1.2 + sp * 1.4) * Math.PI;
    const ph = this.phase;
    const amp = Math.min(1, sp / 3) * (gallop ? 0.9 : 0.55);
    const offs = gallop ? [0, 0.35, Math.PI, Math.PI + 0.35] : [0, Math.PI, Math.PI, 0];
    m.legs.forEach((L, i) => {
      const a = Math.sin(ph + offs[i]);
      L.hip.rotation.x = a * amp;
      L.knee.rotation.x = (L.front ? -1 : 1) * Math.max(0, Math.sin(ph + offs[i] + 0.8)) * amp * 1.2;
    });
    m.body.position.y = 0.56 + (sp > 0.3 ? Math.abs(Math.sin(ph)) * 0.03 * Math.min(1, sp / 3) : 0);
    m.body.rotation.x = gallop ? Math.sin(ph) * 0.06 : 0;
    let headPitch = 0;
    let tail = -2.1 + Math.sin(this.phase * 2) * 0.15;
    let tailWag = Math.sin(performance.now() / 90) * 0.5 * (sp > 0.2 ? 1 : 0.4);
    if (this.pose === 'sniff') {
      headPitch = 0.55; // nose down working the scent
      tailWag *= 1.6;
    } else if (this.pose === 'point') {
      // rigid: head up and forward, tail straight out, one forefoot lifted
      headPitch = -0.15;
      tail = -1.75;
      tailWag = 0;
      m.legs.forEach((L, i) => {
        L.hip.rotation.x = 0;
        L.knee.rotation.x = 0;
        if (i === 0) {
          L.hip.rotation.x = -0.7;
          L.knee.rotation.x = 1.5;
        }
      });
      m.body.position.y = 0.53;
    } else if (this.pose === 'sit') {
      m.legs.forEach((L) => {
        L.hip.rotation.x = L.front ? 0 : -1.2;
        L.knee.rotation.x = L.front ? 0 : 1.6;
      });
      m.body.rotation.x = -0.4;
      m.body.position.y = 0.42;
      headPitch = -0.2;
    } else if (this.pose === 'carry') {
      headPitch = -0.2;
    }
    m.neck.rotation.x = headPitch;
    m.tail.rotation.set(tail, tailWag * 0.3, tailWag);
  }

  sounds(hunter) {
    // the bell rings while the dog moves and goes quiet on point: hunters
    // listen for the silence
    if (!this.bell) this.bell = audio.startLoop('dogBell', { ref: 6 });
    if (!this.pant) this.pant = audio.startLoop('dogPant', { ref: 2 });
    const moving = Math.min(1, this.speed / 3);
    if (this.bell) this.bell.set(this.pos, this.pose === 'point' ? 0 : 0.35 + 0.5 * moving);
    const near = Math.hypot(hunter.pos.x - this.pos.x, hunter.pos.z - this.pos.z) < 8;
    if (this.pant) this.pant.set(this.pos, near && this.pose !== 'point' ? 0.35 : 0);
  }

  // ------------------------------------------------ network

  netState() {
    return [+this.pos.x.toFixed(2), +this.pos.z.toFixed(2), +this.yaw.toFixed(2), POSES.indexOf(this.pose), +this.speed.toFixed(1)];
  }

  applyRemote(s) {
    const now = performance.now() / 1000;
    this.samples.push({ t: now, x: s[0], z: s[1], yaw: s[2], pose: POSES[s[3]] || 'run', speed: s[4] });
    if (this.samples.length > 6) this.samples.shift();
  }

  updateRemote(dt) {
    const s = this.samples;
    if (!s.length) return;
    const rt = performance.now() / 1000 - 0.12;
    let i = s.length - 1;
    while (i > 0 && s[i - 1].t > rt) i--;
    const a = s[Math.max(0, i - 1)];
    const c = s[i];
    const k = c.t > a.t ? clamp((rt - a.t) / (c.t - a.t), 0, 1) : 1;
    this.pos.set(a.x + (c.x - a.x) * k, 0, a.z + (c.z - a.z) * k);
    this.pos.y = this.world.terrain.height(this.pos.x, this.pos.z);
    let d = c.yaw - a.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.yaw = a.yaw + d * k;
    this.pose = c.pose;
    this.speed = c.speed;
    this.animate(dt);
    if (!this.bell) this.bell = audio.startLoop('dogBell', { ref: 6 });
    if (this.bell) this.bell.set(this.pos, this.pose === 'point' ? 0 : 0.3 + 0.4 * Math.min(1, this.speed / 3));
  }
}
