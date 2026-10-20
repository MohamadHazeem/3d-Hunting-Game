import * as THREE from 'three';

// Patterning boards by where you start: white paper on wooden stands at
// 20, 30 and 40 m. Shoot one to see the real spread of each choke; the
// pellets that land inside a 75 cm circle are counted, like a hunter
// patterning his gun.

const SIZE = 1.3; // metres
const PX = 512;
const CIRCLE_R = 0.375; // the classic 30-inch circle

export class PatternBoards {
  constructor(scene, terrain, veg, origin, yaw) {
    this.scene = scene;
    this.boards = [];
    this.origin = origin.clone();
    const post = new THREE.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.9 });
    const sign = new THREE.MeshStandardMaterial({ color: 0x3d2b1a, roughness: 0.9 });
    const spots = this.findSpots(terrain, veg, origin, yaw);
    spots.forEach(({ dist, x, z }, i) => {
      const gy = terrain.height(x, z);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = PX;
      const ctx = canvas.getContext('2d');
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      const group = new THREE.Group();
      group.position.set(x, gy, z);
      group.lookAt(origin.x, gy, origin.z);
      const paper = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
      paper.position.y = 1.25;
      paper.castShadow = true;
      paper.receiveShadow = true;
      group.add(paper);
      for (const sx of [-0.55, 0.55]) {
        const p = new THREE.Mesh(new THREE.BoxGeometry(0.07, 2.0, 0.07), post);
        p.position.set(sx, 0.9, -0.04);
        p.castShadow = true;
        group.add(p);
      }
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.03), sign);
      plate.position.set(0, 0.36, 0.0);
      group.add(plate);
      plate.add(this.label(`${dist} m`));
      scene.add(group);
      group.updateMatrixWorld(true);
      const center = paper.getWorldPosition(new THREE.Vector3());
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(group.quaternion);
      const rightV = new THREE.Vector3(1, 0, 0).applyQuaternion(group.quaternion);
      const board = { i, dist, group, ctx, tex, center, normal, right: rightV, up: new THREE.Vector3(0, 1, 0), hits: [], shotId: -1 };
      this.drawBlank(board);
      this.boards.push(board);
    });
  }

  // Boards go off to the right of where you start, where the ground and the
  // trees leave a clear line from the firing point to the paper.
  findSpots(terrain, veg, origin, yaw) {
    const eye = new THREE.Vector3(origin.x, origin.y + 1.6, origin.z);
    const used = [];
    const out = [];
    const offsets = [0];
    for (let k = 1; k <= 14; k++) offsets.push(k * 0.11, -k * 0.11);
    for (const dist of [20, 30, 40]) {
      let pick = null;
      for (const da of offsets) {
        const a = yaw - Math.PI / 2 + da;
        if (used.some((u) => Math.abs(u - a) < 0.12)) continue;
        const x = origin.x - Math.sin(a) * dist;
        const z = origin.z - Math.cos(a) * dist;
        const gy = terrain.height(x, z);
        if (terrain.normal(x, z).y < 0.9) continue;
        const target = new THREE.Vector3(x, gy + 1.25, z);
        let clear = true;
        for (let k = 1; k < 20 && clear; k++) {
          const p = eye.clone().lerp(target, k / 20);
          if (terrain.height(p.x, p.z) > p.y - 0.35) clear = false;
        }
        if (!clear || veg.segmentBlocked(eye, target)) continue;
        pick = { dist, x, z, a };
        break;
      }
      if (pick) {
        used.push(pick.a);
        out.push(pick);
      }
    }
    return out;
  }

  label(text) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 48;
    const g = c.getContext('2d');
    g.fillStyle = '#3d2b1a';
    g.fillRect(0, 0, 128, 48);
    g.fillStyle = '#f3ead8';
    g.font = '700 30px Inter, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 64, 26);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.15), new THREE.MeshBasicMaterial({ map: t }));
    m.position.z = 0.016;
    return m;
  }

  drawBlank(b) {
    const g = b.ctx;
    g.fillStyle = '#ecebe4';
    g.fillRect(0, 0, PX, PX);
    // faint grid every 10 cm
    g.strokeStyle = 'rgba(60,60,60,0.12)';
    g.lineWidth = 1;
    for (let k = 0; k <= SIZE; k += 0.1) {
      const p = (k / SIZE) * PX;
      g.beginPath();
      g.moveTo(p, 0);
      g.lineTo(p, PX);
      g.moveTo(0, p);
      g.lineTo(PX, p);
      g.stroke();
    }
    // a bird silhouette to aim at
    g.fillStyle = '#2b2620';
    g.beginPath();
    g.ellipse(PX / 2, PX / 2, 22, 11, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(PX / 2 - 6, PX / 2);
    g.lineTo(PX / 2 - 60, PX / 2 - 26);
    g.lineTo(PX / 2 + 4, PX / 2 - 4);
    g.moveTo(PX / 2 + 6, PX / 2);
    g.lineTo(PX / 2 + 60, PX / 2 - 26);
    g.lineTo(PX / 2 - 4, PX / 2 - 4);
    g.fill();
    b.tex.needsUpdate = true;
  }

  // A pellet travelling a -> b: returns true if it hits a board (and marks it).
  test(a, b, shotId) {
    for (const B of this.boards) {
      const da = (a.x - B.center.x) * B.normal.x + (a.y - B.center.y) * B.normal.y + (a.z - B.center.z) * B.normal.z;
      const db = (b.x - B.center.x) * B.normal.x + (b.y - B.center.y) * B.normal.y + (b.z - B.center.z) * B.normal.z;
      if (!(da > 0 && db <= 0)) continue;
      const k = da / (da - db);
      const px = a.x + (b.x - a.x) * k - B.center.x;
      const py = a.y + (b.y - a.y) * k - B.center.y;
      const pz = a.z + (b.z - a.z) * k - B.center.z;
      const u = px * B.right.x + py * B.right.y + pz * B.right.z;
      const v = py;
      if (Math.abs(u) > SIZE / 2 || Math.abs(v) > SIZE / 2) continue;
      if (B.shotId !== shotId) {
        B.shotId = shotId;
        B.hits = [];
        this.drawBlank(B);
      }
      B.hits.push([u, v]);
      const g = B.ctx;
      g.fillStyle = 'rgba(20,18,16,0.9)';
      g.beginPath();
      g.arc((u / SIZE + 0.5) * PX, (0.5 - v / SIZE) * PX, 2.2, 0, Math.PI * 2);
      g.fill();
      B.dirty = true;
      return true;
    }
    return false;
  }

  // After a shot has passed: count pellets in the densest 75 cm circle and
  // draw that circle on the paper.
  resolve(shotId, origin) {
    const out = [];
    for (const B of this.boards) {
      if (B.shotId !== shotId || B.reported === shotId) continue;
      B.reported = shotId;
      let best = { n: 0, u: 0, v: 0 };
      for (let u = -0.3; u <= 0.3; u += 0.05) {
        for (let v = -0.3; v <= 0.3; v += 0.05) {
          let n = 0;
          for (const [hu, hv] of B.hits) if ((hu - u) ** 2 + (hv - v) ** 2 < CIRCLE_R * CIRCLE_R) n++;
          if (n > best.n) best = { n, u, v };
        }
      }
      const g = B.ctx;
      g.strokeStyle = 'rgba(200,60,40,0.85)';
      g.lineWidth = 3;
      g.beginPath();
      g.arc((best.u / SIZE + 0.5) * PX, (0.5 - best.v / SIZE) * PX, (CIRCLE_R / SIZE) * PX, 0, Math.PI * 2);
      g.stroke();
      B.tex.needsUpdate = true;
      out.push({ dist: B.center.distanceTo(origin), onBoard: B.hits.length, inCircle: best.n });
    }
    return out;
  }

  update() {
    for (const B of this.boards) {
      if (B.dirty) {
        B.dirty = false;
        B.tex.needsUpdate = true;
      }
    }
  }

  nearFiringPoint(pos) {
    return Math.hypot(pos.x - this.origin.x, pos.z - this.origin.z) < 6;
  }
}
