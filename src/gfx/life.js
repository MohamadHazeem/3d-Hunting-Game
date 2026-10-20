import * as THREE from 'three';
import { Random } from '../core/rng.js';

// Small visual life around the hunter: dust (or snow) kicked up by boots on
// dry ground, and leaves drifting down from the oaks and olives.

const LEAF_TREES = { oak: 1, olive: 0.35, cedar: 0.15, juniper: 0.1, pine: 0.15 };

function leafTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(32, 4);
  ctx.bezierCurveTo(54, 18, 52, 44, 32, 60);
  ctx.bezierCurveTo(12, 44, 10, 18, 32, 4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(32, 6);
  ctx.lineTo(32, 58);
  ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class SceneLife {
  constructor(game, T) {
    this.terrain = game.terrain;
    this.veg = game.veg;
    this.hunt = game.hunt;
    this.rnd = new Random(7);
    this.stride = 0;
    this.lastPos = null;
    this.wasGrounded = true;
    this.leaves = [];
    this.leafAcc = 0;
    this.leafTimer = 0;
    this.nearTrees = [];
    this.leafWeight = 0;
    if (T.leaves) this.buildLeaves(game.scene);
  }

  buildLeaves(scene) {
    const g = new THREE.PlaneGeometry(0.07, 0.07);
    const m = new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 });
    this.cap = 160;
    this.leafMesh = new THREE.InstancedMesh(g, m, this.cap);
    this.leafMesh.count = 0;
    this.leafMesh.frustumCulled = false;
    this.leafMesh.castShadow = false;
    this.leafMesh.receiveShadow = true;
    scene.add(this.leafMesh);
    this.dummy = new THREE.Object3D();
    this.leafCols = {
      oak: [new THREE.Color(0.55, 0.36, 0.14), new THREE.Color(0.68, 0.5, 0.18), new THREE.Color(0.42, 0.3, 0.12)],
      olive: [new THREE.Color(0.55, 0.58, 0.42), new THREE.Color(0.7, 0.66, 0.42)],
      other: [new THREE.Color(0.5, 0.42, 0.22)],
    };
  }

  // ------------------------------------------------ boots
  footDust(game, dt) {
    const p = game.player;
    if (!p || !game.fx) return;
    const pos = p.pos;
    if (!this.lastPos) this.lastPos = pos.clone();
    const moved = Math.hypot(pos.x - this.lastPos.x, pos.z - this.lastPos.z);
    this.lastPos.copy(pos);
    if (moved > 3) return; // teleport / respawn
    const m = this.terrain.maskAt(pos.x, pos.z);
    const snow = m.snow > 0.5;
    const dry = this.hunt.ground.dryness;
    const dusty = snow || (m.forest < 0.5 && dry > 0.3);
    // landing from a jump
    if (p.grounded && !this.wasGrounded) this.puff(game, pos, snow, 5, 1.3);
    this.wasGrounded = p.grounded;
    if (!p.grounded || p.speed < 0.6 || !dusty) return;
    this.stride += moved;
    const strideLen = p.speed > 4.5 ? 1.45 : p.crouch ? 0.6 : 0.85;
    if (this.stride < strideLen) return;
    this.stride = 0;
    const n = p.speed > 4.5 ? 3 : p.crouch ? 0 : 1;
    if (n) this.puff(game, pos, snow, n, p.speed > 4.5 ? 1 : 0.6);
  }

  puff(game, pos, snow, n, strength) {
    const soil = this.terrain.kind === 'plain' || this.terrain.kind === 'terraces' ? [0.62, 0.48, 0.36] : [0.58, 0.52, 0.42];
    const col = snow ? [0.92, 0.94, 0.98] : soil;
    const y = this.terrain.height(pos.x, pos.z) + 0.06;
    const fwd = new THREE.Vector3(-Math.sin(game.player.yaw), 0, -Math.cos(game.player.yaw));
    for (let i = 0; i < n; i++) {
      const p = new THREE.Vector3(pos.x + fwd.x * 0.25 + (Math.random() - 0.5) * 0.3, y, pos.z + fwd.z * 0.25 + (Math.random() - 0.5) * 0.3);
      const v = new THREE.Vector3((Math.random() - 0.5) * 0.5, 0.25 + Math.random() * 0.35 * strength, (Math.random() - 0.5) * 0.5);
      game.fx.emit(p, v, { life: 1.1 + Math.random() * 0.8, size: 0.12, grow: 0.55 * strength, color: col, alpha: snow ? 0.45 : 0.28, drag: 2.2, rise: -0.05 });
    }
  }

  // ------------------------------------------------ leaves
  updateLeaves(game, dt) {
    if (!this.leafMesh) return;
    const pp = game.player.pos;
    this.leafTimer -= dt;
    if (this.leafTimer <= 0) {
      this.leafTimer = 1;
      this.nearTrees = this.veg.treesNear(pp.x, pp.z, 28).filter((t) => LEAF_TREES[t.type]);
      this.leafWeight = this.nearTrees.reduce((s, t) => s + LEAF_TREES[t.type], 0);
    }
    // a gusty, uneven fall rate: a few leaves a second under a stand of oaks
    const wind = 0.6 + 0.4 * Math.sin(performance.now() / 4000) * Math.sin(performance.now() / 1700);
    this.leafAcc += dt * Math.min(6, this.leafWeight * 0.22) * wind;
    while (this.leafAcc > 1 && this.leaves.length < this.cap && this.nearTrees.length) {
      this.leafAcc -= 1;
      const t = this.rnd.pick(this.nearTrees);
      if (this.rnd.next() > LEAF_TREES[t.type]) continue;
      const a = this.rnd.float(0, Math.PI * 2);
      const r = this.rnd.float(0.2, 1) * t.crownR;
      const pal = this.leafCols[t.type] || this.leafCols.other;
      this.leaves.push({
        p: new THREE.Vector3(t.x + Math.cos(a) * r, t.y + t.crownY + this.rnd.float(-0.5, 1), t.z + Math.sin(a) * r),
        v: new THREE.Vector3(),
        ph: this.rnd.float(0, 6),
        spin: this.rnd.float(2, 5),
        rest: 0,
        size: this.rnd.float(0.8, 1.4),
        col: pal[this.rnd.int(0, pal.length - 1)],
        rot: new THREE.Euler(this.rnd.float(0, 6), this.rnd.float(0, 6), 0),
      });
    }
    if (this.leafAcc > 1) this.leafAcc = 1;
    const d = this.dummy;
    const tt = performance.now() / 1000;
    let n = 0;
    for (let i = this.leaves.length - 1; i >= 0; i--) {
      const L = this.leaves[i];
      if (L.rest > 0) {
        L.rest -= dt;
        if (L.rest <= 0) {
          this.leaves.splice(i, 1);
          continue;
        }
      } else {
        // falling leaf: sinks, swings side to side and tumbles
        const sw = Math.sin(tt * 1.7 + L.ph);
        L.v.set(Math.cos(L.ph) * sw * 0.6 + 0.25 * wind, -0.55 - 0.25 * Math.abs(Math.cos(tt * 1.7 + L.ph)), Math.sin(L.ph) * sw * 0.6);
        L.p.addScaledVector(L.v, dt);
        L.rot.x += L.spin * dt * (0.6 + 0.4 * sw);
        L.rot.z += L.spin * 0.7 * dt;
        const g = this.terrain.height(L.p.x, L.p.z) + 0.02;
        if (L.p.y <= g) {
          L.p.y = g;
          L.rest = 6 + Math.random() * 6;
          L.rot.set(-Math.PI / 2, L.rot.y, 0);
        }
        if ((L.p.x - pp.x) ** 2 + (L.p.z - pp.z) ** 2 > 45 * 45) {
          this.leaves.splice(i, 1);
          continue;
        }
      }
      d.position.copy(L.p);
      d.rotation.copy(L.rot);
      d.scale.setScalar(L.size);
      d.updateMatrix();
      this.leafMesh.setMatrixAt(n, d.matrix);
      this.leafMesh.setColorAt(n, L.col);
      n++;
    }
    this.leafMesh.count = n;
    this.leafMesh.instanceMatrix.needsUpdate = true;
    if (this.leafMesh.instanceColor) this.leafMesh.instanceColor.needsUpdate = true;
  }

  update(game, dt) {
    if (dt <= 0 || !game.player) return;
    if (game.input && !game.input.locked && !game.net && !game.chatOpen) return; // paused
    this.footDust(game, dt);
    this.updateLeaves(game, dt);
  }
}
