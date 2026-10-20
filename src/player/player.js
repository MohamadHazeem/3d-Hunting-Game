import * as THREE from 'three';
import { PLAY_RADIUS } from '../world/terrain.js';
import { audio } from '../audio/audio.js';
import { clamp } from '../core/rng.js';

// First-person hunter: walking over terraces and through the scrub,
// crouching to sneak up on birds, binoculars for spotting.

const EYE = 1.65;
const EYE_CROUCH = 1.05;

export class Player {
  constructor(camera, world, input) {
    this.camera = camera;
    this.world = world;
    this.input = input;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.eye = EYE;
    this.eyeY = 0;
    this.grounded = true;
    this.crouch = false;
    this.ads = false;
    this.binocs = false;
    this.speed = 0;
    this.stride = 0;
    this.bob = 0;
    this.kick = new THREE.Vector2();
    this.fov = 72;
    this.baseFov = 72;
    this.sensitivity = 1;
    this.outOfBounds = 0;
  }

  spawn(x, z, yaw) {
    this.pos.set(x, this.world.terrain.height(x, z), z);
    this.eyeY = this.pos.y + EYE;
    this.yaw = yaw;
  }

  addRecoil(amount) {
    this.kick.x += amount * (0.9 + Math.random() * 0.3);
    this.kick.y += (Math.random() - 0.5) * amount * 0.4;
  }

  update(dt, locked) {
    const inp = this.input;
    if (locked) {
      const zoom = this.fov / this.baseFov;
      const s = 0.0021 * this.sensitivity * zoom;
      this.yaw -= inp.mouse.dx * s;
      this.pitch -= inp.mouse.dy * s;
      this.pitch = clamp(this.pitch, -1.45, 1.45);
    }
    inp.mouse.dx = 0;
    inp.mouse.dy = 0;

    // recoil recovers like a spring
    this.pitch += this.kick.x * dt * 12;
    this.yaw += this.kick.y * dt * 12;
    this.kick.multiplyScalar(Math.max(0, 1 - dt * 12));

    this.crouch = inp.down('KeyC') || inp.down('ControlLeft');
    const sprint = inp.down('ShiftLeft') && !this.crouch && !this.ads && !this.binocs;
    let target = this.crouch ? 1.5 : sprint ? 6.2 : 3.1;
    if (this.ads) target *= 0.55;
    if (this.binocs) target *= 0.3;
    const f = (inp.down('KeyW') || inp.down('ArrowUp') ? 1 : 0) - (inp.down('KeyS') || inp.down('ArrowDown') ? 1 : 0);
    const r = (inp.down('KeyD') || inp.down('ArrowRight') ? 1 : 0) - (inp.down('KeyA') || inp.down('ArrowLeft') ? 1 : 0);
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const wish = fwd.multiplyScalar(f).add(right.multiplyScalar(r));
    if (wish.lengthSq() > 1) wish.normalize();

    // slow down climbing steep ground
    const terrain = this.world.terrain;
    const n = terrain.normal(this.pos.x, this.pos.z);
    const uphill = -(n.x * wish.x + n.z * wish.z);
    if (uphill > 0) target *= clamp(1 - uphill * 1.6, 0.35, 1);

    const accel = this.grounded ? 10 : 2;
    this.vel.x += (wish.x * target - this.vel.x) * Math.min(1, accel * dt);
    this.vel.z += (wish.z * target - this.vel.z) * Math.min(1, accel * dt);
    if (this.grounded && inp.pressed('Space')) {
      this.vel.y = 4.3;
      this.grounded = false;
    }
    this.vel.y -= 9.81 * dt;
    this.pos.addScaledVector(this.vel, dt);

    // collisions
    this.world.veg.collide(this.pos, 0.35);
    this.world.structures.collide(this.pos, 0.35);
    const rr = Math.hypot(this.pos.x, this.pos.z);
    if (rr > PLAY_RADIUS) {
      this.pos.x *= PLAY_RADIUS / rr;
      this.pos.z *= PLAY_RADIUS / rr;
      this.outOfBounds = 2;
    }
    this.outOfBounds = Math.max(0, this.outOfBounds - dt);

    const g = terrain.height(this.pos.x, this.pos.z);
    if (this.pos.y <= g) {
      this.pos.y = g;
      this.vel.y = 0;
      this.grounded = true;
    } else if (this.grounded && this.pos.y - g < 0.6) {
      this.pos.y = g; // stick to the slope going downhill
      this.vel.y = 0;
    } else {
      this.grounded = false;
    }

    this.speed = Math.hypot(this.vel.x, this.vel.z);
    // footsteps & head bob
    if (this.grounded && this.speed > 0.4) {
      this.stride += this.speed * dt;
      this.bob += this.speed * dt * (sprint ? 1.5 : 2.1);
      const strideLen = sprint ? 1.45 : this.crouch ? 0.6 : 0.85;
      if (this.stride > strideLen) {
        this.stride = 0;
        const m = terrain.maskAt(this.pos.x, this.pos.z);
        const leaves = m.forest > 0.45;
        audio.play(leaves ? 'stepLeaves' : 'step', null, {
          gain: (this.crouch ? 0.18 : sprint ? 0.5 : 0.3) * (leaves ? 1.2 : 1),
          rate: 0.85 + Math.random() * 0.3,
        });
      }
    }

    this.eye += ((this.crouch ? EYE_CROUCH : EYE) - this.eye) * Math.min(1, dt * 8);
    // smooth the camera over terrace steps
    const targetEye = this.pos.y + this.eye;
    this.eyeY += (targetEye - this.eyeY) * Math.min(1, dt * (Math.abs(targetEye - this.eyeY) > 0.3 ? 9 : 25));
    // never let the eye sink into a rising slope or terrace wall just ahead
    let clear = -Infinity;
    for (let a = 0; a < 6; a++) {
      const ang = this.yaw + (a / 6) * Math.PI * 2;
      clear = Math.max(clear, terrain.height(this.pos.x - Math.sin(ang) * 0.7, this.pos.z - Math.cos(ang) * 0.7));
    }
    this.eyeY = Math.max(this.eyeY, clear + 0.45);

    const bobAmt = this.ads ? 0.15 : 1;
    const by = Math.sin(this.bob * 2) * 0.035 * bobAmt * Math.min(1, this.speed / 3);
    const bx = Math.cos(this.bob) * 0.025 * bobAmt * Math.min(1, this.speed / 3);
    this.camera.position.set(this.pos.x + Math.cos(this.yaw) * bx, this.eyeY + by, this.pos.z - Math.sin(this.yaw) * bx);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');

    const fovT = this.binocs ? 9 : this.ads ? 58 : this.baseFov;
    this.fov += (fovT - this.fov) * Math.min(1, dt * 10);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  get forward() {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
  }
}
