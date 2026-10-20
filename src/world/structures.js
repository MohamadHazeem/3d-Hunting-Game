import * as THREE from 'three';
import { loadTex } from '../core/assets.js';
import { Random } from '../core/rng.js';

// Traditional Lebanese stone house with a red-tile hip roof near the track,
// and a village of red roofs on a distant ridge.

export class Structures {
  constructor(hunt, terrain) {
    this.hunt = hunt;
    this.terrain = terrain;
    this.boxes = []; // collision AABBs {minX,maxX,minZ,maxZ,top}
  }

  findHouseSpot() {
    const r = new Random(this.hunt.seed + 77);
    let best = null;
    for (let i = 0; i < 300; i++) {
      const x = r.float(-260, 260);
      const z = r.float(-260, 260);
      const d = this.terrain.road(x, z);
      if (d < 9 || d > 20) continue;
      if (Math.hypot(x, z) < 40) continue;
      const hs = [-5, 5].flatMap((dx) => [-5, 5].map((dz) => this.terrain.height(x + dx, z + dz)));
      const span = Math.max(...hs) - Math.min(...hs);
      if (!best || span < best.span) best = { x, z, span, base: Math.min(...hs) };
      if (span < 1.2) break;
    }
    return best;
  }

  async build(scene) {
    const [wallD, wallN, roofD, roofN] = await Promise.all([
      loadTex('rustic_stone_wall_diff.jpg', true),
      loadTex('rustic_stone_wall_nor_gl.jpg'),
      loadTex('clay_roof_tiles_diff.jpg', true),
      loadTex('clay_roof_tiles_nor_gl.jpg'),
    ]);
    const wallMat = new THREE.MeshStandardMaterial({ map: wallD, normalMap: wallN, roughness: 0.92, color: 0xf0e2c8 });
    const roofMat = new THREE.MeshStandardMaterial({ map: roofD, normalMap: roofN, roughness: 0.8, color: 0xffd8c0 });
    this.wallMat = wallMat;
    this.roofMat = roofMat;

    const spot = this.findHouseSpot();
    if (spot) {
      this.house = this.makeHouse(spot.x, spot.base, spot.z, new Random(this.hunt.seed).float(0, Math.PI));
      scene.add(this.house);
      this.clearing = { x: spot.x, z: spot.z, r: 11 };
    } else {
      this.clearing = { x: 1e9, z: 0, r: 0 };
    }
    scene.add(this.makeVillage());
  }

  makeHouse(x, y, z, rot) {
    const g = new THREE.Group();
    const W = 9;
    const D = 7;
    const H = 3.4;
    const tile = (geo, sx, sy) => {
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
      return geo;
    };
    // walls (+ foundation going into the slope)
    const body = new THREE.Mesh(tile(new THREE.BoxGeometry(W, H + 2, D), W / 2.5, (H + 2) / 2.5), this.wallMat);
    body.position.y = (H + 2) / 2 - 2;
    body.castShadow = body.receiveShadow = true;
    g.add(body);
    // hip roof: four-sided pyramid stretched over the footprint
    const roofGeo = new THREE.ConeGeometry(1, 1, 4, 1, true);
    roofGeo.rotateY(Math.PI / 4);
    roofGeo.scale((W + 1) / Math.SQRT2, 2.2, (D + 1) / Math.SQRT2);
    tile(roofGeo, 6, 3);
    const roof = new THREE.Mesh(roofGeo, this.roofMat);
    roof.position.y = H + 1.1;
    roof.castShadow = true;
    g.add(roof);
    // triple-arched window (the classic Lebanese facade), door, windows
    const dark = new THREE.MeshStandardMaterial({ color: 0x15120f, roughness: 1 });
    const wood = new THREE.MeshStandardMaterial({ color: 0x3d5a6a, roughness: 0.7 });
    for (let i = -1; i <= 1; i++) {
      const arch = new THREE.Mesh(new THREE.BoxGeometry(0.75, 1.6, 0.1), dark);
      arch.position.set(i * 0.95, 1.8, D / 2 + 0.01);
      g.add(arch);
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.375, 0.375, 0.1, 16, 1, false, 0, Math.PI), dark);
      top.rotation.set(Math.PI / 2, 0, Math.PI / 2);
      top.position.set(i * 0.95, 2.6, D / 2 + 0.01);
      g.add(top);
    }
    const door = new THREE.Mesh(new THREE.BoxGeometry(1.1, 2.2, 0.12), wood);
    door.position.set(-W / 2 + 1.6, 1.1, D / 2 + 0.02);
    g.add(door);
    for (const sx of [-1, 1]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 0.9), wood);
      win.position.set(sx * (W / 2 + 0.02), 1.9, 0);
      g.add(win);
    }
    g.position.set(x, y, z);
    g.rotation.y = rot;
    g.updateMatrixWorld(true);
    // collision box (axis-aligned approx using the rotated footprint radius)
    const r = Math.max(W, D) / 2 + 0.3;
    const c = Math.abs(Math.cos(rot));
    const s = Math.abs(Math.sin(rot));
    const hx = (W / 2) * c + (D / 2) * s + 0.3;
    const hz = (W / 2) * s + (D / 2) * c + 0.3;
    this.boxes.push({ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz, top: y + H + 2, r });
    this.houseInfo = { x, z, rot, W, D };
    return g;
  }

  makeVillage() {
    const r = new Random(this.hunt.seed + 3);
    const g = new THREE.Group();
    const count = 46;
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    boxGeo.translate(0, 0.5, 0);
    const roofGeo = new THREE.ConeGeometry(0.75, 0.45, 4);
    roofGeo.rotateY(Math.PI / 4);
    roofGeo.translate(0, 0.225, 0);
    const walls = new THREE.InstancedMesh(boxGeo, new THREE.MeshStandardMaterial({ color: 0xe8dcc4, roughness: 0.9 }), count);
    const roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshStandardMaterial({ color: 0xa8432c, roughness: 0.8 }), count);
    // pick a ridge 1.3–2.2 km away
    const ang = r.float(0, Math.PI * 2);
    const dist = r.float(1300, 2100);
    const vx = Math.cos(ang) * dist;
    const vz = Math.sin(ang) * dist;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    for (let i = 0; i < count; i++) {
      const x = vx + r.gauss() * 90;
      const z = vz + r.gauss() * 90;
      const y = this.terrain.rawHeight(x, z) - 1;
      const w = r.float(8, 14);
      const d = r.float(7, 11);
      const h = r.float(4, 8);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.float(0, Math.PI));
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(w, h, d));
      walls.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(x, y + h, z), q, new THREE.Vector3(w * 1.05, 4.5, d * 1.05));
      roofs.setMatrixAt(i, m);
    }
    g.add(walls, roofs);
    // church bell tower
    const tower = new THREE.Mesh(new THREE.BoxGeometry(5, 18, 5), walls.material);
    const ty = this.terrain.rawHeight(vx, vz);
    tower.position.set(vx, ty + 8, vz);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(3.6, 6, 4), roofs.material);
    cap.position.set(vx, ty + 20, vz);
    cap.rotation.y = Math.PI / 4;
    g.add(tower, cap);
    return g;
  }

  collide(pos, radius) {
    for (const b of this.boxes) {
      if (pos.y > b.top) continue;
      if (pos.x > b.minX - radius && pos.x < b.maxX + radius && pos.z > b.minZ - radius && pos.z < b.maxZ + radius) {
        const dl = pos.x - (b.minX - radius);
        const dr = b.maxX + radius - pos.x;
        const dt = pos.z - (b.minZ - radius);
        const db = b.maxZ + radius - pos.z;
        const mn = Math.min(dl, dr, dt, db);
        if (mn === dl) pos.x = b.minX - radius;
        else if (mn === dr) pos.x = b.maxX + radius;
        else if (mn === dt) pos.z = b.minZ - radius;
        else pos.z = b.maxZ + radius;
      }
    }
  }
}
