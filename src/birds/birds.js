import * as THREE from 'three';
import { SPECIES, SPECIES_LIST } from '../config/species.js';
import { createBirdMesh, poseWings, poseLegs, featherColor } from './birdModel.js';
import { Random, clamp } from '../core/rng.js';
import { PLAY_RADIUS } from '../world/terrain.js';
import { audio } from '../audio/audio.js';
import { settings } from '../core/settings.js';

// Bird behaviour.
//
// Ground birds (quail, woodcock) sit hidden in cover and flush when a hunter
// walks close, fly a short way and drop back in. A sitting quail will often
// run off through the stubble first. Woodcock twist away between the trunks.
// Passage birds (thrush, fieldfare, chaffinch) come through in flocks along a
// flight line, flying as real flocks do (separation, alignment, cohesion), and
// some flocks drop into trees to feed. Flocks watch for hunters: a hunter
// moving in the open is seen from far off and the flock flares away; one who
// stands still under a tree often isn't. A shot scatters a flock and big ones
// split. Storks soar high overhead.
//
// The authority (solo game or multiplayer host) simulates; other players get
// snapshots and interpolate.

const STATES = ['hidden', 'flying', 'perched', 'falling', 'dead', 'running'];
const WING = ['flap', 'glide', 'fold', 'limp', 'perch', 'climb', 'flare', 'peck', 'preen', 'run'];
const F_WOUNDED = 1;
const DEFAULT_FLOCK = { sep: 3, coh: 0.5, ali: 0.5, spread: 10 };
const ZERO2 = new THREE.Vector2();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _eye = new THREE.Vector3();
const _d2 = new THREE.Vector2();
const _n = new THREE.Vector3();
// how far footsteps carry on each kind of ground (grass = 1)
const LOUD = { leaves: 1.35, gravel: 1.2, stone: 1.1, stubble: 1.05, grass: 1, snow: 0.75 };
const FINE_DAY = { cloud: 0, rain: 0, snow: 0, fog: 0 };

// The "Bird size" setting. Real size is true to life (an 18 cm quail at 30 m
// is a few pixels); "visible" draws every bird ~1.8× and grows its hit zone
// with it, so what you see is what you can hit.
export const BIRD_SIZE = { realistic: 1, visible: 1.8 };
export const birdSizeMul = () => BIRD_SIZE[settings.birdSize] ?? BIRD_SIZE.visible;

class Bird {
  constructor(id, spId, scene, size = 1) {
    this.id = id;
    this.spId = spId;
    this.sp = SPECIES[spId];
    this.size = size;
    this.model = createBirdMesh(spId, { scale: size, field: true });
    scene.add(this.model.root);
    this.scene = scene;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = new THREE.Vector2(1, 0);
    this.baseDir = new THREE.Vector2(1, 0);
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
    this.offY = 0;
    this.mode = 'cruise';
    this.group = null;
    this.owner = null;
    this.wound = null; // {type: 'flyOn' | 'tower' | 'glide', fatal, t, ...}
    this.flags = 0;
    this.flare = 0;
    this.flaring = false;
    this.takeoff = 0;
    this.takeoffDur = 0.5;
    this.scatter = new THREE.Vector2();
    this.jink = 0;
    this.jinkT = 0;
    this.treeCache = null;
    this.treeT = 0;
    this.act = 'look';
    this.actT = 0;
    this.hop = null;
    this.awareT = Math.random() * 0.25;
    this.pendingTakeoff = -1;
    this.landTries = 0;
    this.runs = 0;
    this.runRolled = false;
    this.samples = [];
    this.lastCall = Math.random() * 4;
  }

  dispose() {
    this.scene.remove(this.model.root);
  }

  get radius() {
    return this.sp.length * 0.24 * this.size;
  }

  setSize(k) {
    this.size = k;
    this.model.root.scale.setScalar(this.sp.length * k);
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
    this.sizeMul = birdSizeMul();
    this.feathers = new Feathers(scene, (x, z) => terrain.height(x, z));
    this.feathers.sizeMul = this.sizeMul;
    this.time = 0;
    this.weights = hunt.species;
    this.wind = new THREE.Vector3(); // m/s, the way it blows
    this.passage = 1; // how strong the migration is today
    this.passageHeading = Math.PI; // migrants head south in autumn (compass bearing)
    this.weather = null; // the day's Weather (rain, snow, fog 0..1), set by the Game
    this.sunset = 17.5; // hour of sunset (the evening flight is keyed to it), set by the Game
    this.firstFlockAt = 3; // a flock comes past within the first ~20 s of the hunt
  }

  // ---------------- weather ----------------
  // Small multipliers, all 1 on a fine day.

  get wx() {
    return this.weather || FINE_DAY;
  }

  // Migrants sit out a shower in cover rather than fly through it: heavy rain
  // cuts the passage to about a third.
  get rainPassage() {
    return 1 - 0.65 * this.wx.rain;
  }

  // A wet quail or woodcock clamps down and lets you walk much closer before
  // it goes (flushing soaked is costly).
  get rainSitTight() {
    return 1 - 0.35 * this.wx.rain;
  }

  // Fog (and to a lesser degree heavy rain) hides a hunter: thick fog cuts how
  // far a flock or a perched bird can pick him out to about 30%.
  get fogSight() {
    return (1 - 0.7 * this.wx.fog) * (1 - 0.2 * this.wx.rain);
  }

  emit(type, data) {
    this.events.push({ type, ...data });
  }

  create(spId, id = null) {
    const b = new Bird(id ?? this.nextId++, spId, this.scene, this.sizeMul);
    this.birds.set(b.id, b);
    return b;
  }

  remove(b) {
    b.dispose();
    this.birds.delete(b.id);
  }

  // The "Bird size" setting changed: every bird (and its hit zone) follows.
  setSize(k) {
    this.sizeMul = k;
    this.feathers.sizeMul = k;
    for (const b of this.birds.values()) b.setSize(k);
  }

  ground(x, z) {
    return this.terrain.height(x, z);
  }

  // ---------------- spawning (authority) ----------------

  // Ground birds are kept around the hunters (a "beat" of ~250 m), so walking
  // up quail or woodcock gives a flush every minute or two, like a good day.
  groundTarget(spId) {
    const w = this.weights[spId] || 0;
    return w ? Math.max(5, Math.round(w * (spId === 'quail' ? 50 : 30))) : 0;
  }

  // Most of the morning's birds sit 60-120 m out, a walk away; a few closer.
  initialPopulation(players) {
    for (const spId of ['quail', 'woodcock']) {
      const n = this.groundTarget(spId);
      for (let i = 0; i < n; i++) this.spawnGround(spId, players, i % 3 ? 60 : 25, 125);
    }
  }

  // A place to sit: in a ring minDist..maxDist round a hunter, or anywhere
  // within maxDist of `center` (a need zone) but no closer than minDist to
  // any hunter.
  groundSpot(spId, players, minDist, maxDist = 130, center = null) {
    for (let tries = 0; tries < 90; tries++) {
      const c = center || this.rnd.pick(players).pos;
      const a = this.rnd.float(0, Math.PI * 2);
      const r0 = center ? 0 : minDist;
      const r = r0 + Math.sqrt(this.rnd.next()) * (maxDist - r0);
      const x = c.x + Math.cos(a) * r;
      const z = c.z + Math.sin(a) * r;
      if (Math.hypot(x, z) > PLAY_RADIUS - 15) continue;
      if (players.some((p) => Math.hypot(p.pos.x - x, p.pos.z - z) < minDist)) continue;
      if (this.terrain.normal(x, z).y < 0.8) continue;
      if (!this.goodCover(spId, x, z)) continue;
      return { x, z };
    }
    return null;
  }

  // Quail sit out in the open stubble and grass; woodcock under the trees.
  goodCover(spId, x, z) {
    const m = this.terrain.maskAt(x, z);
    if (spId === 'quail') return m.forest <= 0.35 && m.snow <= 0.4;
    return m.forest >= 0.4 || this.veg.treesNear(x, z, 7).length > 0;
  }

  spawnGround(spId, players, minDist = 40, maxDist = 130, center = null) {
    const spot = this.groundSpot(spId, players, minDist, maxDist, center);
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

  makeGroup(spId, alt) {
    return {
      id: this.rnd.next(), spId, members: [], alt, perch: null, called: -99,
      path: [], dir: new THREE.Vector2(1, 0), panic: 0, spotted: -99, leftAt: -99,
      awareT: this.rnd.float(0, 0.3), perchUntil: 0,
      c: new THREE.Vector3(), v: new THREE.Vector2(), n: 0,
    };
  }

  spawnFlock(spId, players, opts = {}) {
    if (!players.length) return;
    const sp = SPECIES[spId];
    const p = this.rnd.pick(players).pos;
    // most passage flocks follow the day's migration heading; the rest are
    // local birds moving about
    let a = this.rnd.float(0, Math.PI * 2);
    if (sp.behaviour !== 'soar' && this.rnd.chance(0.65)) {
      const h = this.passageHeading + this.rnd.gauss() * 0.45;
      a = Math.atan2(Math.cos(h), -Math.sin(h)); // start up-track of the heading
    }
    const dir = new THREE.Vector2(Math.cos(a), Math.sin(a));
    const side = new THREE.Vector2(-dir.y, dir.x);
    // most flight lines pass within ~25 m of a hunter, a good few right overhead
    const lateral = opts.lateral ?? (sp.behaviour === 'soar' ? this.rnd.float(-150, 150) : this.rnd.gauss() * 18);
    const startD = opts.startD ?? (sp.behaviour === 'soar' ? 900 : 330);
    const start = new THREE.Vector2(p.x, p.z).addScaledVector(dir, startD).addScaledVector(side, lateral + this.rnd.float(-30, 30));
    const pass = new THREE.Vector2(p.x, p.z).addScaledVector(side, lateral);
    const end = new THREE.Vector2(p.x, p.z).addScaledVector(dir, -startD - 100).addScaledVector(side, lateral + this.rnd.float(-60, 60));
    let count = this.rnd.int(...(sp.flock || [1, 1]));
    let alt = opts.alt ?? this.passAlt(sp);
    // Snow buries the food on the tops and pushes fieldfare down in big,
    // hungry flocks that skim low over the junipers looking for berries.
    const snow = this.wx.snow;
    if (spId === 'fieldfare' && snow > 0) {
      count = Math.round(count * (1 + 0.9 * snow));
      alt = Math.max(sp.flight.alt[0] * 0.6, alt * (1 - 0.45 * snow));
    }
    const group = this.makeGroup(spId, alt);
    group.path = [new THREE.Vector3(pass.x, 0, pass.y), new THREE.Vector3(end.x, 0, end.y)];
    group.dir.set(-dir.x, -dir.y);
    // some flocks will drop into trees along the line
    if (sp.behaviour === 'flyover' && this.rnd.chance(opts.perchChance ?? 0.5)) {
      group.perch = this.pickPerchTrees(sp, pass.x, pass.y, 90, Math.ceil(count / 3));
    }
    const spread = (sp.flocking || DEFAULT_FLOCK).spread * 0.6;
    for (let i = 0; i < count; i++) {
      const b = this.create(spId);
      b.state = 'flying';
      b.group = group;
      b.model.root.visible = true;
      const ox = this.rnd.gauss() * spread;
      const oz = this.rnd.gauss() * spread;
      b.offY = this.rnd.gauss() * spread * 0.25;
      const sx = start.x + ox;
      const sz = start.y + oz;
      b.alt = alt + b.offY;
      b.pos.set(sx, this.ground(sx, sz) + b.alt, sz);
      b.heading.set(-dir.x, -dir.y);
      b.vel.set(-dir.x * sp.flight.speed, 0, -dir.y * sp.flight.speed);
      b.mode = 'cruise';
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

  // Height of a passing flock over the ground: low lines are the rule (most
  // of them under half the species' ceiling), the high ones the exception.
  passAlt(sp) {
    const [lo, hi] = sp.flight.alt;
    if (sp.behaviour === 'soar') return this.rnd.float(lo, hi);
    return lo * 0.85 + (hi - lo) * 0.7 * this.rnd.next() ** 1.7;
  }

  pickPerchTrees(sp, x, z, radius, n) {
    const near = this.veg.treesNear(x, z, radius).filter((t) => (sp.perchPrefer || []).includes(t.type));
    if (!near.length) return null;
    const out = [];
    for (let i = 0; i < n; i++) out.push(this.rnd.pick(near));
    return out;
  }

  // A spot on the outside of the crown, where a feeding bird can be seen: the
  // top of the tree, or out on the edge of it. The crown is taken as an
  // ellipsoid from its centre (crownY) up to the treetop.
  perchPoint(tr) {
    const a = this.rnd.float(0, Math.PI * 2);
    const narrow = tr.type === 'cedar' || tr.type === 'juniper' || tr.type === 'pine';
    const top = this.rnd.chance(0.6);
    const k = top ? this.rnd.float(0, narrow ? 0.3 : 0.5) : this.rnd.float(narrow ? 0.35 : 0.6, narrow ? 0.55 : 0.85);
    const r = k * tr.crownR;
    const semi = Math.max(0.5, tr.h - tr.crownY);
    const y = tr.y + Math.min(tr.h, tr.crownY + semi * Math.sqrt(Math.max(0, 1 - k * k)) * 0.97) + 0.03;
    return new THREE.Vector3(tr.x + Math.cos(a) * r, y, tr.z + Math.sin(a) * r);
  }

  flyoverRate(spId, hour) {
    // flocks per minute; the passage peaks in the first hours after dawn and
    // again in the last hour or two before sunset, with birds moving all day
    const w = this.weights[spId] || 0;
    if (!w) return 0;
    const dawn = Math.exp(-(((hour - 7.2) / 1.8) ** 2));
    const dusk = Math.exp(-(((hour - (this.sunset - 1)) / 1.2) ** 2)) * 0.8;
    const base = { fieldfare: 2.2, chaffinch: 2.0, turtleDove: 1.6, woodpigeon: 1.2 }[spId] || 3.0;
    return 1.6 * base * w * (0.6 + dawn + dusk) * this.passage * this.rainPassage;
  }

  // The first flock of the day comes by early and close, so the hunt starts
  // with something to look at.
  firstFlock(players, hour) {
    const list = ['songThrush', 'fieldfare', 'chaffinch', 'turtleDove', 'woodpigeon'].filter((s) => this.flyoverRate(s, hour) > 0);
    if (!list.length || !players.length) return;
    let total = 0;
    for (const s of list) total += this.flyoverRate(s, hour);
    let r = this.rnd.next() * total;
    const spId = list.find((s) => (r -= this.flyoverRate(s, hour)) <= 0) || list[0];
    const sp = SPECIES[spId];
    this.spawnFlock(spId, players, { startD: 210, lateral: this.rnd.float(8, 22) * (this.rnd.chance(0.5) ? 1 : -1), alt: sp.flight.alt[0] * this.rnd.float(0.9, 1.2), perchChance: 0.3 });
  }

  // ---------------- seeing and hearing the hunter ----------------

  // How a hunter shows and sounds, as two numbers 0..1 (the HUD's meters show
  // exactly these, so they tell the truth):
  //   vis   - how easily a bird picks him out: stance, movement, cover, fog.
  //           0.85 is a man walking in the open, seen at a species' full sight.
  //   noise - how far his footsteps carry: speed, what he walks on, and the
  //           wind and rain that cover them. 0.5 is walking on grass.
  // Call once a frame per hunter (it also notices him standing up suddenly).
  exposure(p) {
    let e = p._exp;
    if (!e) e = p._exp = { vis: 0, noise: 0, cover: false, surface: 'grass', stoodAt: -99, wasCrouch: false, at: null, t: -1 };
    if (e.t === this.time) return e;
    e.t = this.time;
    if (e.wasCrouch && !p.crouch) e.stoodAt = this.time;
    e.wasCrouch = p.crouch;
    // cover and footing only change as he moves
    if (!e.at || Math.hypot(e.at.x - p.pos.x, e.at.z - p.pos.z) > 0.8) {
      e.at = { x: p.pos.x, z: p.pos.z };
      e.cover = this.inCover(p);
      e.surface = this.surfaceAt(p.pos.x, p.pos.z);
    }
    const v = p.speed || 0;
    let vis = p.crouch ? 0.6 : 1;
    vis *= v < 0.3 ? 0.5 : v < 1.8 ? 0.7 : v > 4 ? 1.25 : 0.85;
    if (e.cover) vis *= 0.55;
    vis *= this.fogSight;
    // a hunter who stands up suddenly gives himself away
    if (this.time - e.stoodAt < 0.8) vis = Math.max(vis, 0.95);
    e.vis = clamp(vis, 0, 1);
    let n = v < 0.3 ? 0 : Math.min(1, v / 6.2) * (LOUD[e.surface] || 1);
    if (p.crouch) n *= 0.7; // a crouching hunter places his feet
    n *= (1 - 0.35 * Math.min(1, this.wind.length() / 9)) * (1 - 0.3 * this.wx.rain);
    e.noise = clamp(n, 0, 1);
    return e;
  }

  // What the ground underfoot is, for how loud it is to walk on.
  surfaceAt(x, z) {
    const t = this.terrain;
    const m = t.maskAt(x, z);
    if (m.snow > 0.45) return 'snow';
    if (t.road(x, z) < 2.2) return 'gravel';
    if (m.forest > 0.45) return 'leaves';
    if (m.terrace > 0.5 && t.normal(x, z, _n).y < 0.93) return 'stone';
    return m.field > 0.5 ? 'stubble' : 'grass';
  }

  eyeOf(p, out) {
    return out.set(p.pos.x, p.pos.y + (p.crouch ? 1.05 : 1.65), p.pos.z);
  }

  // Can a bird at `a` see a hunter's eye at `b`? Hills, trunks and the canopy
  // over the hunter block the view. `skip` is the tree the bird sits in.
  lineOfSight(a, b, skip = null) {
    const d = a.distanceTo(b);
    const n = clamp(Math.ceil(d / 8), 3, 18);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      if (this.terrain.height(x, z) > a.y + (b.y - a.y) * t - 0.2) return false;
    }
    if (this.veg.segmentBlocked(a, b)) return false;
    return !this.canopyBetween(a, b, skip);
  }

  // Does the line from a bird at `a` to the hunter at `b` pass through the
  // crown of a tree near the hunter?
  canopyBetween(a, b, skip) {
    const vx = a.x - b.x;
    const vz = a.z - b.z;
    const l2 = vx * vx + vz * vz || 1e-6;
    for (const t of this.veg.treesNear(b.x, b.z, 9)) {
      if (t === skip) continue;
      const k = clamp(((t.x - b.x) * vx + (t.z - b.z) * vz) / l2, 0, 1);
      const cx = b.x + vx * k;
      const cz = b.z + vz * k;
      const y = b.y + (a.y - b.y) * k;
      if (Math.hypot(t.x - cx, t.z - cz) < t.crownR * 0.85 && y > t.y + t.crownY - t.crownR * 0.5 && y < t.y + t.h + 0.3) return true;
    }
    return false;
  }

  // A hunter standing under or right against a tree is hard to pick out.
  inCover(p) {
    for (const t of this.veg.treesNear(p.pos.x, p.pos.z, 7)) {
      if (Math.hypot(t.x - p.pos.x, t.z - p.pos.z) < t.crownR * 0.9 + 0.5) return true;
    }
    return false;
  }

  // Flocks keep a lookout ahead and to the sides. Movement gives a hunter
  // away; standing still in cover hides him.
  groupAwareness(g, players) {
    const sp = SPECIES[g.spId];
    if (!sp.sight || this.time - g.spotted < 6) return;
    for (const p of players) {
      const dx = p.pos.x - g.c.x;
      const dz = p.pos.z - g.c.z;
      const dh = Math.hypot(dx, dz) || 1;
      const d = Math.hypot(dh, p.pos.y - g.c.y);
      if (d > sp.sight * 1.3) continue;
      let range = (sp.sight * this.exposure(p).vis) / 0.85;
      if ((dx * g.dir.x + dz * g.dir.y) / dh < -0.2) range *= 0.6; // behind the flock
      if (d > range) continue;
      if (!this.lineOfSight(g.c, this.eyeOf(p, _eye))) continue;
      this.spook(g, p.pos, false);
      return;
    }
  }

  // A flock that sees a hunter (or hears a shot) flares: it climbs, speeds up
  // and swerves wide. A shot also scatters it, and a big flock may split.
  spook(g, from, shot) {
    const sp = SPECIES[g.spId];
    g.spotted = this.time;
    g.panic = shot ? 2.5 : 1.2;
    const away = new THREE.Vector2(g.c.x - from.x, g.c.z - from.z);
    if (away.lengthSq() < 1e-6) away.copy(g.dir);
    away.normalize();
    const fwd = g.dir.clone();
    const nd = fwd.clone().addScaledVector(away, shot ? 1.1 : 0.7).normalize();
    g.path = [
      new THREE.Vector3(g.c.x + nd.x * 120, 0, g.c.z + nd.y * 120),
      new THREE.Vector3(g.c.x + (nd.x + fwd.x) * 300, 0, g.c.z + (nd.y + fwd.y) * 300),
    ];
    g.alt = Math.min(g.alt + (shot ? 10 : 6), sp.flight.alt[1] + 15);
    let lead = null;
    for (const m of g.members) {
      if (!this.birds.has(m.id) || m.state !== 'flying' || m.mode !== 'cruise') continue;
      lead = lead || m;
      m.flare = shot ? 3.5 : 2;
      m.alt = g.alt + m.offY;
      if (shot) m.scatter.copy(away).rotateAround(ZERO2, this.rnd.float(-1.3, 1.3)).multiplyScalar(this.rnd.float(0.8, 2.2));
    }
    if (lead && sp.call !== 'none') audio.play(sp.call, lead.pos, { gain: 0.7, ref: 8 });
    if (shot && g.n >= 4 && this.rnd.chance(0.55)) this.split(g);
  }

  // Split a scattered flock across its line of flight; the halves peel away
  // to either side and each reforms on its own.
  split(g) {
    const live = g.members.filter((m) => this.birds.has(m.id) && m.state === 'flying' && m.mode === 'cruise');
    if (live.length < 4) return;
    const side = new THREE.Vector3(-g.dir.y, 0, g.dir.x);
    const ng = this.makeGroup(g.spId, g.alt);
    ng.spotted = g.spotted;
    ng.panic = g.panic;
    ng.dir.copy(g.dir);
    for (const m of live) {
      if ((m.pos.x - g.c.x) * side.x + (m.pos.z - g.c.z) * side.z > 0) {
        ng.members.push(m);
        m.group = ng;
      }
    }
    if (!ng.members.length || ng.members.length === live.length) {
      for (const m of ng.members) m.group = g;
      return;
    }
    g.members = g.members.filter((m) => m.group === g);
    ng.path = g.path.map((p) => p.clone().addScaledVector(side, 30));
    g.path = g.path.map((p) => p.clone().addScaledVector(side, -30));
    this.groups.push(ng);
  }

  // Once the panic is over, parts of a scattered flock that find each other
  // again join up.
  mergeGroups() {
    for (const a of this.groups) {
      if (!a.n || a.panic > 0 || a.spId === 'stork') continue;
      for (const b of this.groups) {
        if (b === a || b.spId !== a.spId || !b.n || b.panic > 0 || b.n > a.n) continue;
        const spread = (SPECIES[a.spId].flocking || DEFAULT_FLOCK).spread;
        if (a.c.distanceTo(b.c) > spread * 2.5 + 10 || a.dir.dot(b.dir) < 0.7) continue;
        for (const m of b.members) {
          if (!this.birds.has(m.id)) continue;
          m.group = a;
          a.members.push(m);
          if (m.mode === 'cruise') m.alt = a.alt + m.offY;
        }
        b.members = [];
        b.n = 0;
      }
    }
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
    if (this.firstFlockAt >= 0 && this.time > this.firstFlockAt) {
      this.firstFlockAt = -1;
      this.firstFlock(players, hour);
    }
    this.flyoverTimer -= dt;
    if (this.flyoverTimer <= 0) {
      this.flyoverTimer = 1;
      let flyCount = 0;
      for (const b of this.birds.values()) if (b.state === 'flying' && b.sp.behaviour !== 'ground') flyCount++;
      for (const spId of ['songThrush', 'fieldfare', 'chaffinch', 'turtleDove', 'woodpigeon']) {
        const perSec = this.flyoverRate(spId, hour) / 60;
        if (flyCount < 80 && this.rnd.chance(perSec)) this.spawnFlock(spId, players);
      }
    }
    this.groundTimer -= dt;
    if (this.groundTimer <= 0) {
      this.groundTimer = 4;
      for (const spId of ['quail', 'woodcock']) {
        const target = this.groundTarget(spId) * Math.max(1, players.length * 0.7);
        if (!target) continue;
        let n = 0;
        for (const b of [...this.birds.values()]) {
          if (b.spId !== spId || b.state !== 'hidden') continue;
          const far = players.every((p) => Math.hypot(p.pos.x - b.pos.x, p.pos.z - b.pos.z) > 220);
          if (far && !b.zone) this.remove(b); // the hunters have moved on
          else n++;
        }
        if (n < target) this.spawnGround(spId, players, 60, 125);
        if (n < target - 3) this.spawnGround(spId, players, 60, 125);
      }
    }
    if (this.weights.stork) {
      this.storkTimer -= dt;
      if (this.storkTimer <= 0) {
        this.storkTimer = 200 + this.rnd.float(0, 200);
        this.spawnFlock('stork', players);
      }
    }

    // how each hunter shows and sounds this frame (and whether he just stood up)
    for (const p of players) this.exposure(p);

    for (const g of this.groups) this.updateGroup(g, dt, players);
    this.mergeT = (this.mergeT || 0) - dt;
    if (this.mergeT <= 0) {
      this.mergeT = 1;
      this.mergeGroups();
    }

    this.decoyPull(dt, players);
    for (const b of [...this.birds.values()]) {
      b.t += dt;
      switch (b.state) {
        case 'hidden':
          this.updateHidden(b, players);
          break;
        case 'running':
          this.updateRunning(b, dt, players);
          break;
        case 'flying':
          this.updateFlying(b, dt);
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

  groupStats(g) {
    let n = 0;
    let cx = 0, cy = 0, cz = 0, vx = 0, vz = 0;
    for (const m of g.members) {
      if (m.state !== 'flying' || m.mode !== 'cruise' || !this.birds.has(m.id)) continue;
      n++;
      cx += m.pos.x;
      cy += m.pos.y;
      cz += m.pos.z;
      vx += m.vel.x;
      vz += m.vel.z;
    }
    g.n = n;
    if (n) {
      g.c.set(cx / n, cy / n, cz / n);
      g.v.set(vx / n, vz / n);
    }
  }

  updateGroup(g, dt, players) {
    this.groupStats(g);
    g.panic = Math.max(0, g.panic - dt);
    if (g.n) {
      if (g.v.lengthSq() > 0.01) g.dir.copy(g.v).normalize();
      // move along the flight line once the flock reaches (or passes) a point
      const wp = g.path[0];
      if (wp) {
        const dx = wp.x - g.c.x;
        const dz = wp.z - g.c.z;
        if (Math.hypot(dx, dz) < 15 || dx * g.dir.x + dz * g.dir.y < 0) g.path.shift();
      }
      g.awareT -= dt;
      if (g.awareT <= 0) {
        g.awareT = 0.3;
        this.groupAwareness(g, players);
      }
    }
    // a flock feeding in the trees moves on together
    if (g.perchUntil && this.time > g.perchUntil) {
      g.perchUntil = 0;
      this.groupTakeOff(g, null, null);
    }
  }

  // ---------------- ground birds ----------------

  updateHidden(b, players) {
    let nearest = Infinity;
    for (const p of players) {
      const d = Math.hypot(p.pos.x - b.pos.x, p.pos.z - b.pos.z);
      nearest = Math.min(nearest, d);
      if (d > b.flushDist * 4) continue;
      // a sitting bird goes when a hunter it can hear (and see) gets close;
      // birds are wilder on a windy day, sit tighter in the rain
      const e = this.exposure(p);
      const k = (0.6 + 0.25 * e.vis + 0.45 * e.noise) * (p.crouch ? 0.9 : 1) * (1 + 0.3 * Math.min(1, this.wind.length() / 9)) * this.rainSitTight;
      if (d < b.flushDist * k) {
        this.flush(b, p.pos);
        return;
      }
      // a quail hearing someone coming often runs off before it flies
      if (b.sp.run && !b.runRolled && b.runs < 2 && e.noise > 0.05 && d < b.flushDist * (1.2 + 2.4 * e.noise)) {
        b.runRolled = true;
        if (this.rnd.chance(b.sp.run)) {
          this.startRun(b, p.pos);
          return;
        }
      }
    }
    // once the hunters have moved off it may run again next time
    if (nearest > b.flushDist * 3.5) b.runRolled = false;
  }

  startRun(b, from) {
    b.state = 'running';
    b.t = 0;
    b.runs++;
    const away = new THREE.Vector2(b.pos.x - from.x, b.pos.z - from.z);
    if (away.lengthSq() < 1e-6) away.set(1, 0);
    away.normalize().rotateAround(ZERO2, this.rnd.float(-0.8, 0.8));
    b.heading.copy(away);
    b.runLeft = this.rnd.float(3, 9);
    b.runSpeed = this.rnd.float(1.6, 2.6);
    b.zig = this.rnd.float(0, 6);
    b.model.root.visible = true;
    audio.play('run', b.pos, { gain: 0.4, ref: 3 });
  }

  updateRunning(b, dt, players) {
    for (const p of players) {
      if (Math.hypot(p.pos.x - b.pos.x, p.pos.z - b.pos.z) < b.flushDist * 1.1) {
        this.flush(b, p.pos);
        return;
      }
    }
    const step = b.runSpeed * dt;
    b.runLeft -= step;
    b.heading.rotateAround(ZERO2, Math.sin(b.t * 3 + b.zig) * dt * 0.9);
    const nx = b.pos.x + b.heading.x * step;
    const nz = b.pos.z + b.heading.y * step;
    if (Math.hypot(nx, nz) > PLAY_RADIUS - 12) b.runLeft = 0;
    b.pos.set(nx, this.ground(nx, nz) + 0.05, nz);
    b.vel.set(b.heading.x * b.runSpeed, 0, b.heading.y * b.runSpeed);
    if (b.runLeft <= 0) {
      // squats down again, sitting a bit tighter now
      b.state = 'hidden';
      b.t = 0;
      b.runRolled = false;
      b.flushDist *= 0.9;
      b.pos.y = this.ground(nx, nz) + 0.08;
      b.vel.set(0, 0, 0);
      b.model.root.visible = false;
    }
  }

  flush(b, from) {
    const sp = b.sp;
    b.state = 'flying';
    b.t = 0;
    b.mode = 'flush';
    b.model.root.visible = true;
    // away from the hunter, with a random slant
    const away = new THREE.Vector2(b.pos.x - from.x, b.pos.z - from.z);
    if (away.lengthSq() < 1e-6) away.set(1, 0);
    away.normalize().rotateAround(ZERO2, this.rnd.float(-1.1, 1.1));
    // game birds like to get up into the wind, as long as that isn't back over the hunter
    const ws = Math.hypot(this.wind.x, this.wind.z);
    if (ws > 1.5) {
      const into = new THREE.Vector2(-this.wind.x / ws, -this.wind.z / ws);
      const bent = away.clone().addScaledVector(into, 0.7 * Math.min(1, ws / 6)).normalize();
      const fromHunter = new THREE.Vector2(b.pos.x - from.x, b.pos.z - from.z).normalize();
      if (bent.dot(fromHunter) > 0.15) away.copy(bent);
    }
    b.heading.copy(away);
    b.baseDir.copy(away);
    b.alt = this.rnd.float(...sp.flight.alt);
    b.range = this.rnd.float(...sp.flight.range);
    b.traveled = 0;
    b.landTries = 0;
    b.takeoffDur = b.takeoff = sp.takeoff ? sp.takeoff.dur : 0.5;
    b.vel.set(away.x * 2, sp.takeoff ? sp.takeoff.vy : 4.5, away.y * 2);
    b.zig = this.rnd.float(0, 6);
    b.jinkT = 0.25;
    b.jink = 0;
    audio.play(sp.flight.style === 'zigzag' ? 'clatter' : 'whirr', b.pos, { gain: 1.3, ref: 6 });
    if (sp.call === 'quail' && this.rnd.chance(0.3)) audio.play('quail', b.pos, { gain: 0.5, ref: 6, delay: 0.4 });
    this.emit('flush', { id: b.id, spId: b.spId });
  }

  // Woodcock dodge the trunks ahead: steer round any tree in the way.
  avoidTrunks(b, dt, desired) {
    b.treeT -= dt;
    if (b.treeT <= 0 || !b.treeCache) {
      b.treeT = 0.15;
      b.treeCache = this.veg.treesNear(b.pos.x + b.heading.x * 5, b.pos.z + b.heading.y * 5, 9);
    }
    const hx = b.heading.x;
    const hz = b.heading.y;
    let push = 0;
    for (const t of b.treeCache) {
      if (b.pos.y > t.y + t.h) continue;
      const dx = t.x - b.pos.x;
      const dz = t.z - b.pos.z;
      const ahead = dx * hx + dz * hz;
      const lat = -dx * hz + dz * hx; // > 0: tree off to the left
      // never pass through a trunk
      const hd = Math.hypot(dx, dz);
      if (hd < t.r + 0.25 && b.pos.y < t.y + t.crownY) {
        b.pos.x = t.x - (dx / (hd || 1)) * (t.r + 0.25);
        b.pos.z = t.z - (dz / (hd || 1)) * (t.r + 0.25);
      }
      if (ahead < 0 || ahead > 9) continue;
      const clear = t.r + 1.2 + (b.pos.y > t.y + t.crownY - t.crownR * 0.5 ? t.crownR * 0.4 : 0);
      if (Math.abs(lat) > clear) continue;
      push -= Math.sign(lat || 1) * (1 - ahead / 9) * 2.5;
    }
    if (push) {
      desired.x += -hz * push;
      desired.y += hx * push;
    }
  }

  // ---------------- flying ----------------

  // Boids: steer for the flock's flight line while keeping spacing (separation),
  // matching the others' heading (alignment) and staying with them (cohesion).
  flockSteer(b, g, out) {
    const P = b.sp.flocking || DEFAULT_FLOCK;
    const wp = g.path[0];
    if (wp) out.set(wp.x - b.pos.x, wp.z - b.pos.z).normalize();
    else out.copy(g.dir);
    if (g.n > 1) {
      // flocks breathe: they bunch up and stretch out as they go
      const spread = P.spread * (1 + 0.3 * Math.sin(this.time * 0.35 + g.id * 20));
      const coh = P.coh * (g.panic > 0 ? 0.25 : 1);
      const cx = g.c.x - b.pos.x;
      const cz = g.c.z - b.pos.z;
      const cd = Math.hypot(cx, cz);
      if (cd > spread * 0.4) {
        const k = (Math.min(1.5, (cd - spread * 0.4) / spread) * coh) / cd;
        out.x += cx * k;
        out.y += cz * k;
      }
      const vl = g.v.length();
      if (vl > 0.1) {
        out.x += (g.v.x / vl) * P.ali;
        out.y += (g.v.y / vl) * P.ali;
      }
      let sx = 0;
      let sz = 0;
      const s2 = P.sep * P.sep;
      for (const m of g.members) {
        if (m === b || m.state !== 'flying') continue;
        const dx = b.pos.x - m.pos.x;
        const dy = b.pos.y - m.pos.y;
        const dz = b.pos.z - m.pos.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > s2 || d2 < 1e-6) continue;
        const d = Math.sqrt(d2);
        const k = (1 - d / P.sep) / d;
        sx += dx * k;
        sz += dz * k;
      }
      out.x += sx * 1.6;
      out.y += sz * 1.6;
      return spread;
    }
    return P.spread;
  }

  updateFlying(b, dt) {
    const sp = b.sp;
    const f = sp.flight;
    const g = b.group;
    let speed = f.speed * b.speedMul;
    b.flare = Math.max(0, b.flare - dt);
    if (b.flare > 0) speed *= 1.3;
    if (b.wound) speed *= b.wound.speedMul;
    b.scatter.multiplyScalar(Math.max(0, 1 - dt * 0.7));
    let targetAlt = b.alt;
    let turnRate = f.style === 'zigzag' ? 3.5 : f.style === 'soar' ? 0.6 : 1.4;
    let maxUp = 4;
    const desired = _d2.set(0, 0);
    b.flaring = false;

    // take-off: a jump and a few hard wingbeats before the bird gets up to speed
    if (b.takeoff > 0) {
      b.takeoff -= dt;
      speed *= 0.35 + 0.65 * (1 - Math.max(0, b.takeoff) / b.takeoffDur);
      maxUp = f.style === 'zigzag' ? 5 : 7;
    }

    switch (b.mode) {
      case 'soar': {
        b.circleC.addScaledVector(b.drift, dt);
        b.circleA += (dt * f.speed) / b.circleR;
        const tx = b.circleC.x + Math.cos(b.circleA) * b.circleR;
        const tz = b.circleC.y + Math.sin(b.circleA) * b.circleR;
        desired.set(tx - b.pos.x, tz - b.pos.z);
        targetAlt = b.alt + Math.sin(b.circleA * 0.5) * 8;
        if (b.circleC.length() > 2500) return this.remove(b);
        break;
      }
      case 'flush':
      case 'landing': {
        b.traveled += speed * dt;
        if (b.mode === 'flush' && b.traveled > b.range) b.mode = 'landing';
        desired.copy(b.baseDir);
        if (f.style === 'zigzag') {
          // woodcock: twists and jinks between the trunks
          b.jinkT -= dt;
          if (b.jinkT <= 0) {
            b.jinkT = this.rnd.float(0.3, 0.85);
            b.jink = this.rnd.float(-0.9, 0.9);
          }
          desired.rotateAround(ZERO2, b.jink);
          this.avoidTrunks(b, dt, desired);
        } else if (b.t > 0.8) {
          desired.rotateAround(ZERO2, Math.sin(b.t * 0.9 + b.zig) * 0.15);
        }
        if (b.mode === 'landing') {
          const agl = b.pos.y - this.ground(b.pos.x, b.pos.z);
          targetAlt = -1;
          speed *= agl < 2 ? 0.5 : 0.8;
          b.flaring = agl < 1.8;
        } else if (b.t < 1.0) {
          targetAlt = b.alt;
        }
        break;
      }
      case 'cruise': {
        if (g) {
          const spread = this.flockSteer(b, g, desired);
          desired.add(b.scatter);
          // birds ahead of the flock ease off, stragglers catch up
          if (g.n > 1) {
            const ahead = (b.pos.x - g.c.x) * g.dir.x + (b.pos.z - g.c.z) * g.dir.y;
            speed *= 1 + clamp((-ahead / spread) * 0.3, -0.2, 0.25);
          }
          if (g.panic > 0) turnRate = 2.6;
          if (!g.path.length && Math.hypot(b.pos.x, b.pos.z) > PLAY_RADIUS + 320) return this.remove(b);
        } else {
          desired.copy(b.heading);
          if (Math.hypot(b.pos.x, b.pos.z) > PLAY_RADIUS + 320) return this.remove(b);
        }
        targetAlt = Math.max(targetAlt, this.canopyAhead(b, dt) + 2.5);
        break;
      }
      case 'toPerch': {
        const wp = b.waypoints[0];
        desired.set(wp.x - b.pos.x, wp.z - b.pos.z);
        const d = desired.length();
        const gy = wp.y;
        targetAlt = null;
        const ty = d > 40 ? Math.max(gy + 6, this.ground(b.pos.x, b.pos.z) + b.alt * 0.6) : gy + Math.min(6, d * 0.15);
        b.vel.y += clamp((ty - b.pos.y) * 1.5 - b.vel.y, -6, 6) * dt * 2;
        if (d < 18) speed *= Math.max(0.3, d / 18);
        b.flaring = d < 7;
        if (d < 18) turnRate = 2.5;
        if (d < 1.2 && Math.abs(b.pos.y - gy) < 1.5) {
          this.perch(b, wp);
          return;
        }
        break;
      }
      case 'tower': {
        // shot through the lungs: climbs straight up, then falls dead
        desired.copy(b.heading);
        speed *= 0.35;
        targetAlt = null;
        b.vel.y += (7.5 - b.vel.y) * Math.min(1, dt * 3);
        b.wound.t2 += dt;
        if (b.pos.y > b.wound.top || b.wound.t2 > 4.5) {
          this.kill(b, b.owner, new THREE.Vector3(0, 0.5, 0));
          return;
        }
        break;
      }
      case 'glideDown': {
        // sets its wings and glides down a long way off, into cover
        desired.copy(b.heading).rotateAround(ZERO2, b.wound.curve * dt);
        speed *= 0.85;
        targetAlt = null;
        const agl = b.pos.y - this.ground(b.pos.x, b.pos.z);
        const remain = Math.max(10, b.wound.dist - b.wound.traveled);
        const sink = clamp((agl * speed) / remain, 0.6, 4);
        b.vel.y += (-sink - b.vel.y) * Math.min(1, dt * 2);
        b.wound.traveled += speed * dt;
        b.flaring = agl < 1.5;
        break;
      }
      default: {
        // 'leave': a lone bird flying off
        desired.copy(b.heading);
        targetAlt = Math.max(targetAlt, this.canopyAhead(b, dt) + 2.5);
        if (Math.hypot(b.pos.x, b.pos.z) > PLAY_RADIUS + 320) return this.remove(b);
      }
    }
    if (b.flaring) speed *= 0.7;

    // steering in the horizontal plane
    if (desired.lengthSq() > 1e-6) {
      desired.normalize();
      const cur = Math.atan2(b.heading.y, b.heading.x);
      let diff = Math.atan2(desired.y, desired.x) - cur;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const turn = clamp(diff, -turnRate * dt, turnRate * dt);
      b.turn = turn / dt;
      b.heading.set(Math.cos(cur + turn), Math.sin(cur + turn));
    }
    let hx = b.heading.x * speed;
    let hz = b.heading.y * speed;
    if (f.style === 'zigzag' && b.mode === 'flush') {
      const z = Math.sin(b.t * 5.5 + b.zig) * 2.2;
      hx += -b.heading.y * z;
      hz += b.heading.x * z;
    }
    const gnd = this.ground(b.pos.x + hx * 0.5, b.pos.z + hz * 0.5);
    if (targetAlt !== null) {
      const ty = gnd + targetAlt;
      let vy = clamp((ty - b.pos.y) * 1.2, -5, maxUp);
      if (f.style === 'bounding' && b.takeoff <= 0) vy += Math.cos(b.t * Math.PI * 2 * 1.3) * 1.4;
      if (f.style === 'direct') vy += Math.sin(b.t * 2.1) * 0.4;
      b.vel.y += (vy - b.vel.y) * Math.min(1, dt * (b.takeoff > 0 ? 1.5 : 3));
    }
    b.vel.x = hx;
    b.vel.z = hz;
    b.pos.addScaledVector(b.vel, dt);
    const minY = this.ground(b.pos.x, b.pos.z) + 0.4;
    if (b.pos.y < minY) {
      if (b.mode === 'glideDown' || (b.mode === 'landing' && b.wound && b.wound.fatal)) {
        this.dieOnGround(b);
        return;
      }
      if (b.mode === 'landing') {
        if (Math.hypot(b.pos.x, b.pos.z) > PLAY_RADIUS - 10) return this.remove(b);
        // drop back into cover, if this is cover; otherwise go on a little
        if (!this.goodCover(b.spId, b.pos.x, b.pos.z) && b.landTries < 2) {
          b.landTries++;
          b.mode = 'flush';
          b.range = b.traveled + 30;
          b.pos.y = minY;
          b.vel.y = 2.5;
          return;
        }
        b.state = 'hidden';
        b.pos.y = minY - 0.3;
        b.flushDist = this.rnd.float(...b.sp.flushDist) * 1.15; // a little warier now
        b.runRolled = false;
        b.wound = null;
        b.flags = 0;
        b.model.root.visible = false;
        b.t = 0;
        audio.play('land', b.pos, { gain: 0.35, ref: 3 });
        return;
      }
      b.pos.y = minY;
      b.vel.y = Math.max(0, b.vel.y);
    }

    // hit birds that fly on: some drop later, some get away
    if (b.wound && b.wound.type === 'flyOn') {
      b.wound.t -= dt;
      if (b.wound.t <= 0) {
        if (b.wound.fatal) {
          this.kill(b, b.owner, new THREE.Vector3());
          return;
        }
        b.wound = null;
        b.flags &= ~F_WOUNDED;
      }
    }

    // calls
    b.lastCall -= dt;
    if (b.lastCall <= 0) {
      b.lastCall = this.callInterval(b) * (g && g.panic > 0 ? 0.4 : 1);
      const c = b.sp.call;
      if (c !== 'none' && c !== 'quail' && c !== 'woodcock') audio.play(c, b.pos, { gain: 0.55, ref: 8, rate: 0.95 + Math.random() * 0.1 });
    }
  }

  // How high the treetops ahead stand over the ground here: low flight lines
  // skim over the crowns rather than through them.
  canopyAhead(b, dt) {
    b.canT = (b.canT || 0) - dt;
    if (b.canT <= 0) {
      b.canT = 0.3;
      let top = -Infinity;
      for (const t of this.veg.treesNear(b.pos.x + b.heading.x * 8, b.pos.z + b.heading.y * 8, 9)) top = Math.max(top, t.y + t.h);
      b.canopy = top > -Infinity ? top - this.ground(b.pos.x, b.pos.z) : 0;
    }
    return b.canopy;
  }

  callInterval(b) {
    switch (b.sp.call) {
      case 'chack':
        return 1.2 + Math.random() * 2.5;
      case 'tsip':
        return 2 + Math.random() * 5;
      case 'pink':
        return 1.5 + Math.random() * 3;
      case 'purr':
      case 'coo':
        // doves and pigeons are quiet in flight; they call from the trees
        return b.state === 'perched' ? 4 + Math.random() * 9 : 99;
      default:
        return 99;
    }
  }

  // ---------------- perched ----------------

  perch(b, wp) {
    b.state = 'perched';
    b.t = 0;
    b.pos.copy(wp);
    b.vel.set(0, 0, 0);
    b.yaw = Math.atan2(b.heading.x, b.heading.y) + this.rnd.float(-0.8, 0.8);
    b.pitch = -0.3;
    b.roll = 0;
    b.alarm = { songThrush: 24, fieldfare: 32, chaffinch: 16, turtleDove: 28, woodpigeon: 40 }[b.spId] || 20;
    b.act = 'look';
    b.actT = this.rnd.float(1, 3);
    b.hop = null;
    b.pendingTakeoff = -1;
    const g = b.group;
    if (g && !g.perchUntil) g.perchUntil = this.time + this.rnd.float(25, 90);
    audio.play('land', b.pos, { gain: 0.3, ref: 3 });
  }

  // Is a hunter close enough, and visible enough, to put this bird up?
  perchThreat(b, players) {
    for (const p of players) {
      const eye = this.eyeOf(p, _eye);
      const d = eye.distanceTo(b.pos);
      if (d > b.alarm * 1.5) continue;
      const e = this.exposure(p);
      // footsteps it hears close by, in sight or not
      if (d < b.alarm * 0.7 * e.noise) return p.pos;
      // and a hunter it can see, out to its alarm distance
      if (d > (b.alarm * e.vis) / 0.85 || !this.lineOfSight(b.pos, eye, b.perchTree)) continue;
      return p.pos;
    }
    return null;
  }

  updatePerched(b, dt, players) {
    if (b.pendingTakeoff >= 0) {
      b.pendingTakeoff -= dt;
      if (b.pendingTakeoff < 0) this.takeOff(b, b.threat);
      return;
    }
    b.awareT -= dt;
    if (b.awareT <= 0) {
      b.awareT = 0.25;
      const threat = this.perchThreat(b, players);
      if (threat) {
        this.groupTakeOff(b.group, threat, b);
        return;
      }
    }
    // hop about the crown, feed, look round, preen
    if (b.hop) {
      const H = b.hop;
      H.t += dt;
      const k = Math.min(1, H.t / H.dur);
      b.pos.lerpVectors(H.from, H.to, k);
      b.pos.y += Math.sin(k * Math.PI) * 0.25;
      if (k >= 1) b.hop = null;
    } else {
      b.actT -= dt;
      if (b.actT <= 0) this.nextPerchAct(b);
    }
    b.lastCall -= dt;
    if (b.lastCall <= 0) {
      b.lastCall = this.callInterval(b) * 2;
      if (b.sp.call !== 'none') audio.play(b.sp.call, b.pos, { gain: 0.4, ref: 6 });
    }
  }

  nextPerchAct(b) {
    const r = this.rnd.next();
    if (r < 0.22 && b.perchTree) {
      const to = this.perchPoint(b.perchTree);
      to.sub(b.pos).clampLength(0, 1.4).add(b.pos);
      b.hop = { from: b.pos.clone(), to, t: 0, dur: 0.35 };
      b.yaw = Math.atan2(to.x - b.pos.x, to.z - b.pos.z);
      b.act = 'hop';
      b.actT = 0.2;
      if (this.rnd.chance(0.4)) audio.play('flutter', b.pos, { gain: 0.3, ref: 3 });
    } else if (r < 0.55) {
      b.act = 'peck';
      b.actT = this.rnd.float(1.5, 4);
    } else if (r < 0.67) {
      b.act = 'preen';
      b.actT = this.rnd.float(2, 5);
    } else {
      b.act = 'look';
      b.actT = this.rnd.float(2, 6);
      b.yaw += this.rnd.float(-0.8, 0.8);
    }
  }

  // The whole flock in the trees goes up, the alarmed bird first, the others a
  // beat later.
  groupTakeOff(g, threat, first) {
    const list = g ? g.members.filter((m) => this.birds.has(m.id) && m.state === 'perched' && m.pendingTakeoff < 0) : [];
    if (first && !list.includes(first)) list.push(first);
    if (!list.length) return;
    const origin = first || list[0];
    for (const m of list) {
      m.pendingTakeoff = m === first ? 0 : this.rnd.float(0.05, 0.3) + m.pos.distanceTo(origin.pos) * 0.02;
      m.threat = threat;
    }
    if (list.length > 3) audio.play('flockFlush', origin.pos, { gain: 0.9, ref: 8 });
    if (g) {
      g.perchUntil = 0;
      // stragglers still on their way into the trees go with them
      for (const m of g.members) {
        if (m.state !== 'flying' || m.mode !== 'toPerch') continue;
        m.mode = 'cruise';
        m.alt = g.alt + m.offY;
      }
    }
  }

  takeOff(b, threat) {
    const sp = b.sp;
    b.state = 'flying';
    b.t = 0;
    b.pendingTakeoff = -1;
    b.hop = null;
    const g = b.group;
    let dir;
    if (threat) dir = new THREE.Vector2(b.pos.x - threat.x, b.pos.z - threat.z);
    else if (g) dir = g.dir.clone();
    else dir = b.heading.clone();
    if (dir.lengthSq() < 1e-6) dir.set(1, 0);
    dir.normalize();
    if (g) {
      b.mode = 'cruise';
      // one fresh flight line for the whole flock, leading away
      if (this.time - g.leftAt > 2) {
        g.leftAt = this.time;
        g.dir.copy(dir);
        g.path = [new THREE.Vector3(b.pos.x + dir.x * 80, 0, b.pos.z + dir.y * 80), new THREE.Vector3(b.pos.x + dir.x * 500, 0, b.pos.z + dir.y * 500)];
        g.alt = this.rnd.float(...sp.flight.alt);
        if (threat) {
          g.spotted = this.time;
          g.panic = 1.5;
        }
      }
      b.alt = g.alt + b.offY;
    } else {
      b.mode = 'leave';
      b.alt = this.rnd.float(...sp.flight.alt);
    }
    dir.rotateAround(ZERO2, this.rnd.float(-0.5, 0.5));
    b.heading.copy(dir);
    b.takeoffDur = b.takeoff = sp.takeoff ? sp.takeoff.dur : 0.5;
    b.vel.set(dir.x * 2, sp.takeoff ? sp.takeoff.vy : 3, dir.y * 2);
    // woodpigeons clap their wings loudly as they clatter out of a tree
    if (!g || g.members.length < 4 || this.rnd.chance(0.35)) audio.play(sp.id === 'woodpigeon' ? 'wingClap' : 'flap', b.pos, { gain: sp.id === 'woodpigeon' ? 1 : 0.6, ref: 6 });
  }

  // ---------------- falling & dead ----------------

  updateFalling(b, dt) {
    b.vel.y -= 9.81 * dt;
    b.vel.multiplyScalar(1 - 0.6 * dt);
    b.pos.addScaledVector(b.vel, dt);
    b.yaw += b.spin.y * dt;
    b.pitch += b.spin.x * dt;
    b.roll += b.spin.z * dt;
    const g = this.ground(b.pos.x, b.pos.z) + 0.05;
    if (b.pos.y <= g) this.lieDead(b, g);
  }

  lieDead(b, gy) {
    b.pos.y = gy;
    b.state = 'dead';
    b.t = 0;
    b.vel.set(0, 0, 0);
    b.pitch = 0;
    b.roll = (Math.PI / 2) * (Math.random() < 0.5 ? 1 : -1) * 0.8;
    // a few feathers left where it came down
    this.feathers.burst(b.pos, b.spId, 3, true);
    audio.play('thud', b.pos, { gain: 0.5, ref: 3 });
    this.emit('landed', { id: b.id });
  }

  // A wounded bird that glides down dies where it lands.
  dieOnGround(b) {
    const by = b.owner;
    b.wound = null;
    b.flags = 0;
    this.lieDead(b, this.ground(b.pos.x, b.pos.z) + 0.05);
    this.feathers.burst(b.pos, b.spId, 3, true);
    this.emit('kill', { id: b.id, by, spId: b.spId, pos: b.pos.clone() });
  }

  // ---------------- interactions ----------------

  gunshot(pos, shooterId) {
    if (!this.authority) return;
    for (const b of this.birds.values()) {
      const d = b.pos.distanceTo(pos);
      if (b.state === 'perched' && d < 75) {
        if (b.pendingTakeoff < 0) this.groupTakeOff(b.group, pos, b);
      } else if (b.state === 'hidden' && b.sp.flight.style === 'whirr' && d < 22 && this.rnd.chance(0.5)) this.flush(b, pos);
      else if (b.state === 'running' && d < 35) this.flush(b, pos);
    }
    for (const g of this.groups) {
      if (g.spId === 'stork') continue;
      // birds on their way into the trees abandon it and rejoin the flock
      let near = false;
      for (const m of g.members) {
        if (!this.birds.has(m.id) || m.state !== 'flying' || m.pos.distanceTo(pos) > 110) continue;
        if (m.mode === 'cruise') near = true;
        else if (m.mode === 'toPerch') {
          m.mode = 'cruise';
          m.alt = g.alt + m.offY;
          near = true;
        }
      }
      if (!near) continue;
      this.groupStats(g);
      if (g.n) this.spook(g, pos, true);
    }
  }

  // Decoys set out by a hunter: { pos, spId }. Passing flocks of the same
  // kind (or close cousins: thrush with thrush, doves with pigeons) may
  // swing in and pass low over them, or drop into trees close by.
  setDecoys(list) {
    this.decoys = list;
  }

  decoyPull(dt, players) {
    if (!this.decoys || !this.decoys.length) return;
    this.decoyT = (this.decoyT || 0) - dt;
    if (this.decoyT > 0) return;
    this.decoyT = 1;
    const FAMILY = { songThrush: 'thrush', fieldfare: 'thrush', turtleDove: 'dove', woodpigeon: 'dove', chaffinch: 'finch' };
    const kin = (a, b) => a === b || (FAMILY[a] && FAMILY[a] === FAMILY[b]);
    for (const g of this.groups) {
      if (g.decoyed) continue;
      const lead = g.members.find((m) => this.birds.has(m.id) && m.state === 'flying');
      if (!lead || lead.sp.behaviour !== 'flyover') continue;
      const d = this.decoys.find((x) => kin(x.spId, lead.spId) && lead.pos.distanceTo(x.pos) < 220);
      if (!d) continue;
      g.decoyed = true;
      // a hunter moving in the open near the decoys gives the game away
      const busted = players.some((p) => p.speed > 1 && Math.hypot(p.pos.x - d.pos.x, p.pos.z - d.pos.z) < 25);
      if (busted || !this.rnd.chance(lead.spId === 'woodpigeon' || lead.spId === 'turtleDove' ? 0.6 : 0.45)) continue;
      const flying = g.members.filter((m) => this.birds.has(m.id) && m.state === 'flying' && (m.mode === 'cruise' || m.mode === 'toPerch'));
      const trees = this.pickPerchTrees(lead.sp, d.pos.x, d.pos.z, 35, 2);
      if (trees && this.rnd.chance(0.4)) {
        for (const m of flying) {
          m.perchTree = this.rnd.pick(trees);
          m.mode = 'toPerch';
          m.waypoints = [this.perchPoint(m.perchTree)];
        }
        continue;
      }
      this.groupStats(g);
      const c = g.n ? g.c : lead.pos;
      const pass = new THREE.Vector3(d.pos.x + this.rnd.float(-6, 6), 0, d.pos.z + this.rnd.float(-6, 6));
      const away = new THREE.Vector3().subVectors(pass, c).setY(0).normalize().multiplyScalar(400).add(pass);
      g.path = [pass, away];
      g.alt = Math.max(lead.sp.flight.alt[0] * 0.7, 5);
      for (const m of flying) {
        m.mode = 'cruise';
        m.alt = g.alt + m.offY;
      }
    }
  }

  // A dog pressing in on a bird it has pointed (authority only).
  dogFlush(id, from) {
    const b = this.birds.get(id);
    if (b && (b.state === 'hidden' || b.state === 'running')) this.flush(b, from);
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
      const flying = g.members.filter((m) => this.birds.has(m.id) && m.state === 'flying' && (m.mode === 'cruise' || m.mode === 'toPerch'));
      if (land) {
        for (const m of flying) {
          m.perchTree = this.rnd.pick(trees);
          m.mode = 'toPerch';
          m.waypoints = [this.perchPoint(m.perchTree)];
        }
      } else {
        // the flock swings round to pass low over the whistler
        this.groupStats(g);
        const c = g.n ? g.c : lead.pos;
        const a = this.rnd.float(0, Math.PI * 2);
        const pass = new THREE.Vector3(pos.x + Math.cos(a) * 18, 0, pos.z + Math.sin(a) * 18);
        const away = new THREE.Vector3().subVectors(pass, c).setY(0).normalize().multiplyScalar(400).add(pass);
        g.path = [pass, away];
        g.alt = Math.max(lead.sp.flight.alt[0], g.alt * 0.6);
        for (const m of flying) {
          m.mode = 'cruise';
          m.alt = g.alt + m.offY;
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
      if (bird.state !== 'flying' && bird.state !== 'perched' && bird.state !== 'running') continue;
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
      } else if (bird.state === 'flying' && d2 < (bird.sp.wingspan * 0.42 * bird.size) ** 2 && Math.abs(py) < bird.sp.length * 0.08 * bird.size && t < bestT) {
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
    if (!b || (b.state !== 'flying' && b.state !== 'perched' && b.state !== 'running')) return null;
    this.feathers.burst(b.pos, b.spId, Math.min(40, 6 + hits * 5));
    // a clean kill, or a second hit on a bird already wounded
    if (hits >= b.sp.toughness || b.wound) {
      this.kill(b, shooterId, impulse);
      return 'kill';
    }
    this.woundBird(b, hits, shooterId);
    return 'wound';
  }

  // Hit, but not cleanly. Some birds tower and fall, some glide down far off,
  // others fly on and drop later or get away.
  woundBird(b, hits, by) {
    const from = b.pos.clone().add(new THREE.Vector3(1, 0, 0));
    if (b.state === 'perched') this.takeOff(b, from);
    else if (b.state === 'running') this.flush(b, from);
    b.owner = by;
    b.flags |= F_WOUNDED;
    const fatal = this.rnd.chance(Math.min(0.9, 0.55 + hits * 0.12));
    const r = this.rnd.next();
    const agl = b.pos.y - this.ground(b.pos.x, b.pos.z);
    let type = 'flyOn';
    if (fatal && r < 0.25) type = 'tower';
    else if (fatal && r < 0.6 && agl > 2.5) type = 'glide';
    b.wound = { type, fatal, speedMul: 0.8, t: this.rnd.float(4, 14), t2: 0, top: 0, dist: 0, traveled: 0, curve: this.rnd.float(-0.25, 0.25) };
    b.takeoff = 0;
    if (type === 'tower') {
      b.mode = 'tower';
      b.wound.top = b.pos.y + this.rnd.float(10, 25);
      b.wound.speedMul = 1;
    } else if (type === 'glide') {
      b.mode = 'glideDown';
      b.wound.dist = this.rnd.float(90, 200);
      b.wound.speedMul = 1;
    } else if (b.mode === 'cruise' || b.mode === 'toPerch') {
      // a hurt bird drops out of the flock and flies on alone
      b.mode = 'leave';
      if (b.group) b.heading.copy(b.group.dir);
    }
    this.emit('wound', { id: b.id, by, spId: b.spId });
  }

  kill(b, shooterId, impulse) {
    if (b.wound) this.feathers.burst(b.pos, b.spId, 6);
    b.state = 'falling';
    b.t = 0;
    b.owner = shooterId;
    b.wound = null;
    b.flags = 0;
    b.vel.multiplyScalar(0.55).add(impulse || new THREE.Vector3());
    b.vel.y = Math.min(b.vel.y, 1.5);
    b.spin.set(this.rnd.float(-8, 8), this.rnd.float(-6, 6), this.rnd.float(-10, 10));
    b.model.root.visible = true;
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

  wingMode(b) {
    const f = b.sp.flight;
    switch (b.state) {
      case 'perched':
        return b.hop ? 'flap' : b.act === 'peck' ? 'peck' : b.act === 'preen' ? 'preen' : 'perch';
      case 'running':
        return 'run';
      case 'falling':
        return 'limp';
      case 'dead':
        return 'fold';
    }
    if (b.takeoff > 0 || b.mode === 'tower') return 'climb';
    if (b.flaring) return 'flare';
    const tt = b.t + b.id * 0.37;
    if (b.mode === 'glideDown') return tt % 2.2 < 0.35 ? 'flap' : 'glide';
    if (b.flare > 0 && f.style !== 'soar') return 'flap'; // spooked birds beat hard
    if (f.style === 'bounding') return tt % 0.8 < 0.45 ? 'flap' : 'fold';
    if (f.style === 'direct') return tt % 2.6 < 2.0 ? 'flap' : 'glide';
    if (f.style === 'whirr') return b.mode === 'landing' || !(b.t < 1.4 || tt % 1.4 < 0.9) ? 'glide' : 'flap';
    if (f.style === 'soar') return tt % 14 < 1.6 ? 'flap' : 'glide';
    return 'flap';
  }

  animate(b, dt) {
    const sp = b.sp;
    const f = sp.flight;
    const P = this.authority ? b.pos : b.renderPos || b.pos;
    const M = b.model;
    const root = M.root;
    if (b.state === 'hidden' || b.carried) {
      root.visible = false;
      return;
    }
    root.visible = true;
    root.position.copy(P);
    let mode;
    if (this.authority) {
      mode = this.wingMode(b);
      if (b.state === 'flying') {
        const v = b.vel;
        const hs = Math.hypot(v.x, v.z);
        b.yaw = Math.atan2(v.x, v.z);
        let pitch = -Math.atan2(v.y, Math.max(0.1, hs)) * 0.7;
        if (mode === 'flare') pitch = Math.min(pitch, -0.5); // nose up, braking
        b.pitch += (pitch - b.pitch) * Math.min(1, dt * 8);
        b.roll = clamp(-(b.turn || 0) * 0.5, -0.9, 0.9);
      } else if (b.state === 'running') {
        b.yaw = Math.atan2(b.heading.x, b.heading.y);
        b.pitch = 0.12;
        b.roll = 0;
      }
      b.wing = mode;
    } else {
      mode = b.wingMode || 'flap';
    }
    root.rotation.set(b.pitch, b.yaw, b.roll, 'YXZ');

    let hz = Math.min(f.flapHz, 13);
    if (mode === 'climb') hz *= 1.2;
    if (mode === 'flare') hz = Math.min(hz * 1.4, 16);
    if (b.flags & F_WOUNDED) hz *= 0.7;
    if (mode === 'flap' || mode === 'climb' || mode === 'flare') b.phase += dt * hz * Math.PI * 2;
    poseWings(M, mode, b.phase, f.style === 'soar' ? 0.5 : 1, this.time + b.id);

    const t = this.time + b.id * 1.7;
    let legs = 'tuck';
    if (b.state === 'perched') legs = 'stand';
    else if (b.state === 'running') legs = 'run';
    else if (b.state === 'flying') legs = b.flags & F_WOUNDED ? 'dangle' : mode === 'flare' ? 'stand' : 'tuck';
    poseLegs(M, legs, t);

    // head and body
    M.head.rotation.set(0, 0, 0);
    M.body.position.y = 0;
    M.body.rotation.z = 0;
    if (b.state === 'perched') {
      if (mode === 'peck') M.head.rotation.x = 0.5 + Math.max(0, Math.sin(t * 7)) * 0.7; // feeding
      else if (mode === 'preen') {
        M.head.rotation.set(0.35, (b.id % 2 ? 1 : -1) * 2.3, 0);
        M.body.rotation.z = Math.sin(t * 9) * 0.05;
      } else M.head.rotation.y = Math.sin(t * 0.8) * 0.6 + Math.sin(t * 2.3) * 0.25; // looking round
    } else if (b.state === 'running') {
      M.body.position.y = Math.abs(Math.sin(t * 16)) * 0.05;
      M.head.rotation.x = 0.15;
    }
  }

  // ---------------- network ----------------

  snapshot() {
    const out = [];
    for (const b of this.birds.values()) {
      // hidden ground birds go too, so other hunters' dogs can scent them
      if (b.state === 'hidden' && b.sp.behaviour !== 'ground') continue;
      out.push([
        b.id,
        SPECIES_LIST.indexOf(b.spId),
        STATES.indexOf(b.state),
        +b.pos.x.toFixed(2), +b.pos.y.toFixed(2), +b.pos.z.toFixed(2),
        +b.yaw.toFixed(2), +b.pitch.toFixed(2), +b.roll.toFixed(2),
        WING.indexOf(b.wing),
        b.owner || 0,
        b.flags,
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
      const [id, spi, sti, x, y, z, yaw, pitch, roll, wi, owner, flags = 0] = s;
      seen.add(id);
      let b = this.birds.get(id);
      const fresh = !b;
      if (!b) {
        b = this.create(SPECIES_LIST[spi], id);
        b.renderPos = new THREE.Vector3(x, y, z);
      }
      const st = STATES[sti];
      // feathers on the clients too: where a bird is hit, and where a wounded one comes down
      if (!fresh && flags & F_WOUNDED && !(b.flags & F_WOUNDED)) this.feathers.burst(_v.set(x, y, z), b.spId, 8);
      if (!fresh && st === 'dead' && b.state === 'flying') this.feathers.burst(_v.set(x, y, z), b.spId, 4, true);
      b.state = st;
      b.flags = flags;
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

// Feathers drifting down after a hit. The ones that reach the ground lie there
// for a couple of minutes: clues to where a bird was hit or came down.
class Feathers {
  constructor(scene, ground) {
    const g = new THREE.PlaneGeometry(1, 0.35);
    const m = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide, roughness: 1 });
    this.cap = 800;
    this.mesh = new THREE.InstancedMesh(g, m, this.cap);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.ground = ground;
    this.p = [];
    this.dummy = new THREE.Object3D();
  }

  burst(pos, spId, n, onGround = false) {
    const cols = featherColor(spId);
    const size = SPECIES[spId].length * 0.18 * (this.sizeMul || 1);
    for (let i = 0; i < n; i++) {
      if (this.p.length >= this.cap) this.p.shift();
      const f = {
        pos: pos.clone(),
        vel: new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 1.5, (Math.random() - 0.5) * 3),
        rot: new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6),
        spin: new THREE.Vector3((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6),
        life: 25 + Math.random() * 15,
        size: size * (0.6 + Math.random() * 0.8),
        col: cols[i % cols.length],
        rest: false,
      };
      if (onGround) {
        f.pos.x += (Math.random() - 0.5) * 0.8;
        f.pos.z += (Math.random() - 0.5) * 0.8;
        this.settle(f);
      }
      this.p.push(f);
    }
  }

  settle(f) {
    f.rest = true;
    f.pos.y = this.ground(f.pos.x, f.pos.z) + 0.015;
    f.rot.set(-Math.PI / 2 + (Math.random() - 0.5) * 0.3, Math.random() * 6, 0, 'YXZ');
    f.life = 90 + Math.random() * 60;
  }

  update(dt) {
    const d = this.dummy;
    let n = 0;
    this.p = this.p.filter((f) => (f.life -= dt) > 0);
    for (const f of this.p) {
      if (!f.rest) {
        f.vel.y = Math.max(f.vel.y - 4 * dt, -0.9);
        f.vel.x *= 1 - 1.5 * dt;
        f.vel.z *= 1 - 1.5 * dt;
        f.pos.addScaledVector(f.vel, dt);
        f.pos.x += Math.sin(f.life * 3) * 0.2 * dt;
        f.rot.x += f.spin.x * dt;
        f.rot.y += f.spin.y * dt;
        f.rot.z += f.spin.z * dt;
        if (f.pos.y <= this.ground(f.pos.x, f.pos.z) + 0.015) this.settle(f);
      }
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
