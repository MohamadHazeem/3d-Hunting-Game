import * as THREE from 'three';
import './gameplay.css';
import { SPECIES } from '../config/species.js';
import { settings, onSettingChange } from '../core/settings.js';
import { audio } from '../audio/audio.js';
import { birdSizeMul } from '../birds/birds.js';
import { Zones } from '../birds/zones.js';
import { esc } from './hud.js';
import { gt, birdName, n0, fmtHour, dirName, zoneTitle, zonePlace, zoneHours, zoneDoing } from './gameplayText.js';

// The hunter's awareness, after theHunter: Call of the Wild:
// - binoculars (B) mark the birds you hold in them for a while (species and
//   distance over the bird, and on the compass);
// - arrows at the screen edge for flocks heading your way;
// - visibility and noise meters, showing exactly the numbers the birds use;
// - need zones (where and when each species feeds, drinks and roosts) to
//   discover and see on the map (M);
// - species callers (V to change, Q to blow): thrush whistle, quail call,
//   dove cooer;
// - a line telling you what to do next.
// Everything here is created in code; its text lives in gameplayText.js.

const TAG_TIME = 30; // s a spotted bird stays marked
const ARROW_RANGE = 200; // m
const CALLERS = {
  thrush: { key: 'callerThrush', cd: 4, for: ['songThrush', 'fieldfare', 'chaffinch'] },
  quail: { key: 'callerQuail', cd: 12, for: ['quail'] },
  dove: { key: 'callerDove', cd: 15, for: ['turtleDove', 'woodpigeon'] },
};
const ZONE_COLOR = '#9be27a';
const TAG_COLOR = '#7fd4ff';

const EYE = '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/></svg>';
const EAR = '<svg viewBox="0 0 24 24"><path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const TRI = '<svg viewBox="0 0 20 20"><path d="M18 10 4 3.5 7.5 10 4 16.5z" fill="currentColor" stroke="rgba(0,0,0,.55)" stroke-width="1.2"/></svg>';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _f = new THREE.Vector3();
const bearing = (fx, fz, tx, tz) => Math.atan2(tx - fx, -(tz - fz));

// ---------------------------------------------------------------- settings

// Three rows in the Aiming help tab, bound by main.js like the rest.
function injectSettings() {
  const tab = document.querySelector('#settings .tab[data-tab="assists"]');
  if (!tab || tab.querySelector('[data-setting="birdSize"]')) return;
  tab.insertAdjacentHTML(
    'afterbegin',
    `<label><span data-gp="setBirdSize"></span> <select data-setting="birdSize"><option value="visible" data-gp="setVisible"></option><option value="realistic" data-gp="setRealistic"></option></select></label>
    <label><span data-gp="setMarkers"></span> <input data-setting="birdMarkers" type="checkbox" /></label>
    <label><span data-gp="setArrows"></span> <input data-setting="flockArrows" type="checkbox" /></label>`
  );
  relabel();
}

function relabel() {
  for (const el of document.querySelectorAll('[data-gp]')) el.textContent = gt(el.dataset.gp);
}

injectSettings();
onSettingChange((k) => {
  if (k === 'lang') relabel();
});

// A pool of absolutely placed elements, reused frame to frame.
class Pool {
  constructor(parent, cls, html = '') {
    this.parent = parent;
    this.cls = cls;
    this.html = html;
    this.items = [];
    this.n = 0;
  }

  begin() {
    this.n = 0;
  }

  get() {
    let e = this.items[this.n];
    if (!e) {
      e = document.createElement('div');
      e.className = this.cls;
      e.innerHTML = this.html;
      this.parent.append(e);
      this.items.push(e);
    }
    this.n++;
    e.style.display = '';
    return e;
  }

  end() {
    for (let i = this.n; i < this.items.length; i++) this.items[i].style.display = 'none';
  }
}

function setText(el, s) {
  if (el._s !== s) {
    el._s = s;
    el.textContent = s;
  }
}

// ---------------------------------------------------------------- gameplay

export class Gameplay {
  constructor(game) {
    this.game = game;
    this.tags = new Map(); // bird id -> marked until (bird clock)
    this.dwell = new Map(); // bird id -> seconds held in the binoculars
    this.pings = []; // birds answering your call: {p, from, until}
    this.cd = { thrush: 0, quail: 0, dove: 0 };
    const sp = game.hunt.species;
    this.callers = Object.keys(CALLERS).filter((k) => CALLERS[k].for.some((s) => sp[s]));
    if (!this.callers.length) this.callers = ['thrush'];
    this.caller = 0;
    this.scanT = 0;
    this.zoneT = 0;
    this.flockT = 0;
    this.objT = 0;
    this.flocks = [];
    this.buildDom();

    // the evening flight and the roosting zones follow the day's sunset
    const sunset = game.atmo.month.set;
    game.birds.sunset = sunset;
    this.zones = new Zones(game.scene, game.terrain, game.veg, game.hunt, sunset);
    if (game.authority) this.zones.build(game.player.pos);
    game.map.zones = this.zones;
    this.setupNet();
    onSettingChange((k) => {
      if (k === 'birdSize') game.birds.setSize(birdSizeMul());
      if (k === 'lang') {
        this.objText = null;
        this.labelMeters();
      }
    });
  }

  buildDom() {
    const root = (this.root = document.createElement('div'));
    root.className = 'gp';
    root.innerHTML = `<div class="gp-meters"><div class="gp-meter"><span class="gp-ic">${EYE}</span><span class="gp-lbl"></span><i><b></b></i></div><div class="gp-meter"><span class="gp-ic">${EAR}</span><span class="gp-lbl"></span><i><b></b></i></div></div>
      <div class="gp-objective hidden"></div><div class="gp-caller"></div><div class="gp-layer"></div>`;
    // under the map, so the map (M) covers the marks when it's open
    document.getElementById('hud').insertBefore(root, document.getElementById('map'));
    const bars = root.querySelectorAll('.gp-meter b');
    this.visBar = bars[0];
    this.noiseBar = bars[1];
    this.objEl = root.querySelector('.gp-objective');
    this.callerEl = root.querySelector('.gp-caller');
    const layer = root.querySelector('.gp-layer');
    this.marks = new Pool(layer, 'gp-mark');
    this.arrows = new Pool(layer, 'gp-arrow', `<div class="gp-tri">${TRI}</div><span></span>`);
    this.labelMeters();
  }

  labelMeters() {
    const l = this.root.querySelectorAll('.gp-lbl');
    l[0].textContent = gt('vis');
    l[1].textContent = gt('noise');
  }

  // ------------------------------------------------ net

  setupNet() {
    const g = this.game;
    const net = g.net;
    if (!net) return;
    if (net.isHost) {
      net.on('zonesReq', (m, from) => net.send({ t: 'zones', list: this.zones.netList() }, from));
      net.on('zoneFound', (m, from) => {
        const z = this.zones.setFound(m.id);
        if (!z) return;
        this.zoneMessage(z, g.players.get(from)?.name || '…');
        net.broadcast({ t: 'zoneFound', id: m.id, by: from });
      });
      net.on('caller', (m, from) => this.hostCall(m.kind, new THREE.Vector3(...m.p), from));
    } else {
      net.on('zones', (m) => this.zones.applyNet(m.list));
      net.on('zoneFound', (m) => {
        const z = this.zones.list.find((o) => o.id === m.id);
        if (!z || z.found || m.by === g.myId) return;
        z.found = true;
        this.zoneMessage(z, g.players.get(m.by)?.name || '…');
      });
      net.on('callerAns', (m) => this.onAnswer(m));
      net.send({ t: 'zonesReq' });
    }
  }

  // ------------------------------------------------ per frame

  update(dt, sim) {
    const g = this.game;
    if (g.ended) return;
    if (g.input.engaged && !g.chatOpen) {
      if (g.input.pressed('KeyV')) this.cycleCaller();
      for (let i = 0; i < this.callers.length; i++) if (g.input.pressed(`Digit${i + 1}`)) this.caller = i;
    }
    for (const k in this.cd) this.cd[k] = Math.max(0, this.cd[k] - dt);
    if (sim > 0 && g.authority) this.zones.update(sim, g.birds, [...g.players.values()], g.atmo.hour);
    g.map.hour = g.atmo.hour;
    g.birds.viewer = g.camera.position;
    g.camera.updateMatrixWorld();
    this.spot(dt);
    this.checkZones(dt);
    this.draw(dt);
  }

  // ------------------------------------------------ spotting

  // Hold a bird in the middle of the binoculars for a moment and it (and the
  // party it's with) is marked for half a minute.
  spot(dt) {
    const g = this.game;
    const now = g.birds.time;
    for (const [id, until] of this.tags) {
      const b = g.birds.birds.get(id);
      if (until < now || !b || b.state === 'hidden' || b.carried) this.tags.delete(id);
    }
    if (!g.player.binocs) {
      this.dwell.clear();
      return;
    }
    this.scanT -= dt;
    if (this.scanT > 0) return;
    this.scanT = 0.1;
    const cam = g.camera;
    const eye = cam.position;
    _f.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const cone = Math.cos(THREE.MathUtils.degToRad(Math.max(cam.fov, 9) * 0.42));
    for (const b of g.birds.birds.values()) {
      if (b.state === 'hidden' || b.state === 'dead' || b.state === 'falling' || b.carried) continue;
      const p = b.renderPos || b.pos;
      _v.subVectors(p, eye);
      const d = _v.length();
      if (d > 450 || d < 2 || _v.dot(_f) / d < cone) continue;
      if (!this.canSee(p, eye)) continue;
      const t = (this.dwell.get(b.id) || 0) + 0.1;
      this.dwell.set(b.id, t);
      if (this.tags.has(b.id)) this.tags.set(b.id, now + TAG_TIME);
      else if (t >= 0.3) this.tag(b);
    }
  }

  // Can the hunter see this point? Hills and trunks get in the way; you can
  // pick a bird out through gaps in the leaves, and its own tree doesn't hide it.
  canSee(p, eye) {
    const t = this.game.terrain;
    const d = p.distanceTo(eye);
    const n = Math.min(40, Math.max(3, Math.ceil(d / 6)));
    for (let i = 1; i < n; i++) {
      const k = i / n;
      if (t.height(eye.x + (p.x - eye.x) * k, eye.z + (p.z - eye.z) * k) > eye.y + (p.y - eye.y) * k - 0.15) return false;
    }
    const vx = p.x - eye.x;
    const vz = p.z - eye.z;
    const l2 = vx * vx + vz * vz || 1e-6;
    for (const tr of this.game.veg.treesNear((p.x + eye.x) / 2, (p.z + eye.z) / 2, Math.sqrt(l2) / 2 + 5)) {
      if (Math.hypot(tr.x - p.x, tr.z - p.z) < tr.crownR) continue;
      const k = Math.min(1, Math.max(0, ((tr.x - eye.x) * vx + (tr.z - eye.z) * vz) / l2));
      const y = eye.y + (p.y - eye.y) * k;
      if (Math.hypot(eye.x + vx * k - tr.x, eye.z + vz * k - tr.z) < tr.r && y < tr.y + tr.crownY && y > tr.y - 0.5) return false;
    }
    return true;
  }

  tag(b) {
    const g = this.game;
    const now = g.birds.time;
    const p = b.renderPos || b.pos;
    for (const o of g.birds.birds.values()) {
      if (o.spId !== b.spId || o.state === 'hidden' || o.state === 'dead' || o.state === 'falling') continue;
      if ((o.renderPos || o.pos).distanceTo(p) < 18) this.tags.set(o.id, now + TAG_TIME);
    }
    audio.play('cloth', null, { gain: 0.15, rate: 1.8 });
    // seeing a species at its place at its hour gives the zone away
    const hour = g.atmo.hour;
    for (const z of this.zones.list) {
      if (!z.found && z.sp === b.spId && this.zones.active(z, hour) && Math.hypot(p.x - z.x, p.z - z.z) < z.r + 30) this.discover(z, null);
    }
  }

  // Tagged birds (one mark per party) and found zones that are active now,
  // for the compass.
  compassMarkers(markers) {
    const g = this.game;
    const me = g.player.pos;
    const seen = [];
    if (settings.birdMarkers) {
      for (const id of this.tags.keys()) {
        const b = g.birds.birds.get(id);
        if (!b) continue;
        const p = b.renderPos || b.pos;
        if (seen.some((o) => o.sp === b.spId && o.p.distanceTo(p) < 30)) continue;
        seen.push({ sp: b.spId, p });
        const d = Math.hypot(p.x - me.x, p.z - me.z);
        markers.push({ yaw: bearing(me.x, me.z, p.x, p.z), label: `${Math.round(d)}m`, color: TAG_COLOR });
      }
    }
    const hour = g.atmo.hour;
    for (const z of this.zones.list) {
      if (!z.found || !this.zones.active(z, hour)) continue;
      const d = Math.hypot(z.x - me.x, z.z - me.z);
      if (d > z.r) markers.push({ yaw: bearing(me.x, me.z, z.x, z.z), label: `◆ ${Math.round(d)}m`, color: ZONE_COLOR });
    }
    const now = g.birds.time;
    for (const pg of this.pings) {
      if (now < pg.from || now > pg.until) continue;
      markers.push({ yaw: bearing(me.x, me.z, pg.p.x, pg.p.z), label: '♪', color: '#ffe1a6' });
    }
  }

  // ------------------------------------------------ zones

  checkZones(dt) {
    this.zoneT -= dt;
    if (this.zoneT > 0) return;
    this.zoneT = 0.25;
    const g = this.game;
    const me = g.player.pos;
    const hour = g.atmo.hour;
    for (const z of this.zones.list) {
      if (z.found) continue;
      // sign on the ground: feathers and droppings, tracks at the water
      if (z.signs.some(([x, zz]) => Math.hypot(x - me.x, zz - me.z) < 3.5)) {
        this.discover(z, z.water ? 'signWater' : z.kind === 'ground' || z.kind === 'groundFeed' ? 'signGround' : 'signFeathers');
        continue;
      }
      // or walking in on the birds themselves
      if (!this.zones.active(z, hour) || Math.hypot(me.x - z.x, me.z - z.z) > z.r + 10) continue;
      for (const b of g.birds.birds.values()) {
        if (b.spId !== z.sp || b.state === 'hidden' || b.state === 'dead' || b.state === 'falling') continue;
        const p = b.renderPos || b.pos;
        if (Math.hypot(p.x - me.x, p.z - me.z) < 40 && Math.hypot(p.x - z.x, p.z - z.z) < z.r + 25) {
          this.discover(z, null);
          break;
        }
      }
    }
  }

  discover(z, signKey) {
    if (z.found) return;
    z.found = true;
    const g = this.game;
    if (signKey) g.hud.message(gt(signKey), 'info');
    this.zoneMessage(z, null);
    audio.play('hitConfirm', null, { gain: 0.22, rate: 0.75 });
    const net = g.net;
    if (!net) return;
    if (net.isHost) net.broadcast({ t: 'zoneFound', id: z.id, by: g.myId });
    else net.send({ t: 'zoneFound', id: z.id });
  }

  zoneMessage(z, byName) {
    const title = zoneTitle(z);
    this.game.hud.message(byName ? gt('zoneFoundBy', { name: esc(byName), title }) : gt('zoneFound', { title, place: zonePlace(z), hours: zoneHours(z) }), 'kill');
    this.objT = 0;
  }

  // ------------------------------------------------ callers

  cycleCaller() {
    if (this.callers.length < 2) return;
    this.caller = (this.caller + 1) % this.callers.length;
    audio.play('cloth', null, { gain: 0.2, rate: 1.4 });
  }

  // Q: blow the caller in hand.
  blow() {
    const g = this.game;
    const kind = this.callers[this.caller];
    if (this.cd[kind] > 0) return;
    this.cd[kind] = CALLERS[kind].cd;
    if (kind === 'thrush') return g.whistle();
    const pos = g.player.camera.position.clone();
    this.playCall(kind, null);
    if (g.authority) this.hostCall(kind, pos, g.myId);
    else g.net.send({ t: 'caller', kind, p: pos.toArray().map((v) => +v.toFixed(2)) });
  }

  playCall(kind, pos) {
    const near = !pos;
    if (kind === 'quail') audio.play('quail', pos, { gain: near ? 0.45 : 0.8, rate: 1.06, ref: 8 });
    else if (kind === 'dove') audio.play(this.game.hunt.species.turtleDove ? 'purr' : 'coo', pos, { gain: near ? 0.5 : 0.8, ref: 8 });
  }

  // The host works out who answers and tells everyone.
  hostCall(kind, pos, by) {
    const birds = this.game.birds;
    let list = [];
    let n = 0;
    if (kind === 'quail') list = birds.callQuail(pos);
    else if (kind === 'dove') ({ n, answers: list } = birds.callDoves(pos));
    else return;
    const m = { t: 'callerAns', kind, by, p: pos.toArray().map((v) => +v.toFixed(2)), n, list };
    this.onAnswer(m);
    if (this.game.net) this.game.net.broadcast(m);
  }

  onAnswer(m) {
    const g = this.game;
    const mine = m.by === g.myId;
    if (!mine) this.playCall(m.kind, new THREE.Vector3(...m.p));
    for (const a of m.list) audio.play(a.call || (m.kind === 'quail' ? 'quail' : 'coo'), new THREE.Vector3(...a.p), { gain: 0.9, ref: 10, delay: a.delay });
    if (!mine) return;
    const now = g.birds.time;
    for (const a of m.list) this.pings.push({ p: new THREE.Vector3(a.p[0], a.p[1] + 0.4, a.p[2]), from: now + a.delay, until: now + a.delay + 6 });
    if (m.kind === 'quail') g.hud.message(m.list.length ? gt('quailAnswer', { n: n0(m.list.length) }) : gt('quailNone'), 'info');
    else g.hud.message(m.n || m.list.length ? gt('doveIn') : gt('doveNone'), 'info');
  }

  // ------------------------------------------------ drawing

  draw(dt) {
    const g = this.game;
    const W = innerWidth;
    const H = innerHeight;
    this.drawMeters();
    this.drawCaller();
    this.marks.begin();
    this.arrows.begin();
    if (settings.birdMarkers) this.drawTags(W, H);
    this.drawPings(W, H);
    this.drawSigns(W, H);
    this.flockT -= dt;
    if (this.flockT <= 0) {
      this.flockT = 0.2;
      this.flocks = settings.flockArrows ? this.findFlocks() : [];
    }
    for (const f of this.flocks) this.drawArrow(f, W, H);
    this.marks.end();
    this.arrows.end();
    this.objT -= dt;
    if (this.objT <= 0) {
      this.objT = 1;
      const s = this.objective();
      if (s !== this.objText) {
        this.objText = s;
        this.objEl.innerHTML = s;
      }
    }
    // make way for a tip when one is showing
    this.objEl.classList.toggle('hidden', !this.objText || document.getElementById('hint').classList.contains('on'));
    this.pings = this.pings.filter((p) => p.until > g.birds.time);
  }

  drawMeters() {
    const g = this.game;
    const me = g.players.get(g.myId);
    if (!me) return;
    const e = g.birds.exposure(me);
    bar(this.visBar, e.vis);
    bar(this.noiseBar, e.noise);
  }

  drawCaller() {
    const kind = this.callers[this.caller];
    const name = gt(CALLERS[kind].key);
    const cd = this.cd[kind];
    const html = cd > 0 ? gt('callerWait', { name, s: n0(Math.ceil(cd)) }) : gt('callerHud', { name });
    if (html !== this.callerHtml) {
      this.callerHtml = html;
      this.callerEl.innerHTML = html;
      this.callerEl.classList.toggle('wait', cd > 0);
    }
  }

  // screen position of a world point; front = in front of the camera
  screen(p, W, H) {
    _v.copy(p).project(this.game.camera);
    return { x: ((_v.x + 1) / 2) * W, y: ((1 - _v.y) / 2) * H, front: _v.z < 1 };
  }

  mark(cls, text, x, y) {
    const el = this.marks.get();
    if (el._c !== cls) {
      el._c = cls;
      el.className = 'gp-mark ' + cls;
    }
    setText(el, text);
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  }

  drawTags(W, H) {
    const g = this.game;
    const eye = g.camera.position;
    const items = [];
    for (const id of this.tags.keys()) {
      const b = g.birds.birds.get(id);
      if (!b || b.state === 'dead' || b.state === 'falling') continue;
      const p = b.renderPos || b.pos;
      const s = this.screen(p, W, H);
      if (!s.front || s.x < -30 || s.x > W + 30 || s.y < -30 || s.y > H + 30) continue;
      const d = p.distanceTo(eye);
      const it = items.find((o) => o.sp === b.spId && Math.hypot(o.x - s.x, o.y - s.y) < 56);
      if (it) {
        it.n++;
        it.d = Math.min(it.d, d);
        if (s.y < it.y) [it.x, it.y] = [s.x, s.y];
      } else items.push({ sp: b.spId, x: s.x, y: s.y, n: 1, d, prot: b.sp.protected });
    }
    for (const it of items) {
      const v = { sp: birdName(it.sp), d: n0(it.d), n: n0(it.n) };
      this.mark(it.prot ? 'prot' : 'tag', gt(it.n > 1 ? 'birdTagN' : 'birdTag', v), it.x, it.y - 10);
    }
  }

  drawPings(W, H) {
    const g = this.game;
    const now = g.birds.time;
    for (const pg of this.pings) {
      if (now < pg.from) continue;
      const s = this.screen(pg.p, W, H);
      if (!s.front || s.x < 0 || s.x > W || s.y < 0 || s.y > H) continue;
      this.mark('ping', gt('heard', { d: n0(pg.p.distanceTo(g.camera.position)) }), s.x, s.y - 6);
    }
  }

  // Sign close by shows up, the way tracks catch your eye.
  drawSigns(W, H) {
    const g = this.game;
    const me = g.player.pos;
    for (const z of this.zones.list) {
      if (z.found) continue;
      for (const [x, zz] of z.signs) {
        const d = Math.hypot(x - me.x, zz - me.z);
        if (d > 16) continue;
        const s = this.screen(_w.set(x, g.terrain.height(x, zz) + 0.3, zz), W, H);
        if (!s.front || s.x < 0 || s.x > W || s.y < 0 || s.y > H) continue;
        this.mark('sign', gt('sign', { d: n0(d) }), s.x, s.y - 4);
      }
    }
  }

  // Flocks within ARROW_RANGE that are heading this way (their line passes
  // within ~60 m of you), nearest first.
  findFlocks() {
    const g = this.game;
    const me = g.player.pos;
    const groups = [];
    for (const b of g.birds.birds.values()) {
      if (b.state !== 'flying' || b.sp.protected || b.flags & 1) continue;
      const p = b.renderPos || b.pos;
      if (Math.hypot(p.x - me.x, p.z - me.z) > ARROW_RANGE + 40) continue;
      let f = groups.find((o) => o.sp === b.spId && o.p0.distanceTo(p) < 35);
      if (!f) groups.push((f = { sp: b.spId, p0: p.clone(), c: new THREE.Vector3(), v: new THREE.Vector3(), n: 0 }));
      f.c.add(p);
      f.v.add(velOf(b));
      f.n++;
    }
    const out = [];
    for (const f of groups) {
      f.c.divideScalar(f.n);
      f.v.divideScalar(f.n);
      const dx = me.x - f.c.x;
      const dz = me.z - f.c.z;
      const d = Math.hypot(dx, dz);
      const vs = Math.hypot(f.v.x, f.v.z);
      if (d > ARROW_RANGE || d < 10 || vs < 2) continue;
      const closing = (f.v.x * dx + f.v.z * dz) / (d * vs);
      const miss = Math.abs(f.v.x * dz - f.v.z * dx) / vs;
      if (closing < 0.3 || miss > 60) continue;
      f.d = Math.hypot(d, f.c.y - me.y);
      out.push(f);
    }
    return out.sort((a, b) => a.d - b.d).slice(0, 3);
  }

  // An arrow at the screen edge pointing to an incoming flock that is off
  // the screen.
  drawArrow(f, W, H) {
    const cam = this.game.camera;
    const ndc = _v.copy(f.c).project(cam);
    if (ndc.z < 1 && Math.abs(ndc.x) < 0.94 && Math.abs(ndc.y) < 0.94) return;
    _w.copy(f.c).applyMatrix4(cam.matrixWorldInverse); // camera space: x right, y up, -z ahead
    let dx = _w.x;
    let dy = -_w.y;
    if (Math.hypot(dx, dy) < 1e-3) dy = 1;
    const mx = W / 2 - 64;
    const my = H / 2 - 64;
    const k = Math.min(mx / Math.max(1e-6, Math.abs(dx)), my / Math.max(1e-6, Math.abs(dy)));
    const x = W / 2 + dx * k;
    const y = H / 2 + dy * k;
    const el = this.arrows.get();
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    el.firstChild.style.transform = `rotate(${Math.atan2(dy, dx).toFixed(3)}rad)`;
    setText(el.lastChild, gt('birdTag', { sp: birdName(f.sp), d: n0(f.d) }));
  }

  // ------------------------------------------------ what to do next

  objective() {
    const g = this.game;
    const me = g.player.pos;
    const hour = g.atmo.hour;
    // a bird of yours down and not yet picked up
    let best = null;
    let bd = 250;
    for (const b of g.birds.birds.values()) {
      if (b.state !== 'dead' || b.owner !== g.myId || b.carried) continue;
      const p = b.renderPos || b.pos;
      const d = Math.hypot(p.x - me.x, p.z - me.z);
      if (d < bd) [bd, best] = [d, p];
    }
    if (best && bd > 2.5) return gt('oPickup', { d: n0(bd), dir: dirName(bearing(me.x, me.z, best.x, best.z)) });
    // a zone that is on now: found ones first, then the nearest
    const zs = this.zones.list.map((z) => ({ z, w: this.zones.window(z, hour), d: Math.hypot(z.x - me.x, z.z - me.z) })).filter((o) => o.w);
    const on = zs.filter((o) => o.w.on).sort((a, b) => b.z.found - a.z.found || a.d - b.d);
    if (on.length) {
      const { z, w, d } = on[0];
      const dir = dirName(bearing(me.x, me.z, z.x, z.z));
      let s = zoneDoing(z, w.to);
      if (d < z.r) s += gt('oThere');
      else if (z.found) s += gt('oHead', { dir, d: n0(d) });
      else s += gt('oSearch', { dir });
      return s;
    }
    // the next one today
    const next = zs.filter((o) => !o.w.on && o.w.from - hour < 2.5).sort((a, b) => a.w.from - b.w.from)[0];
    if (next) return gt('oNext', { title: zoneTitle(next.z), from: fmtHour(next.w.from), dir: dirName(bearing(me.x, me.z, next.z.x, next.z.z)) });
    const kinds = Object.keys(g.hunt.species).filter((s) => !SPECIES[s].protected);
    const ground = kinds.find((s) => SPECIES[s].behaviour === 'ground');
    if (ground && !kinds.some((s) => SPECIES[s].behaviour === 'flyover')) return gt('oWalk', { sp: birdName(ground, true) });
    return this.tags.size ? gt('oWait') : gt('oSpot');
  }
}

function bar(el, v) {
  const w = Math.round(v * 100);
  if (el._w === w) return;
  el._w = w;
  el.style.width = `${w}%`;
  el.style.background = v < 0.35 ? '#8fd16a' : v < 0.7 ? '#e2c23b' : '#e5674a';
}

// A bird's velocity: the host's own, or (on a joining hunter's machine) from
// the last two snapshots.
function velOf(b) {
  const s = b.samples;
  if (b.renderPos && s && s.length >= 2) {
    const a = s[s.length - 2];
    const c = s[s.length - 1];
    const dt = c.t - a.t || 0.1;
    return _f.set((c.x - a.x) / dt, (c.y - a.y) / dt, (c.z - a.z) / dt);
  }
  return b.vel;
}
