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
    scene.userData.structures = this;
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

  // A village on a ridge 1.3–2.1 km away: cream and white houses, most with
  // red-tile roofs and some flat-roofed, dark cypresses between them, a
  // church bell tower or a minaret, and windows that light up at dusk.
  makeVillage() {
    const r = new Random(this.hunt.seed + 3);
    const g = new THREE.Group();
    const count = 72;
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    boxGeo.translate(0, 0.5, 0);
    const roofGeo = new THREE.ConeGeometry(0.75, 0.45, 4);
    roofGeo.rotateY(Math.PI / 4);
    roofGeo.translate(0, 0.225, 0);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
    const walls = new THREE.InstancedMesh(boxGeo, wallMat, count);
    const roofs = new THREE.InstancedMesh(roofGeo, new THREE.MeshStandardMaterial({ color: 0xa8432c, roughness: 0.8 }), count);
    const winGeo = new THREE.PlaneGeometry(1.6, 1.8);
    const winMat = new THREE.MeshBasicMaterial({ color: 0xffb066, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const wins = new THREE.InstancedMesh(winGeo, winMat, count * 3);
    // pick a ridge 1.3–2.1 km away
    const ang = r.float(0, Math.PI * 2);
    const dist = r.float(1300, 2100);
    const vx = Math.cos(ang) * dist;
    const vz = Math.sin(ang) * dist;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    let nr = 0;
    let nw = 0;
    // two or three clusters along the ridge
    const centres = [[vx, vz]];
    for (let k = 0; k < r.int(1, 2); k++) centres.push([vx + r.gauss() * 140, vz + r.gauss() * 140]);
    for (let i = 0; i < count; i++) {
      const [ccx, ccz] = r.pick(centres);
      const x = ccx + r.gauss() * 75;
      const z = ccz + r.gauss() * 75;
      const y = this.terrain.rawHeight(x, z) - 1;
      const w = r.float(8, 14);
      const d = r.float(7, 11);
      const h = r.float(4, 8) * (r.chance(0.25) ? 1.6 : 1);
      const rot = r.float(0, Math.PI);
      q.setFromAxisAngle(up, rot);
      m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(w, h, d));
      walls.setMatrixAt(i, m);
      // limestone cream, whitewash, a few ochre and pale pink
      const t = r.next();
      if (t < 0.45) col.setRGB(0.92, 0.86, 0.74);
      else if (t < 0.8) col.setRGB(0.97, 0.96, 0.93);
      else if (t < 0.92) col.setRGB(0.88, 0.74, 0.55);
      else col.setRGB(0.93, 0.8, 0.76);
      walls.setColorAt(i, col);
      if (r.chance(0.68)) {
        m.compose(new THREE.Vector3(x, y + h, z), q, new THREE.Vector3(w * 1.05, 4.5, d * 1.05));
        roofs.setMatrixAt(nr++, m);
      }
      // windows on the face towards the hunting ground
      const face = new THREE.Vector3(Math.sin(rot), 0, Math.cos(rot));
      const toCentre = new THREE.Vector3(-x, 0, -z).normalize();
      const sgn = face.dot(toCentre) > 0 ? 1 : -1;
      for (let k = 0; k < 3; k++) {
        if (!r.chance(0.55)) continue;
        const along = (k - 1) * w * 0.28;
        const p = new THREE.Vector3(x, y + h * r.float(0.35, 0.7), z)
          .addScaledVector(face, sgn * (d / 2 + 0.05))
          .addScaledVector(new THREE.Vector3(face.z, 0, -face.x), along);
        const wq = new THREE.Quaternion().setFromAxisAngle(up, rot + (sgn > 0 ? 0 : Math.PI));
        m.compose(p, wq, new THREE.Vector3(1, 1, 1));
        wins.setMatrixAt(nw++, m);
      }
    }
    roofs.count = nr;
    wins.count = nw;
    g.add(walls, roofs, wins);
    // dark Italian cypresses, the village's silhouette
    const cyp = new THREE.ConeGeometry(1.4, 14, 7);
    cyp.translate(0, 7, 0);
    const trees = new THREE.InstancedMesh(cyp, new THREE.MeshStandardMaterial({ color: 0x1f2b19, roughness: 1 }), 26);
    for (let i = 0; i < 26; i++) {
      const [ccx, ccz] = r.pick(centres);
      const x = ccx + r.gauss() * 95;
      const z = ccz + r.gauss() * 95;
      const s = r.float(0.7, 1.3);
      m.compose(new THREE.Vector3(x, this.terrain.rawHeight(x, z) - 0.5, z), q.identity(), new THREE.Vector3(s, s * r.float(0.9, 1.3), s));
      trees.setMatrixAt(i, m);
    }
    g.add(trees);
    const ty = this.terrain.rawHeight(vx, vz);
    const roofMat = roofs.material;
    if (this.hunt.id === 'bekaa' || this.hunt.id === 'akkar') {
      // mosque: dome and a slender minaret
      const mx = vx + 30;
      const my = this.terrain.rawHeight(mx, vz);
      const hall = new THREE.Mesh(new THREE.BoxGeometry(16, 8, 16), wallMat);
      hall.position.set(mx, my + 4, vz);
      const dome = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xb8c4c8, roughness: 0.5, metalness: 0.3 }));
      dome.position.set(mx, my + 8, vz);
      const min = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.4, 30, 10), wallMat);
      min.position.set(mx + 10, my + 15, vz + 6);
      const balcony = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 1, 10), wallMat);
      balcony.position.set(mx + 10, my + 24, vz + 6);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(1.3, 5, 10), dome.material);
      tip.position.set(mx + 10, my + 32.5, vz + 6);
      g.add(hall, dome, min, balcony, tip);
    }
    if (this.hunt.id !== 'bekaa') {
      // church bell tower
      const tower = new THREE.Mesh(new THREE.BoxGeometry(5, 18, 5), wallMat);
      tower.position.set(vx, ty + 8, vz);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(3.6, 6, 4), roofMat);
      cap.position.set(vx, ty + 20, vz);
      cap.rotation.y = Math.PI / 4;
      g.add(tower, cap);
    }
    this.villageWindows = winMat;
    return g;
  }

  // windows glow as the light goes
  update(sunElevation) {
    if (this.villageWindows) this.villageWindows.opacity = 0.9 * (1 - Math.min(1, Math.max(0, (sunElevation + 1) / 5)));
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
