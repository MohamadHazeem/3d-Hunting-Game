import * as THREE from 'three';
import { Random } from '../core/rng.js';
import { PLAY_RADIUS } from '../world/terrain.js';
import { featherColor } from './birdModel.js';

// Need zones: the places and hours where a species does what it needs to do
// each day — thrush feeding in an olive grove after dawn, quail feeding in the
// stubble, doves coming down to drink, woodpigeons flighting to roost along a
// ridge, flocks going to roost in the pines at dusk. While a zone is active its
// birds gather there (the host spawns them in). Zones start hidden: a hunter
// finds one by spotting its birds there with the binoculars, by finding the
// sign they leave (feathers and droppings), or by walking into the birds.
//
// The host builds the zones from the hunting ground (where the olive groves,
// pines, stubble and low ground are) and sends them to the other hunters.

// place: the habitat to look for; alt: fallbacks. hours: [from, to] in game
// hours, or 'dusk' / 'late' / 'eve', which follow the day's sunset.
const DEFS = {
  koura: [
    { id: 'thrushFeed', sp: 'songThrush', kind: 'feed', place: 'olive', hours: [[6.5, 10]] },
    { id: 'finchFeed', sp: 'chaffinch', kind: 'feed', place: 'olive', alt: ['oak'], hours: [[9, 13]] },
    { id: 'doveDrink', sp: 'turtleDove', kind: 'drink', place: 'water', hours: [[7, 9.5], 'dusk'] },
    { id: 'thrushRoost', sp: 'songThrush', kind: 'roost', place: 'pine', alt: ['oak', 'olive'], hours: ['dusk'] },
  ],
  bekaa: [
    { id: 'quailDawn', sp: 'quail', kind: 'ground', place: 'stubble', hours: [[5.5, 9.5]] },
    { id: 'doveDrink', sp: 'turtleDove', kind: 'drink', place: 'water', hours: [[7, 9.5], 'dusk'] },
    { id: 'doveFeed', sp: 'turtleDove', kind: 'groundFeed', place: 'stubble', hours: [[9.5, 12.5]] },
    { id: 'quailEve', sp: 'quail', kind: 'ground', place: 'stubble', hours: ['eve'] },
  ],
  chouf: [
    { id: 'woodcockCover', sp: 'woodcock', kind: 'ground', place: 'oak', hours: [[7, 17]] },
    { id: 'pigeonRoost', sp: 'woodpigeon', kind: 'roost', place: 'pine', alt: ['oak'], hours: ['dusk'] },
    { id: 'pigeonLine', sp: 'woodpigeon', kind: 'line', place: 'ridge', to: 'pigeonRoost', hours: ['late'] },
    { id: 'pigeonFeed', sp: 'woodpigeon', kind: 'feed', place: 'oak', hours: [[9, 12.5]] },
    { id: 'thrushRoost', sp: 'songThrush', kind: 'roost', place: 'pine', alt: ['oak'], hours: ['dusk'] },
  ],
  akkar: [
    { id: 'fieldfareFeed', sp: 'fieldfare', kind: 'feed', place: 'juniper', alt: ['cedar'], hours: [[8, 12]] },
    { id: 'finchFeed', sp: 'chaffinch', kind: 'feed', place: 'juniper', alt: ['oak'], hours: [[10, 14]] },
    { id: 'pigeonFeed', sp: 'woodpigeon', kind: 'feed', place: 'oak', alt: ['cedar', 'juniper'], hours: [[9, 12.5]] },
    { id: 'fieldfareRoost', sp: 'fieldfare', kind: 'roost', place: 'cedar', alt: ['juniper'], hours: ['dusk'] },
  ],
  free: [
    { id: 'thrushFeed', sp: 'songThrush', kind: 'feed', place: 'olive', hours: [[6.5, 10]] },
    { id: 'quailDawn', sp: 'quail', kind: 'ground', place: 'stubble', hours: [[5.5, 9.5]] },
    { id: 'doveDrink', sp: 'turtleDove', kind: 'drink', place: 'water', hours: [[7, 9.5], 'dusk'] },
    { id: 'pigeonFeed', sp: 'woodpigeon', kind: 'feed', place: 'oak', hours: [[9.5, 12.5]] },
    { id: 'woodcockCover', sp: 'woodcock', kind: 'ground', place: 'oak', hours: [[7, 17]] },
    { id: 'thrushRoost', sp: 'songThrush', kind: 'roost', place: 'pine', alt: ['oak', 'olive'], hours: ['dusk'] },
    { id: 'pigeonLine', sp: 'woodpigeon', kind: 'line', place: 'ridge', to: 'thrushRoost', hours: ['late'] },
  ],
};

const TREE_PLACES = new Set(['olive', 'pine', 'oak', 'juniper', 'cedar']);
// how many birds a zone holds, and how often a new party comes in (s)
const TARGET = { feed: 9, roost: 16, drink: 6, groundFeed: 8, ground: 7, line: 14 };
const EVERY = { feed: [18, 30], roost: [10, 18], drink: [20, 34], groundFeed: [18, 30], line: [12, 22] };

export class Zones {
  constructor(scene, terrain, veg, hunt, sunset) {
    this.scene = scene;
    this.terrain = terrain;
    this.veg = veg;
    this.hunt = hunt;
    this.sunset = sunset;
    this.list = [];
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  hoursOf(h) {
    const s = this.sunset;
    if (h === 'dusk') return [s - 1.4, s + 0.3];
    if (h === 'late') return [s - 2.6, s - 0.1];
    if (h === 'eve') return [s - 2.5, s + 0.3];
    return h;
  }

  active(z, hour) {
    return z.hours.some(([a, b]) => hour >= a && hour < b);
  }

  // the window in force now, or the next one today
  window(z, hour) {
    const now = z.hours.find(([a, b]) => hour >= a && hour < b);
    if (now) return { on: true, from: now[0], to: now[1] };
    const next = z.hours.filter(([a]) => a > hour).sort((x, y) => x[0] - y[0])[0];
    return next ? { on: false, from: next[0], to: next[1] } : null;
  }

  // ---------------- building (host) ----------------

  build(spawn) {
    const defs = (DEFS[this.hunt.id] || []).filter((d) => this.hunt.species[d.sp]);
    const rnd = new Random(this.hunt.seed + 4711);
    const taken = [];
    for (const d of defs) {
      const spot = this.find(d, spawn, taken, rnd);
      if (!spot) continue;
      taken.push(spot);
      const z = {
        id: d.id, sp: d.sp, kind: d.kind, place: spot.place, x: +spot.x.toFixed(1), z: +spot.z.toFixed(1), r: spot.r,
        hours: d.hours.map((h) => this.hoursOf(h)), found: false, signs: [], water: d.place === 'water', dir: null,
        trees: spot.trees || null, t: rnd.float(2, 8), to: d.to,
      };
      // a few patches of sign on the ground round the middle of the zone
      for (let i = 0; i < 3; i++) {
        const a = rnd.float(0, Math.PI * 2);
        const r = z.water ? rnd.float(2.5, 6) : rnd.float(z.r * 0.15, z.r * 0.65);
        z.signs.push([+(z.x + Math.cos(a) * r).toFixed(1), +(z.z + Math.sin(a) * r).toFixed(1)]);
      }
      this.list.push(z);
    }
    // flight lines lead towards the roost they serve
    for (const z of this.list) {
      if (z.kind !== 'line') continue;
      const to = this.list.find((o) => o.id === z.to);
      z.dir = to ? Math.atan2(to.z - z.z, to.x - z.x) : rnd.float(0, Math.PI * 2);
    }
    this.makeMeshes();
  }

  find(d, spawn, taken, rnd) {
    // 80-280 m from where the hunt starts (a walk, not a trek), apart from
    // the other zones; returns a penalty that grows past ~150 m, or -1
    const far = (x, z) => {
      const ds = Math.hypot(x - spawn.x, z - spawn.z);
      if (ds < 80 || ds > 280 || Math.hypot(x, z) > PLAY_RADIUS - 45) return -1;
      if (!taken.every((o) => Math.hypot(o.x - x, o.z - z) > 110)) return -1;
      return Math.max(0, ds - 150) / 45;
    };
    if (TREE_PLACES.has(d.place)) {
      for (const type of [d.place, ...(d.alt || [])]) {
        const spot = this.findTrees(type, far, rnd);
        if (spot) return spot;
      }
      return null;
    }
    return this.findOpen(d.place, far, rnd);
  }

  // the densest stand of one kind of tree (a stand of at least four)
  findTrees(type, far, rnd) {
    const cand = this.veg.trees.filter((t) => t.type === type && far(t.x, t.z) >= 0);
    if (!cand.length) return null;
    let best = null;
    for (let i = 0; i < Math.min(260, cand.length); i++) {
      const t = cand.length > 260 ? rnd.pick(cand) : cand[i];
      const near = this.veg.treesNear(t.x, t.z, 35).filter((o) => o.type === type);
      const score = Math.min(near.length, 24) - far(t.x, t.z) + rnd.next() * 0.5;
      if (near.length >= 4 && (!best || score > best.score)) best = { score, near };
    }
    if (!best) return null;
    const near = best.near;
    let x = 0;
    let z = 0;
    for (const t of near) {
      x += t.x;
      z += t.z;
    }
    x /= near.length;
    z /= near.length;
    const r = Math.min(50, Math.max(24, Math.max(...near.map((t) => Math.hypot(t.x - x, t.z - z))) * 0.9));
    return { x, z, r: Math.round(r), place: type, trees: near.slice(0, 40) };
  }

  // stubble (open, level fields), water (a low, level spot in the open) or a
  // ridge (a high, open spot flocks cross on their way to roost)
  findOpen(place, far, rnd) {
    const t = this.terrain;
    const n = new THREE.Vector3();
    let best = null;
    for (let gz = -PLAY_RADIUS; gz <= PLAY_RADIUS; gz += 18) {
      for (let gx = -PLAY_RADIUS; gx <= PLAY_RADIUS; gx += 18) {
        const x = gx + rnd.float(-5, 5);
        const z = gz + rnd.float(-5, 5);
        const pen = far(x, z);
        if (pen < 0) continue;
        const m = t.maskAt(x, z);
        const lvl = t.normal(x, z, n).y;
        if (t.road(x, z) < 8 || m.snow > 0.4) continue;
        const h = t.height(x, z);
        let ring = 0;
        for (let k = 0; k < 6; k++) ring += t.height(x + Math.cos(k) * 45, z + Math.sin(k) * 45) / 6;
        let score;
        if (place === 'stubble') {
          if (m.forest > 0.3 || lvl < 0.93) continue;
          let f = 0;
          for (let k = 0; k < 4; k++) f += t.maskAt(x + Math.cos(k * 1.57) * 25, z + Math.sin(k * 1.57) * 25).field;
          score = m.field + f / 4 - m.forest - this.veg.treesNear(x, z, 25).length * 0.05;
        } else if (place === 'water') {
          if (m.forest > 0.5 || lvl < 0.95 || this.veg.treesNear(x, z, 4).length) continue;
          score = ring - h; // a hollow, where water gathers
        } else {
          if (m.forest > 0.45) continue;
          score = h - ring - this.veg.treesNear(x, z, 20).length * 0.3;
        }
        score += rnd.next() * 0.3 - pen * (place === 'stubble' ? 0.25 : 1.5);
        if (!best || score > best.score) best = { x, z, score };
      }
    }
    if (!best) return null;
    return { x: best.x, z: best.z, r: place === 'water' ? 26 : place === 'ridge' ? 45 : 50, place };
  }

  // ---------------- birds (host) ----------------

  // Keep each active zone stocked: a fresh party flies in when it runs low;
  // flight lines get a flock every so often while they're on.
  update(dt, birds, players, hour) {
    let busy = null;
    for (const z of this.list) {
      const on = this.active(z, hour);
      z.t -= dt;
      if (z.kind === 'ground') {
        if (!on) {
          if (z.stocked) birds.releaseZone(z.id);
          z.stocked = false;
          continue;
        }
        z.stocked = true;
        if (z.t > 0) continue;
        z.t = 3;
        if (birds.zoneCount(z.id) < TARGET.ground) birds.spawnGround(z.sp, players, 30, z.r, z, z.id);
        continue;
      }
      if (!on || z.t > 0) continue;
      const [a, b] = EVERY[z.kind];
      z.t = a + Math.random() * (b - a);
      if (birds.zoneCount(z.id, z.kind === 'line') >= TARGET[z.kind]) continue;
      busy = busy ?? birds.activeCount();
      if (busy > 120) continue;
      birds.spawnZoneFlock(z, players);
    }
  }

  // ---------------- network ----------------

  netList() {
    return this.list.map(({ id, sp, kind, place, x, z, r, hours, found, signs, water, dir }) => ({ id, sp, kind, place, x, z, r, hours, found, signs, water, dir }));
  }

  applyNet(list) {
    this.list = list.map((z) => ({ ...z }));
    this.makeMeshes();
  }

  setFound(id) {
    const z = this.list.find((o) => o.id === id);
    if (!z || z.found) return null;
    z.found = true;
    return z;
  }

  // ---------------- on the ground ----------------

  // Feathers and droppings at each patch of sign, and a stone trough at a
  // drinking spot.
  makeMeshes() {
    for (const c of [...this.group.children]) this.group.remove(c);
    const t = this.terrain;
    const dummy = new THREE.Object3D();
    const featherGeo = new THREE.PlaneGeometry(0.16, 0.05);
    featherGeo.rotateX(-Math.PI / 2);
    const dropGeo = new THREE.CircleGeometry(0.03, 6);
    dropGeo.rotateX(-Math.PI / 2);
    const nSigns = this.list.reduce((a, z) => a + z.signs.length, 0);
    const feathers = new THREE.InstancedMesh(featherGeo, new THREE.MeshStandardMaterial({ roughness: 1, side: THREE.DoubleSide }), nSigns * 7);
    const drops = new THREE.InstancedMesh(dropGeo, new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.8 }), nSigns * 14);
    const rnd = new Random(this.hunt.seed + 99);
    let fi = 0;
    let di = 0;
    for (const z of this.list) {
      const cols = featherColor(z.sp);
      for (const [sx, sz] of z.signs) {
        for (let k = 0; k < 7; k++) {
          const x = sx + rnd.float(-0.9, 0.9);
          const zz = sz + rnd.float(-0.9, 0.9);
          dummy.position.set(x, t.height(x, zz) + 0.02, zz);
          dummy.rotation.set(rnd.float(-0.15, 0.15), rnd.float(0, Math.PI * 2), rnd.float(-0.15, 0.15));
          dummy.scale.setScalar(rnd.float(0.7, 1.3));
          dummy.updateMatrix();
          feathers.setMatrixAt(fi, dummy.matrix);
          feathers.setColorAt(fi++, cols[k % cols.length]);
        }
        for (let k = 0; k < 14; k++) {
          const x = sx + rnd.float(-1.2, 1.2);
          const zz = sz + rnd.float(-1.2, 1.2);
          dummy.position.set(x, t.height(x, zz) + 0.015, zz);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.setScalar(rnd.float(0.6, 1.4));
          dummy.updateMatrix();
          drops.setMatrixAt(di++, dummy.matrix);
        }
      }
      if (z.water) this.group.add(trough(z.x, z.z, t));
    }
    feathers.count = fi;
    drops.count = di;
    for (const m of [feathers, drops]) {
      m.receiveShadow = true;
      m.frustumCulled = false;
      this.group.add(m);
    }
  }
}

// An old stone trough fed by a spring, with a patch of trampled mud round it.
function trough(x, z, t) {
  const g = new THREE.Group();
  const y = t.height(x, z);
  const stone = new THREE.MeshStandardMaterial({ color: 0x9a8f7c, roughness: 0.95 });
  const L = 2.4;
  const W = 0.9;
  const H = 0.5;
  const parts = [
    [L, H, 0.14, 0, H / 2, W / 2 - 0.07],
    [L, H, 0.14, 0, H / 2, -W / 2 + 0.07],
    [0.14, H, W, L / 2 - 0.07, H / 2, 0],
    [0.14, H, W, -L / 2 + 0.07, H / 2, 0],
    [L, 0.12, W, 0, 0.06, 0],
  ];
  for (const [w, h, d, px, py, pz] of parts) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), stone);
    m.position.set(px, py, pz);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
  }
  const water = new THREE.Mesh(new THREE.PlaneGeometry(L - 0.28, W - 0.28), new THREE.MeshStandardMaterial({ color: 0x3d4b4c, roughness: 0.08, metalness: 0.1 }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = H - 0.1;
  g.add(water);
  const mud = new THREE.Mesh(new THREE.CircleGeometry(3.2, 20), new THREE.MeshStandardMaterial({ color: 0x5e4a36, roughness: 0.75, transparent: true, opacity: 0.85, depthWrite: false }));
  mud.rotation.x = -Math.PI / 2;
  mud.position.y = 0.04;
  mud.receiveShadow = true;
  g.add(mud);
  g.position.set(x, y - 0.05, z);
  g.rotation.y = (x * 7 + z * 3) % Math.PI;
  return g;
}
