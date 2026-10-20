import * as THREE from 'three';
import { SPECIES, SPECIES_LIST } from '../config/species.js';
import { createBirdMesh, poseWings, featherColor } from './birdModel.js';
import { Random, clamp } from '../core/rng.js';
import { PLAY_RADIUS } from '../world/terrain.js';
import { audio } from '../audio/audio.js';

// Bird behaviour.
//
// Ground birds (quail, woodcock) sit hidden in cover and flush when a hunter
// walks close, fly a short way and drop back in. Passage birds (thrush,
// fieldfare, chaffinch) come through in flocks along a flight line, and some
// flocks drop into trees to feed. Storks soar high overhead.
//
// The authority (solo game or multiplayer host) simulates; other players get
// snapshots and interpolate.

const STATES = ['hidden', 'flying', 'perched', 'falling', 'dead'];
const WING = ['flap', 'glide', 'fold', 'limp', 'perch'];
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

class Bird {
  constructor(id, spId, scene) {
    this.id = id;
    this.spId = spId;
    this.sp = SPECIES[spId];
    this.model = createBirdMesh(spId);
    scene.add(this.model.root);
    this.scene = scene;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = new THREE.Vector2(1, 0);
    this.state = 'hidden';
    this.t = 0;
    this.phase = Math.random() * 6;
    this.wing = 'flap';
    this.yaw = 0;
    this.pitch = 0;
    this.roll = 0;
    this.spin = new THREE.Vector3();
    this.speedMul = 0.92 + Math.random() * 0.16;
    this.waypoints = [];
    this.alt = 10;
    this.mode = 'cruise';
    this.owner = null;
    this.wounded = 0;
    this.flare = 0;
    this.samples = [];
    this.lastCall = Math.random() * 4;
  }

  dispose() {
    this.scene.remove(this.model.root);
  }

  get radius() {
    return this.sp.length * 0.24;
  }
}

export class BirdManager {
  constructor(scene, terrain, veg, hunt, authority) {
    this.scene = scene;
    this.terrain = terrain;
    this.veg = veg;
    this.hunt = hunt;
    this.authority = authority;
    this.birds = new Map();
    this.nextId = 1;
    this.rnd = new Random(hunt.seed + 1234);
    this.events = [];
    this.flyoverTimer = 4;
    this.groundTimer = 0;
    this.storkTimer = 60 + Math.random() * 120;
    this.groups = [];
    this.feathers = new Feathers(scene);
    this.time = 0;
    this.weights = hunt.species;
  }

  emit(type, data) {
    this.events.push({ type, ...data });
  }

  create(spId, id = null) {
    const b = new Bird(id ?? this.nextId++, spId, this.scene);
    this.birds.set(b.id, b);
    return b;
  }

  remove(b) {
    b.dispose();
    this.birds.delete(b.id);
  }

  ground(x, z) {
    return this.terrain.height(x, z);
  }

  // ---------------- spawning (authority) ----------------

  // Ground birds are kept around the hunters (a "beat" of ~250 m), so walking
  // up quail or woodcock gives a flush every minute or two, like a good day.
  groundTarget(spId) {
    const w = this.weights[spId] || 0;
    return Math.round(w * (spId === 'quail' ? 40 : 22));
  }

  initialPopulation(players) {
    for (const spId of ['quail', 'woodcock']) {
      const n = this.groundTarget(spId);
      for (let i = 0; i < n; i++) this.spawnGround(spId, players, 20);
    }
  }

  groundSpot(spId, players, minDist) {
    for (let tries = 0; tries < 60; tries++) {
      const center = this.rnd.pick(players).pos;
      const a = this.rnd.float(0, Math.PI * 2);
      const r = minDist + Math.sqrt(this.rnd.next()) * (140 - minDist);
      const x = center.x + Math.cos(a) * r;
      const z = center.z + Math.sin(a) * r;
      if (Math.hypot(x, z) > PLAY_RADIUS - 15) continue;
      if (players.some((p) => Math.hypot(p.pos.x - x, p.pos.z - z) < minDist)) continue;
      const m = this.terrain.maskAt(x, z);
      const n = this.terrain.normal(x, z);
      if (n.y < 0.8) continue;
      if (spId === 'quail') {
        if (m.forest > 0.35 || m.snow > 0.4) continue;
      } else {
        if (m.forest < 0.4 && this.veg.treesNear(x, z, 7).length === 0) continue;
      }
      return { x, z };
    }
    return null;
  }

  spawnGround(spId, players, minDist = 40) {
    const spot = this.groundSpot(spId, players, minDist);
    if (!spot) return null;
    // quail often sit in loose little groups after a night of migration
    const n = spId === 'quail' && this.rnd.chance(0.35) ? this.rnd.int(2, 3) : 1;
    let first = null;
    for (let i = 0; i < n; i++) {
      const b = this.create(spId);
      const x = spot.x + (i ? this.rnd.float(-6, 6) : 0);
      const z = spot.z + (i ? this.rnd.float(-6, 6) : 0);
      b.state = 'hidden';
      b.pos.set(x, this.ground(x, z) + 0.08, z);
      b.flushDist = this.rnd.float(...b.sp.flushDist);
      b.model.root.visible = false;
      first = first || b;
    }
    return first;
  }

  spawnFlock(spId, players, opts = {}) {
    if (!players.length) return;
    const sp = SPECIES[spId];
    const p = this.rnd.pick(players).pos;
    const a = this.rnd.float(0, Math.PI * 2);
    const dir = new THREE.Vector2(Math.cos(a), Math.sin(a));
    const side = new THREE.Vector2(-dir.y, dir.x);
    const lateral = sp.behaviour === 'soar' ? this.rnd.float(-150, 150) : this.rnd.gauss() * 45;
    const startD = sp.behaviour === 'soar' ? 900 : 380;
    const start = new THREE.Vector2(p.x, p.z).addScaledVector(dir, startD).addScaledVector(side, lateral + this.rnd.float(-30, 30));
    const pass = new THREE.Vector2(p.x, p.z).addScaledVector(side, lateral);
    const end = new THREE.Vector2(p.x, p.z).addScaledVector(dir, -startD - 100).addScaledVector(side, lateral + this.rnd.float(-60, 60));
    const count = this.rnd.int(...(sp.flock || [1, 1]));
    const alt = this.rnd.float(...sp.flight.alt);
    const group = { id: this.rnd.next(), spId, members: [], alt, perch: null, called: 0 };
    // some flocks will drop into trees along the line
    if (sp.behaviour === 'flyover' && this.rnd.chance(opts.perchChance ?? 0.38)) {
      group.perch = this.pickPerchTrees(sp, pass.x, pass.y, 110, Math.ceil(count / 3));
    }
    const spread = 2 + count * 0.9;
    for (let i = 0; i < count; i++) {
      const b = this.create(spId);
      b.state = 'flying';
      b.group = group;
      b.model.root.visible = true;
      const off = new THREE.Vector3(this.rnd.gauss() * spread, this.rnd.gauss() * spread * 0.35, this.rnd.gauss() * spread);
      b.offset = off;
      const sx = start.x + off.x;
      const sz = start.y + off.z;
      b.pos.set(sx, this.ground(sx, sz) + alt + off.y, sz);
      b.alt = alt + off.y;
      b.heading.set(-dir.x, -dir.y);
      b.vel.set(-dir.x * sp.flight.speed, 0, -dir.y * sp.flight.speed);
      b.waypoints = [new THREE.Vector3(pass.x + off.x, 0, pass.y + off.z), new THREE.Vector3(end.x + off.x, 0, end.y + off.z)];
      if (group.perch && group.perch.length) {
        const tr = group.perch[i % group.perch.length];
        b.perchTree = tr;
        b.mode = 'toPerch';
        b.waypoints = [this.perchPoint(tr)];
      }
      if (sp.behaviour === 'soar') {
        b.mode = 'soar';
        b.circleC = new THREE.Vector2(pass.x, pass.y);
        b.circleR = this.rnd.float(50, 90);
        b.circleA = this.rnd.float(0, Math.PI * 2) + i * 0.4;
        b.drift = dir.clone().multiplyScalar(-2.2);
        b.circleC.copy(start);
      }
      group.members.push(b);
    }
    this.groups.push(group);
  }

  pickPerchTrees(sp, x, z, radius, n) {
    const near = this.veg.treesNear(x, z, radius).filter((t) => (sp.perchPrefer || []).includes(t.type));
    if (!near.length) return null;
    const out = [];
    for (let i = 0; i < n; i++) out.push(this.rnd.pick(near));
    return out;
  }

  perchPoint(tr) {
    const a = this.rnd.float(0, Math.PI * 2);
    const r = this.rnd.float(0, tr.crownR * 0.5);
    return new THREE.Vector3(tr.x + Math.cos(a) * r, tr.y + tr.h * this.rnd.float(0.82, 0.97), tr.z + Math.sin(a) * r);
  }

  flyoverRate(spId, hour) {
    // flocks per minute; thrush & finch passage peaks in the first hours after dawn
    const w = this.weights[spId] || 0;
    if (!w) return 0;
    const dawn = Math.exp(-(((hour - 7.2) / 1.6) ** 2));
    const dusk = Math.exp(-(((hour - 16.3) / 0.9) ** 2)) * 0.6;
    const base = spId === 'fieldfare' ? 2.2 : spId === 'chaffinch' ? 2.0 : 3.0;
    return base * w * (0.35 + dawn + dusk);
  }

  // ---------------- per-frame ----------------

  update(dt, players, hour) {
    this.time += dt;
    if (this.authority) this.simulate(dt, players, hour);
    else this.interpolate();
    for (const b of this.birds.values()) this.animate(b, dt);
    this.feathers.update(dt);
  }

  simulate(dt, players, hour) {
    // spawning
    this.flyoverTimer -= dt;
    if (this.flyoverTimer <= 0) {
      this.flyoverTimer = 1;
      let flyCount = 0;
      for (const b of this.birds.values()) if (b.state === 'flying' && b.sp.behaviour !== 'ground') flyCount++;
      for (const spId of ['songThrush', 'fieldfare', 'chaffinch']) {
        const perSec = this.flyoverRate(spId, hour) / 60;
        if (flyCount < 70 && this.rnd.chance(perSec)) this.spawnFlock(spId, players);
      }
    }
    this.groundTimer -= dt;
    if (this.groundTimer <= 0) {
      this.groundTimer = 6;
      for (const spId of ['quail', 'woodcock']) {
        const target = this.groundTarget(spId) * Math.max(1, players.length * 0.7);
        if (!target) continue;
        let n = 0;
        for (const b of [...this.birds.values()]) {
          if (b.spId !== spId || b.state !== 'hidden') continue;
          const far = players.every((p) => Math.hypot(p.pos.x - b.pos.x, p.pos.z - b.pos.z) > 220);
          if (far) this.remove(b); // the hunters have moved on
          else n++;
        }
        if (n < target) this.spawnGround(spId, players, 60);
      }
    }
    if (this.weights.stork) {
      this.storkTimer -= dt;
      if (this.storkTimer <= 0) {
        this.storkTimer = 200 + this.rnd.float(0, 200);
        this.spawnFlock('stork', players);
      }
    }

    for (const b of [...this.birds.values()]) {
      b.t += dt;
      switch (b.state) {
        case 'hidden':
          this.updateHidden(b, players);
          break;
        case 'flying':
          this.updateFlying(b, dt, players);
          break;
        case 'perched':
          this.updatePerched(b, dt, players);
          break;
        case 'falling':
          this.updateFalling(b, dt);
          break;
        case 'dead':
          if (b.t > 900) this.remove(b);
          break;
      }
    }
    this.groups = this.groups.filter((g) => g.members.some((m) => this.birds.has(m.id)));
  }

  updateHidden(b, players) {
    for (const p of players) {
      const d = Math.hypot(p.pos.x - b.pos.x, p.pos.z - b.pos.z);
      const k = p.crouch ? 0.75 : 1;
      if (d < b.flushDist * k) {
        this.flush(b, p.pos);
        return;
      }
    }
  }

  flush(b, from) {
    const sp = b.sp;
    b.state = 'flying';
    b.t = 0;
    b.mode = 'flush';
    b.model.root.visible = true;
    // away from the hunter, with a random slant
    const away = new THREE.Vector2(b.pos.x - from.x, b.pos.z - from.z).normalize();
    away.rotateAround(new THREE.Vector2(), this.rnd.float(-1.1, 1.1));
    b.heading.copy(away);
    b.alt = this.rnd.float(...sp.flight.alt);
    b.range = this.rnd.float(...sp.flight.range);
    b.traveled = 0;
    b.vel.set(away.x * 3, sp.flight.style === 'zigzag' ? 5 : 4.5, away.y * 3);
    b.zig = this.rnd.float(0, 6);
    audio.play(sp.flight.style === 'zigzag' ? 'clatter' : 'whirr', b.pos, { gain: 1.3, ref: 6 });
    if (sp.call === 'quail' && this.rnd.chance(0.3)) audio.play('quail', b.pos, { gain: 0.5, ref: 6, delay: 0.4 });
    this.emit('flush', { id: b.id, spId: b.spId });
  }

  updateFlying(b, dt, players) {
    const sp = b.sp;
    const f = sp.flight;
    let speed = f.speed * b.speedMul * (b.flare > 0 ? 1.35 : 1) * (b.wounded ? 0.75 : 1);
    b.flare = Math.max(0, b.flare - dt);
    let targetAlt = b.alt + (b.flare > 0 ? 8 : 0);
    let turnRate = f.style === 'zigzag' ? 3 : f.style === 'soar' ? 0.6 : 1.4;
    let desired = null;

    if (b.mode === 'soar') {
      b.circleC.addScaledVector(b.drift, dt);
      b.circleA += (dt * f.speed) / b.circleR;
      const tx = b.circleC.x + Math.cos(b.circleA) * b.circleR;
      const tz = b.circleC.y + Math.sin(b.circleA) * b.circleR;
      desired = new THREE.Vector2(tx - b.pos.x, tz - b.pos.z);
      targetAlt = b.alt + Math.sin(b.circleA * 0.5) * 8;
      if (b.circleC.length() > 2500) return this.remove(b);
    } else if (b.mode === 'flush' || b.mode === 'landing') {
      b.traveled += speed * dt;
      desired = b.heading.clone();
      if (b.mode === 'flush' && b.traveled > b.range) b.mode = 'landing';
      if (b.mode === 'landing') {
        targetAlt = -1;
        speed *= 0.8;
      } else if (b.t < 1.0) {
        targetAlt = b.alt;
      }
    } else {
      const wp = b.waypoints[0];
      if (!wp) {
        desired = b.heading.clone();
        if (Math.hypot(b.pos.x, b.pos.z) > PLAY_RADIUS + 320) return this.remove(b);
      } else {
        desired = new THREE.Vector2(wp.x - b.pos.x, wp.z - b.pos.z);
        const d = desired.length();
        if (b.mode === 'toPerch') {
          const gy = wp.y;
          targetAlt = null;
          const ty = d > 40 ? Math.max(gy + 6, this.ground(b.pos.x, b.pos.z) + b.alt * 0.6) : gy + Math.min(6, d * 0.15);
          b.vel.y += clamp((ty - b.pos.y) * 1.5 - b.vel.y, -6, 6) * dt * 2;
          if (d < 18) speed *= Math.max(0.3, d / 18);
          if (d < 1.2 && Math.abs(b.pos.y - gy) < 1.5) {
            this.perch(b, wp);
            return;
          }
        } else if (d < 10) {
          b.waypoints.shift();
        }
      }
    }

    // steering in the horizontal plane
    if (desired && desired.lengthSq() > 1e-6) {
      desired.normalize();
      const cur = Math.atan2(b.heading.y, b.heading.x);
      let tgt = Math.atan2(desired.y, desired.x);
      let diff = tgt - cur;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const turn = clamp(diff, -turnRate * dt, turnRate * dt);
      b.turn = turn / dt;
      b.heading.set(Math.cos(cur + turn), Math.sin(cur + turn));
    }
    let hx = b.heading.x * speed;
    let hz = b.heading.y * speed;
    if (f.style === 'zigzag' && b.mode !== 'landing') {
      const z = Math.sin(b.t * 5.5 + b.zig) * 4.5;
      hx += -b.heading.y * z;
      hz += b.heading.x * z;
    }
    const gnd = this.ground(b.pos.x + hx * 0.5, b.pos.z + hz * 0.5);
    if (targetAlt !== null) {
      const ty = gnd + targetAlt;
      let vy = clamp((ty - b.pos.y) * 1.2, -5, f.style === 'whirr' && b.t < 1 ? 6 : 4);
      if (f.style === 'bounding') vy += Math.cos(b.t * Math.PI * 2 * 1.3) * 1.4;
      if (f.style === 'direct') vy += Math.sin(b.t * 2.1) * 0.4;
      b.vel.y += (vy - b.vel.y) * Math.min(1, dt * 3);
    }
    b.vel.x = hx;
    b.vel.z = hz;
    b.pos.addScaledVector(b.vel, dt);
    const minY = this.ground(b.pos.x, b.pos.z) + 0.4;
    if (b.pos.y < minY) {
      if (b.mode === 'landing') {
        // drop back into cover
        if (Math.hypot(b.pos.x, b.pos.z) > PLAY_RADIUS - 10) return this.remove(b);
        b.state = 'hidden';
        b.pos.y = minY - 0.3;
        b.flushDist = this.rnd.float(...b.sp.flushDist) * 1.15; // a little warier now
        b.model.root.visible = false;
        b.t = 0;
        return;
      }
      b.pos.y = minY;
      b.vel.y = Math.max(0, b.vel.y);
    }

    if (b.wounded) {
      b.wounded -= dt;
      if (b.wounded <= 0) {
        b.wounded = 0;
        if (b.woundFatal) this.kill(b, b.owner, new THREE.Vector3());
      }
    }

    // calls
    b.lastCall -= dt;
    if (b.lastCall <= 0) {
      b.lastCall = this.callInterval(b);
      const c = b.sp.call;
      if (c !== 'none' && c !== 'quail' && c !== 'woodcock') audio.play(c, b.pos, { gain: 0.55, ref: 8, rate: 0.95 + Math.random() * 0.1 });
    }
  }

  callInterval(b) {
    switch (b.sp.call) {
      case 'chack':
        return 1.2 + Math.random() * 2.5;
      case 'tsip':
        return 2 + Math.random() * 5;
      case 'pink':
        return 1.5 + Math.random() * 3;
      default:
        return 99;
    }
  }

  perch(b, wp) {
    b.state = 'perched';
    b.t = 0;
    b.pos.copy(wp);
    b.vel.set(0, 0, 0);
    b.perchTime = this.rnd.float(25, 90);
    b.yaw = this.rnd.float(0, Math.PI * 2);
    b.pitch = -0.3;
    b.roll = 0;
    b.alarm = { songThrush: 24, fieldfare: 32, chaffinch: 16 }[b.spId] || 20;
  }

  updatePerched(b, dt, players) {
    let threat = null;
    for (const p of players) {
      const d = p.pos.distanceTo(b.pos);
      const k = (p.crouch ? 0.6 : 1) * (p.speed < 1.2 ? 0.7 : 1);
      if (d < b.alarm * k) threat = p.pos;
    }
    if (threat || b.t > b.perchTime) this.takeOff(b, threat);
    else {
      b.lastCall -= dt;
      if (b.lastCall <= 0) {
        b.lastCall = this.callInterval(b) * 2;
        if (b.sp.call !== 'none') audio.play(b.sp.call, b.pos, { gain: 0.4, ref: 6 });
      }
    }
  }

  takeOff(b, threat) {
    b.state = 'flying';
    b.t = 0;
    b.mode = 'cruise';
    let dir;
    if (threat) dir = new THREE.Vector2(b.pos.x - threat.x, b.pos.z - threat.z).normalize();
    else dir = b.heading.lengthSq() > 0 ? b.heading.clone() : new THREE.Vector2(1, 0);
    dir.rotateAround(new THREE.Vector2(), this.rnd.float(-0.6, 0.6));
    b.heading.copy(dir);
    b.waypoints = [new THREE.Vector3(b.pos.x + dir.x * 500, 0, b.pos.z + dir.y * 500)];
    b.alt = this.rnd.float(...b.sp.flight.alt);
    b.vel.set(dir.x * 4, 3, dir.y * 4);
    audio.play('flap', b.pos, { gain: 0.6, ref: 5 });
  }

  updateFalling(b, dt) {
    b.vel.y -= 9.81 * dt;
    b.vel.multiplyScalar(1 - 0.6 * dt);
    b.pos.addScaledVector(b.vel, dt);
    b.yaw += b.spin.y * dt;
    b.pitch += b.spin.x * dt;
    b.roll += b.spin.z * dt;
    const g = this.ground(b.pos.x, b.pos.z) + 0.05;
    if (b.pos.y <= g) {
      b.pos.y = g;
      b.state = 'dead';
      b.t = 0;
      b.pitch = 0;
      b.roll = Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1) * 0.8;
      audio.play('hit', b.pos, { gain: 0.5, ref: 3 });
      this.emit('landed', { id: b.id });
    }
  }

  // ---------------- interactions ----------------

  gunshot(pos, shooterId) {
    if (!this.authority) return;
    for (const b of this.birds.values()) {
      const d = b.pos.distanceTo(pos);
      if (b.state === 'perched' && d < 75) this.takeOff(b, pos);
      else if (b.state === 'hidden' && b.sp.flight.style === 'whirr' && d < 22 && this.rnd.chance(0.5)) this.flush(b, pos);
      else if (b.state === 'flying' && d < 110 && b.mode !== 'flush' && b.mode !== 'soar') {
        b.flare = 4;
        const away = new THREE.Vector2(b.pos.x - pos.x, b.pos.z - pos.z).normalize();
        const cur = b.heading.clone();
        b.heading.lerp(away, 0.3).normalize();
        b.waypoints = [new THREE.Vector3(b.pos.x + (cur.x + away.x) * 300, 0, b.pos.z + (cur.y + away.y) * 300)];
        b.mode = 'cruise';
      }
    }
  }

  // The hunter's whistle draws passing thrush/finch flocks in.
  whistle(pos) {
    if (!this.authority) return 0;
    let n = 0;
    for (const g of this.groups) {
      if (this.time - g.called < 6) continue;
      const lead = g.members.find((m) => this.birds.has(m.id) && m.state === 'flying');
      if (!lead || lead.sp.behaviour !== 'flyover') continue;
      if (lead.pos.distanceTo(pos) > 240) continue;
      g.called = this.time;
      if (!this.rnd.chance(0.65)) continue;
      n++;
      const trees = this.pickPerchTrees(lead.sp, pos.x, pos.z, 55, 2);
      const land = trees && this.rnd.chance(0.55);
      for (const m of g.members) {
        if (!this.birds.has(m.id) || m.state !== 'flying') continue;
        if (land) {
          m.perchTree = this.rnd.pick(trees);
          m.mode = 'toPerch';
          m.waypoints = [this.perchPoint(m.perchTree)];
        } else {
          const off = m.offset || new THREE.Vector3();
          const a = this.rnd.float(0, Math.PI * 2);
          m.mode = 'cruise';
          m.alt = Math.max(m.sp.flight.alt[0], m.alt * 0.6);
          const pass = new THREE.Vector3(pos.x + Math.cos(a) * 18 + off.x, 0, pos.z + Math.sin(a) * 18 + off.z);
          const away = new THREE.Vector3().subVectors(pass, m.pos).setY(0).normalize().multiplyScalar(400).add(pass);
          m.waypoints = [pass, away];
        }
      }
    }
    return n;
  }

  // Shot pellet segment a->b; returns bird hit or null.
  testSegment(a, b, exclude) {
    let best = null;
    let bestT = Infinity;
    const ab = _v.subVectors(b, a);
    const len2 = ab.lengthSq();
    for (const bird of this.birds.values()) {
      if (bird.state !== 'flying' && bird.state !== 'perched') continue;
      if (exclude && exclude.has(bird.id)) continue;
      const c = this.authority ? bird.pos : bird.renderPos || bird.pos;
      _w.subVectors(c, a);
      const t = clamp(_w.dot(ab) / len2, 0, 1);
      const px = a.x + ab.x * t - c.x;
      const py = a.y + ab.y * t - c.y;
      const pz = a.z + ab.z * t - c.z;
      const d2 = px * px + py * py + pz * pz;
      const r = bird.radius;
      if (d2 < r * r && t < bestT) {
        best = bird;
        bestT = t;
      } else if (bird.state === 'flying' && d2 < (bird.sp.wingspan * 0.42) ** 2 && Math.abs(py) < bird.sp.length * 0.08 && t < bestT) {
        // pellet through the wing
        if (Math.random() < 0.4) {
          best = bird;
          bestT = t;
        }
      }
    }
    return best;
  }

  // Apply the result of a shot to a bird (authority only).
  applyHits(birdId, hits, shooterId, impulse) {
    const b = this.birds.get(birdId);
    if (!b || (b.state !== 'flying' && b.state !== 'perched')) return null;
    this.feathers.burst(b.pos, b.spId, Math.min(40, 6 + hits * 5));
    if (hits >= b.sp.toughness) {
      this.kill(b, shooterId, impulse);
      return 'kill';
    }
    if (!b.wounded) {
      // hit but not cleanly — it carries on and may drop later
      if (b.state === 'perched') this.takeOff(b, b.pos.clone().add(new THREE.Vector3(1, 0, 0)));
      b.wounded = this.rnd.float(2.5, 7);
      b.woundFatal = this.rnd.chance(0.65);
      b.owner = shooterId;
      this.emit('wound', { id: b.id, by: shooterId, spId: b.spId });
      return 'wound';
    }
    return null;
  }

  kill(b, shooterId, impulse) {
    b.state = 'falling';
    b.t = 0;
    b.owner = shooterId;
    b.wounded = 0;
    b.vel.multiplyScalar(0.55).add(impulse || new THREE.Vector3());
    b.vel.y = Math.min(b.vel.y, 1.5);
    b.spin.set(this.rnd.float(-8, 8), this.rnd.float(-6, 6), this.rnd.float(-10, 10));
    this.emit('kill', { id: b.id, by: shooterId, spId: b.spId, pos: b.pos.clone() });
  }

  pickup(birdId) {
    const b = this.birds.get(birdId);
    if (!b || b.state !== 'dead') return null;
    const owner = b.owner;
    const spId = b.spId;
    this.remove(b);
    return { owner, spId };
  }

  nearestDead(pos, maxD) {
    let best = null;
    let bd = maxD;
    for (const b of this.birds.values()) {
      if (b.state !== 'dead') continue;
      const d = b.pos.distanceTo(pos);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  // ---------------- animation ----------------

  animate(b, dt) {
    const sp = b.sp;
    const f = sp.flight;
    const P = this.authority ? b.pos : b.renderPos || b.pos;
    const root = b.model.root;
    if (b.state === 'hidden') {
      root.visible = false;
      return;
    }
    root.visible = true;
    root.position.copy(P);
    if (this.authority && b.state === 'flying') {
      const v = b.vel;
      const hs = Math.hypot(v.x, v.z);
      b.yaw = Math.atan2(v.x, v.z);
      b.pitch = -Math.atan2(v.y, Math.max(0.1, hs)) * 0.7;
      b.roll = clamp(-(b.turn || 0) * 0.5, -0.9, 0.9);
    }
    root.rotation.set(b.pitch, b.yaw, b.roll, 'YXZ');

    let mode = 'flap';
    let hz = Math.min(f.flapHz, 13);
    if (b.state === 'flying') {
      const tt = b.t + b.id * 0.37;
      if (f.style === 'bounding') mode = tt % 0.8 < 0.45 ? 'flap' : 'fold';
      else if (f.style === 'direct') mode = tt % 2.6 < 2.0 ? 'flap' : 'glide';
      else if (f.style === 'whirr') mode = b.t < 1.4 || tt % 1.4 < 0.9 ? 'flap' : 'glide';
      else if (f.style === 'soar') mode = tt % 14 < 1.6 ? 'flap' : 'glide';
      if (b.mode === 'landing' && f.style === 'whirr') mode = 'glide';
      if (b.wounded) hz *= 0.7;
    } else if (b.state === 'perched') mode = 'perch';
    else if (b.state === 'falling') mode = 'limp';
    else mode = 'fold';
    if (!this.authority && b.wingMode) mode = b.wingMode;
    b.wing = mode;
    if (mode === 'flap') b.phase += dt * hz * Math.PI * 2;
    poseWings(b.model, mode, b.phase, f.style === 'soar' ? 0.5 : 1, this.time + b.id);
    // a little head bob when perched
    if (b.state === 'perched') b.model.head.rotation.y = Math.sin(this.time * 0.8 + b.id) * 0.6;
  }

  // ---------------- network ----------------

  snapshot() {
    const out = [];
    for (const b of this.birds.values()) {
      if (b.state === 'hidden') continue;
      out.push([
        b.id,
        SPECIES_LIST.indexOf(b.spId),
        STATES.indexOf(b.state),
        +b.pos.x.toFixed(2), +b.pos.y.toFixed(2), +b.pos.z.toFixed(2),
        +b.yaw.toFixed(2), +b.pitch.toFixed(2), +b.roll.toFixed(2),
        WING.indexOf(b.wing),
        b.owner || 0,
      ]);
    }
    return out;
  }

  // Snapshots carry the host's clock; map it onto ours so motion stays
  // smooth even when packets arrive in bursts.
  applySnapshot(list, hostTime) {
    const now = performance.now() / 1000;
    const off = now - hostTime;
    if (this.clockOff == null || off < this.clockOff) this.clockOff = off;
    else this.clockOff += Math.min(0.002, off - this.clockOff); // let it relax slowly if latency grows
    const time = hostTime + this.clockOff;
    const seen = new Set();
    for (const s of list) {
      const [id, spi, sti, x, y, z, yaw, pitch, roll, wi, owner] = s;
      seen.add(id);
      let b = this.birds.get(id);
      if (!b) {
        b = this.create(SPECIES_LIST[spi], id);
        b.renderPos = new THREE.Vector3(x, y, z);
      }
      b.state = STATES[sti];
      b.owner = owner || null;
      b.wingMode = WING[wi];
      b.samples.push({ t: time, x, y, z, yaw, pitch, roll });
      if (b.samples.length > 8) b.samples.shift();
      b.pos.set(x, y, z);
    }
    for (const b of [...this.birds.values()]) if (!seen.has(b.id)) this.remove(b);
  }

  interpolate() {
    const rt = performance.now() / 1000 - 0.12;
    for (const b of this.birds.values()) {
      const s = b.samples;
      if (!s.length) continue;
      if (!b.renderPos) b.renderPos = new THREE.Vector3();
      let i = s.length - 1;
      while (i > 0 && s[i - 1].t > rt) i--;
      const a = s[Math.max(0, i - 1)];
      const c = s[i];
      const span = c.t - a.t;
      const k = span > 0 ? clamp((rt - a.t) / span, 0, 1.5) : 1;
      b.renderPos.set(a.x + (c.x - a.x) * k, a.y + (c.y - a.y) * k, a.z + (c.z - a.z) * k);
      b.yaw = lerpAngle(a.yaw, c.yaw, Math.min(1, k));
      b.pitch = a.pitch + (c.pitch - a.pitch) * Math.min(1, k);
      b.roll = a.roll + (c.roll - a.roll) * Math.min(1, k);
    }
  }

  clear() {
    for (const b of [...this.birds.values()]) this.remove(b);
  }
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// Feathers drifting down after a hit.
class Feathers {
  constructor(scene) {
    const g = new THREE.PlaneGeometry(1, 0.35);
    const m = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 1 });
    this.cap = 500;
    this.mesh = new THREE.InstancedMesh(g, m, this.cap);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.p = [];
    this.dummy = new THREE.Object3D();
  }

  burst(pos, spId, n) {
    const cols = featherColor(spId);
    const size = SPECIES[spId].length * 0.18;
    for (let i = 0; i < n; i++) {
      if (this.p.length >= this.cap) this.p.shift();
      this.p.push({
        pos: pos.clone(),
        vel: new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 1.5, (Math.random() - 0.5) * 3),
        rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        spin: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6),
        life: 6 + Math.random() * 4,
        size: size * (0.6 + Math.random() * 0.8),
        col: cols[i % cols.length],
      });
    }
  }

  update(dt) {
    const d = this.dummy;
    let n = 0;
    this.p = this.p.filter((f) => (f.life -= dt) > 0);
    for (const f of this.p) {
      f.vel.y = Math.max(f.vel.y - 4 * dt, -0.5);
      f.vel.x *= 1 - 1.5 * dt;
      f.vel.z *= 1 - 1.5 * dt;
      f.pos.addScaledVector(f.vel, dt);
      f.pos.x += Math.sin(f.life * 3) * 0.2 * dt;
      f.rot.x += f.spin.x * dt;
      f.rot.y += f.spin.y * dt;
      f.rot.z += f.spin.z * dt;
      d.position.copy(f.pos);
      d.rotation.copy(f.rot);
      d.scale.setScalar(f.size * Math.min(1, f.life));
      d.updateMatrix();
      this.mesh.setMatrixAt(n, d.matrix);
      this.mesh.setColorAt(n, f.col);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
