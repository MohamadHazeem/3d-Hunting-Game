import * as THREE from 'three';
import { HUNTS, huntById } from './config/hunts.js';
import { SPECIES } from './config/species.js';
import { Terrain, PLAY_RADIUS } from './world/terrain.js';
import { Vegetation } from './world/vegetation.js';
import { Grass } from './world/grass.js';
import { Structures } from './world/structures.js';
import { Atmosphere } from './world/sky.js';
import { BirdManager } from './birds/birds.js';
import { Player } from './player/player.js';
import { Shotgun } from './player/shotgun.js';
import { Particles, ShellHulls } from './player/effects.js';
import { Input } from './core/input.js';
import { setMaxAnisotropy } from './core/assets.js';
import { audio } from './audio/audio.js';
import { HUD } from './ui/hud.js';
import { Net } from './net/net.js';
import { Avatar } from './net/avatar.js';

const $ = (id) => document.getElementById(id);
const TIME_SCALE = 4; // game seconds per real second

// ---------------------------------------------------------------- menu

const settings = {
  hunt: HUNTS[0].id,
  quality: localGet('quality', 'medium'),
  name: localGet('name', ''),
  sens: parseFloat(localGet('sens', '1')),
};

function localGet(k, d) {
  try {
    return localStorage.getItem('lbh.' + k) ?? d;
  } catch {
    return d;
  }
}
function localSet(k, v) {
  try {
    localStorage.setItem('lbh.' + k, v);
  } catch {}
}

function renderMenu() {
  const el = $('hunts');
  el.innerHTML = '';
  for (const h of HUNTS) {
    const card = document.createElement('div');
    card.className = 'hunt' + (h.id === settings.hunt ? ' sel' : '');
    const chips = Object.keys(h.species)
      .map((s) => `<span class="chip${SPECIES[s].protected ? ' prot' : ''}"><b>${SPECIES[s].ar}</b>${SPECIES[s].en.replace(' (protected)', '')}</span>`)
      .join('');
    card.innerHTML = `<div class="t-ar">${h.ar}</div><div class="t-en">${h.en}</div><div class="t-reg">${h.region}</div>
      <div class="t-when">${h.month} · ${h.monthAr} · ${fmtHour(h.startHour)}</div><div class="t-blurb">${h.blurb}</div><div class="birds">${chips}</div>`;
    card.onclick = () => {
      settings.hunt = h.id;
      renderMenu();
    };
    el.append(card);
  }
}

function fmtHour(h) {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

$('name').value = settings.name;
$('quality').value = settings.quality;
$('sens').value = settings.sens;
renderMenu();

// Builds for sandboxed hosts without WebRTC (set VITE_SOLO_ONLY=1) offer solo play only.
if (import.meta.env.VITE_SOLO_ONLY) {
  for (const id of ['btnHost', 'btnJoin', 'joinCode']) $(id).disabled = true;
  $('netStatus').textContent = 'Hunting with friends needs the GitHub Pages version of the game. Solo hunting works here.';
}

function readSettings() {
  settings.name = ($('name').value.trim() || 'Hunter ' + Math.floor(Math.random() * 90 + 10)).slice(0, 16);
  settings.quality = $('quality').value;
  settings.sens = parseFloat($('sens').value);
  localSet('name', settings.name);
  localSet('quality', settings.quality);
  localSet('sens', settings.sens);
}

$('btnSolo').onclick = async () => {
  readSettings();
  await audio.init();
  start({ mode: 'solo', hunt: huntById(settings.hunt) });
};

$('btnHost').onclick = async () => {
  readSettings();
  await audio.init();
  const net = new Net();
  $('netStatus').textContent = 'Opening a hunt…';
  try {
    const code = await net.host();
    start({ mode: 'host', hunt: huntById(settings.hunt), net, code });
  } catch (e) {
    $('netStatus').textContent = 'Could not open a hunt: ' + (e.message || e.type || e);
  }
};

$('btnJoin').onclick = async () => {
  readSettings();
  const code = $('joinCode').value.trim().toUpperCase();
  if (code.length < 5) {
    $('netStatus').textContent = 'Enter the 5-letter code from your friend.';
    return;
  }
  await audio.init();
  const net = new Net();
  $('netStatus').textContent = 'Connecting…';
  try {
    await net.join(code);
    const welcome = await new Promise((resolve, reject) => {
      net.on('welcome', (m) => resolve(m));
      net.send({ t: 'hello', name: settings.name });
      setTimeout(() => reject(new Error('No answer from host.')), 10000);
    });
    start({ mode: 'join', hunt: huntById(welcome.hunt), net, code, welcome });
  } catch (e) {
    $('netStatus').textContent = e.message || String(e);
  }
};

$('btnQuit').onclick = (e) => {
  e.stopPropagation();
  location.reload();
};

// ---------------------------------------------------------------- game

let game = null;

async function start(opts) {
  $('menu').classList.add('hidden');
  $('loading').classList.remove('hidden');
  game = new Game(opts);
  try {
    await game.build();
  } catch (e) {
    console.error(e);
    $('loadText').textContent = 'Something went wrong: ' + e.message;
    return;
  }
  $('loading').classList.add('hidden');
  game.begin();
}

const nextFrame = () => new Promise((r) => setTimeout(r, 0));

class Game {
  constructor(opts) {
    this.opts = opts;
    this.hunt = opts.hunt;
    this.mode = opts.mode;
    this.net = opts.net || null;
    this.authority = opts.mode !== 'join';
    this.quality = settings.quality;
    this.myId = this.net ? this.net.myId : 'me';
    this.players = new Map();
    this.hud = new HUD();
    this.clock = new THREE.Clock();
    this.netTimer = 0;
    this.whistleCD = 0;
    this.ambientShot = 15;
    this.markers = [];
  }

  progress(p, text) {
    $('loadBar').style.width = `${Math.round(p * 100)}%`;
    if (text) $('loadText').textContent = text;
  }

  async build() {
    const q = this.quality;
    const canvas = $('game');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: q !== 'low', powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, q === 'high' ? 2 : q === 'medium' ? 1.5 : 1));
    renderer.setSize(innerWidth, innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.6;
    renderer.shadowMap.enabled = q !== 'low';
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    setMaxAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 24000);
    scene.add(camera);
    this.camera = camera;

    this.progress(0.02, 'Shaping the mountains…');
    await nextFrame();
    const terrain = new Terrain(this.hunt, q);
    terrain.generate((p) => this.progress(0.02 + p * 0.35));
    this.terrain = terrain;
    this.progress(0.4, 'Laying textures…');
    await nextFrame();
    await terrain.buildMeshes(scene);

    this.progress(0.5, 'Building the stone house…');
    await nextFrame();
    const structures = new Structures(this.hunt, terrain);
    await structures.build(scene);
    this.structures = structures;

    this.progress(0.58, 'Planting olive, oak and pine…');
    await nextFrame();
    const veg = new Vegetation(this.hunt, terrain, q);
    await veg.build(scene, structures.clearing);
    this.veg = veg;

    this.progress(0.82, 'Growing grass…');
    await nextFrame();
    this.grass = new Grass(this.hunt, terrain, q);
    this.grass.build(scene);

    this.atmo = new Atmosphere(renderer, scene, this.hunt, q);
    if (this.opts.welcome) this.atmo.hour = this.opts.welcome.hour;

    this.fx = new Particles(scene);
    this.hulls = new ShellHulls(scene, terrain);
    this.birds = new BirdManager(scene, terrain, veg, this.hunt, this.authority);
    this.world = { terrain, veg, structures, birds: this.birds };

    this.input = new Input(canvas);
    this.player = new Player(camera, this.world, this.input);
    this.player.sensitivity = settings.sens;
    this.gun = new Shotgun(camera, scene, this.world, this.fx, this.hulls);
    this.gun.onShot = (o, d, b) => this.onLocalShot(o, d, b);
    this.gun.onBirdHits = (id, n, imp, dist) => this.onLocalHits(id, n, imp, dist);

    const spawn = this.findSpawn();
    this.player.spawn(spawn.x, spawn.z, spawn.yaw);
    this.addPlayer(this.myId, settings.name, true);

    if (this.authority) this.birds.initialPopulation(this.playerList());
    this.setupNet();

    this.progress(0.95, 'Compiling shaders…');
    await nextFrame();
    // warm up shaders so the first frames don't stutter
    this.player.update(0, false);
    this.atmo.update(0, camera, this.player.pos, 0);
    renderer.compile(scene, camera);
    this.progress(1, 'Ready');

    addEventListener('resize', () => this.resize());
    this.resize();
    this.input.onLockChange = (locked) => {
      this.hud.pause(!locked && !this.chatOpen, this.net ? `Hunt code: ${this.net.code}` : '');
      if (locked) audio.resume();
    };
    $('pause').onclick = () => this.input.lock();
    canvas.onclick = () => {
      if (!this.input.locked && !this.chatOpen) this.input.lock();
    };
    window.__game = this;
  }

  findSpawn() {
    // stand on the dirt track near the middle of the ground, on level footing
    // with a clear view east along the track
    const t = this.terrain;
    let best = null;
    for (let x = -120; x <= 120; x += 6) {
      let bz = 0;
      let bd = Infinity;
      for (let z = -250; z <= 250; z += 1) {
        const d = t.road(x, z);
        if (d < bd) [bd, bz] = [d, z];
      }
      const h0 = t.height(x, bz);
      let rise = 0;
      for (let k = 1; k <= 12; k++) rise = Math.max(rise, t.height(x + k, bz) - h0 - k * 0.15);
      const score = rise + Math.abs(x) * 0.002 + (1 - t.normal(x, bz).y) * 5;
      if (!best || score < best.score) best = { x, z: bz, score };
    }
    return { x: best.x, z: best.z, yaw: -Math.PI / 2 };
  }

  resize() {
    const w = innerWidth;
    const h = innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fx.setViewportHeight(h * this.renderer.getPixelRatio(), this.camera.fov);
  }

  begin() {
    this.hud.show(true);
    this.hud.setRoom(this.net ? this.net.code : null, this.players.size);
    this.updateHudStats();
    this.hud.message(`<span class="ar">${this.hunt.ar}</span> ${this.hunt.en} — ${this.hunt.month}`, 'info');
    const list = Object.keys(this.hunt.species).filter((s) => !SPECIES[s].protected);
    this.hud.message(`Looking for: ${list.map((s) => `<span class="ar">${SPECIES[s].ar}</span>`).join(' ')}`, 'info');
    if (this.mode === 'host') this.hud.message(`Share the code <b style="color:#e2a23b;letter-spacing:.2em">${this.net.code}</b> with your friends`, 'info');
    this.hud.pause(true, this.net ? `Hunt code: ${this.net.code}` : '');
    this.clock.start();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ------------------------------------------------ players & net

  addPlayer(id, name, me = false) {
    if (this.players.has(id)) return this.players.get(id);
    const p = {
      id, name, me,
      pos: me ? this.player.pos : new THREE.Vector3(),
      crouch: false, speed: 0,
      bag: {}, score: 0, shots: 0, hits: 0,
      avatar: me ? null : new Avatar(this.scene, name),
    };
    this.players.set(id, p);
    this.hud.setRoom(this.net ? this.net.code : null, this.players.size);
    return p;
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.avatar) p.avatar.dispose();
    this.players.delete(id);
    this.hud.setRoom(this.net ? this.net.code : null, this.players.size);
    this.hud.message(`${p.name} left the hunt`, 'info');
  }

  playerList() {
    const me = this.players.get(this.myId);
    if (me) {
      me.crouch = this.player.crouch;
      me.speed = this.player.speed;
    }
    return [...this.players.values()];
  }

  scoresMsg() {
    return { t: 'scores', list: [...this.players.values()].map(({ id, name, bag, score, shots, hits }) => ({ id, name, bag, score, shots, hits })) };
  }

  setupNet() {
    const net = this.net;
    if (!net) return;
    if (net.isHost) {
      net.on('hello', (m, from) => {
        this.addPlayer(from, String(m.name || 'Hunter').slice(0, 16));
        net.send({ t: 'welcome', you: from, hunt: this.hunt.id, hour: this.atmo.hour, roster: this.roster() }, from);
        net.broadcast({ t: 'roster', list: this.roster() });
        net.broadcast(this.scoresMsg());
        this.hud.message(`${m.name} joined the hunt`, 'info');
      });
      net.on('leave', (m, from) => {
        this.removePlayer(from);
        net.broadcast({ t: 'roster', list: this.roster() });
      });
      net.on('state', (m, from) => {
        const p = this.players.get(from);
        if (!p) return;
        p.pos.set(m.p[0], m.p[1], m.p[2]);
        p.crouch = m.c;
        p.speed = m.s;
        p.yaw = m.yaw;
        p.pitch = m.pitch;
        p.avatar.push(m);
      });
      net.on('shot', (m, from) => {
        const p = this.players.get(from);
        if (p) p.shots++;
        this.remoteShot(m);
        net.broadcast({ ...m, id: from }, from);
        this.birds.gunshot(new THREE.Vector3(...m.o), from);
      });
      net.on('hit', (m, from) => {
        this.birds.applyHits(m.bird, m.n, from, new THREE.Vector3(...m.imp));
        const p = this.players.get(from);
        if (p) p.lastDist = m.dist;
      });
      net.on('pickup', (m, from) => this.doPickup(m.bird, from));
      net.on('whistle', (m, from) => {
        const pos = new THREE.Vector3(...m.p);
        audio.play('whistle', pos, { gain: 0.9, ref: 6 });
        this.birds.whistle(pos);
        net.broadcast(m, from);
      });
      net.on('chat', (m, from) => {
        const p = this.players.get(from);
        const msg = { t: 'chat', from: p ? p.name : '?', text: String(m.text).slice(0, 120) };
        this.hud.chat(msg.from, msg.text);
        net.broadcast(msg, from);
      });
    } else {
      net.on('roster', (m) => this.applyRoster(m.list));
      net.on('players', (m) => {
        for (const s of m.list) {
          if (s.id === this.myId) continue;
          const p = this.players.get(s.id);
          if (p && p.avatar) {
            p.avatar.push(s);
            p.pos.set(s.p[0], s.p[1], s.p[2]);
          }
        }
      });
      net.on('birds', (m) => this.birds.applySnapshot(m.list, m.ts));
      net.on('shot', (m) => this.remoteShot(m));
      net.on('kill', (m) => this.onKillEvent(m));
      net.on('wound', (m) => this.onWoundEvent(m));
      net.on('picked', (m) => this.onPicked(m));
      net.on('scores', (m) => {
        for (const s of m.list) {
          const p = this.players.get(s.id);
          if (p) Object.assign(p, { bag: s.bag, score: s.score, shots: s.shots, hits: s.hits });
        }
        this.updateHudStats();
      });
      net.on('whistle', (m) => audio.play('whistle', new THREE.Vector3(...m.p), { gain: 0.9, ref: 6 }));
      net.on('chat', (m) => this.hud.chat(m.from, m.text));
      net.on('hour', (m) => (this.atmo.hour = m.hour));
      net.on('hostLost', () => {
        this.hud.message('The host ended the hunt.', 'warn');
        this.hud.pause(true, 'Connection to host lost');
      });
      this.applyRoster(this.opts.welcome.roster);
    }
  }

  roster() {
    return [...this.players.values()].map((p) => ({ id: p.id, name: p.name }));
  }

  applyRoster(list) {
    const ids = new Set(list.map((r) => r.id));
    for (const r of list) if (r.id !== this.myId && !this.players.has(r.id)) {
      this.addPlayer(r.id, r.name);
      this.hud.message(`${r.name} is hunting with you`, 'info');
    }
    for (const id of [...this.players.keys()]) if (id !== this.myId && !ids.has(id)) this.removePlayer(id);
  }

  netTick() {
    const net = this.net;
    if (!net) return;
    const me = this.player;
    const state = {
      p: [+me.pos.x.toFixed(2), +me.pos.y.toFixed(2), +me.pos.z.toFixed(2)],
      yaw: +me.yaw.toFixed(3), pitch: +me.pitch.toFixed(3), c: me.crouch, s: +me.speed.toFixed(1),
    };
    if (net.isHost) {
      const list = [{ id: this.myId, ...state }];
      for (const p of this.players.values()) {
        if (p.me) continue;
        list.push({ id: p.id, p: [p.pos.x, p.pos.y, p.pos.z], yaw: p.yaw || 0, pitch: p.pitch || 0, c: p.crouch, s: p.speed });
      }
      net.broadcast({ t: 'players', list });
      net.broadcast({ t: 'birds', ts: performance.now() / 1000, list: this.birds.snapshot() });
      this.hourSync = (this.hourSync || 0) + 1;
      if (this.hourSync % 50 === 0) net.broadcast({ t: 'hour', hour: this.atmo.hour });
    } else {
      net.send({ t: 'state', ...state });
    }
  }

  // ------------------------------------------------ shooting

  onLocalShot(o, d, b) {
    this.player.addRecoil(0.055);
    const me = this.players.get(this.myId);
    if (this.authority) me.shots++;
    if (this.net) {
      const m = { t: 'shot', id: this.myId, o: o.toArray().map((v) => +v.toFixed(2)), d: d.toArray().map((v) => +v.toFixed(4)), b };
      this.net.broadcast(m);
    }
  }

  remoteShot(m) {
    if (m.id === this.myId) return;
    const o = new THREE.Vector3(...m.o);
    const d = new THREE.Vector3(...m.d);
    this.gun.spawnShot(o, d, m.b || 0, false);
    audio.gunshot(o, false);
    this.fx.smoke(o.clone().addScaledVector(d, 1), d);
  }

  onLocalHits(birdId, n, impulse, dist) {
    this.lastShotDist = dist;
    if (this.authority) {
      this.players.get(this.myId).lastDist = dist;
      this.birds.applyHits(birdId, n, this.myId, impulse);
    } else {
      this.net.send({ t: 'hit', bird: birdId, n, imp: impulse.toArray(), dist });
    }
  }

  // events coming out of the bird simulation (authority only)
  processBirdEvents() {
    for (const e of this.birds.events) {
      if (e.type === 'kill') {
        const shooter = this.players.get(e.by);
        if (shooter) {
          shooter.hits++;
          if (SPECIES[e.spId].protected) shooter.score += SPECIES[e.spId].points;
        }
        const m = { t: 'kill', bird: e.id, by: e.by, sp: e.spId, pos: e.pos.toArray(), dist: shooter ? shooter.lastDist : 0 };
        this.onKillEvent(m, true);
        if (this.net) {
          this.net.broadcast(m);
          this.net.broadcast(this.scoresMsg());
        }
      } else if (e.type === 'wound') {
        const m = { t: 'wound', bird: e.id, by: e.by, sp: e.spId };
        this.onWoundEvent(m);
        if (this.net) this.net.broadcast(m);
      }
    }
    this.birds.events.length = 0;
  }

  onKillEvent(m, local = false) {
    const sp = SPECIES[m.sp];
    if (!local) {
      const b = this.birds.birds.get(m.bird);
      this.birds.feathers.burst(new THREE.Vector3(...m.pos), m.sp, 20);
      if (b) b.owner = m.by;
    }
    if (m.by === this.myId) {
      this.hud.hitMarker(true);
      audio.play('hit', null, { gain: 0.25 });
      const dist = m.dist || this.lastShotDist || 0;
      if (sp.protected) {
        this.hud.message(`<span class="ar">${sp.ar}</span> You shot a protected White Stork! −250 · طير محمي`, 'warn');
      } else {
        this.hud.message(`<span class="ar">${sp.ar}</span> ${sp.en} down — ${dist.toFixed(0)} m`, 'kill');
      }
      this.updateHudStats();
    } else {
      const p = this.players.get(m.by);
      if (p) this.hud.message(`${p.name}: <span class="ar">${sp.ar}</span> ${sp.en}`, 'info');
    }
  }

  onWoundEvent(m) {
    if (m.by !== this.myId) return;
    const sp = SPECIES[m.sp];
    this.hud.hitMarker(false);
    this.hud.message(`Hit the <span class="ar">${sp.ar}</span> — wounded, mark where it drops`, 'info');
  }

  tryPickup() {
    const b = this.birds.nearestDead(this.player.pos, 2.6);
    if (!b) return;
    if (this.authority) this.doPickup(b.id, this.myId);
    else this.net.send({ t: 'pickup', bird: b.id });
  }

  doPickup(birdId, by) {
    const res = this.birds.pickup(birdId);
    if (!res) return;
    const owner = this.players.get(res.owner) || this.players.get(by);
    if (owner && !SPECIES[res.spId].protected) {
      owner.bag[res.spId] = (owner.bag[res.spId] || 0) + 1;
      owner.score += SPECIES[res.spId].points;
    }
    const m = { t: 'picked', bird: birdId, by, owner: owner ? owner.id : by, sp: res.spId };
    this.onPicked(m);
    if (this.net) {
      this.net.broadcast(m);
      this.net.broadcast(this.scoresMsg());
    }
  }

  onPicked(m) {
    if (m.by === this.myId) {
      audio.play('pickup', null, { gain: 0.6 });
      const sp = SPECIES[m.sp];
      const whose = m.owner !== this.myId ? ` (${this.players.get(m.owner)?.name || 'friend'}'s)` : '';
      this.hud.message(`Into the bag: <span class="ar">${sp.ar}</span> ${sp.en}${whose}`, 'kill');
    }
    this.updateHudStats();
  }

  updateHudStats() {
    const me = this.players.get(this.myId);
    if (me) this.hud.setBag(me.bag, me.score);
  }

  whistle() {
    if (this.whistleCD > 0) return;
    this.whistleCD = 3;
    const pos = this.player.camera.position.clone();
    audio.play('whistle', null, { gain: 0.5 });
    if (this.authority) {
      const n = this.birds.whistle(pos);
      if (n) this.hud.message('A flock turns towards your whistle…', 'info');
    }
    if (this.net) this.net.broadcast({ t: 'whistle', p: pos.toArray() });
  }

  // ------------------------------------------------ chat

  openChat() {
    if (!this.net) return;
    this.chatOpen = true;
    this.input.typing = true;
    const inp = $('chatInput');
    inp.classList.remove('hidden');
    inp.value = '';
    inp.focus();
    inp.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = inp.value.trim();
        if (text) {
          this.hud.chat(settings.name, text);
          this.net.broadcast(this.net.isHost ? { t: 'chat', from: settings.name, text } : { t: 'chat', text });
        }
        this.closeChat();
      } else if (e.key === 'Escape') this.closeChat();
    };
  }

  closeChat() {
    this.chatOpen = false;
    this.input.typing = false;
    const inp = $('chatInput');
    inp.blur();
    inp.classList.add('hidden');
    this.input.lock();
  }

  // ------------------------------------------------ loop

  frame() {
    const dt = Math.min(0.05, this.clock.getDelta());
    const locked = this.input.locked;
    const paused = !locked && !this.net && !this.chatOpen;
    const input = this.input;
    const sim = paused ? 0 : dt;

    // look first, then act, so a shot goes exactly where you're looking this frame
    if (sim > 0) this.player.update(sim, locked && !this.chatOpen);
    if (locked && !this.chatOpen) {
      // a click on empty barrels breaks the gun open to reload
      if (input.clicked(0) && !this.player.binocs && !this.gun.trigger() && !this.gun.reloading && !this.gun.canFire) this.gun.reload();
      if (input.pressed('KeyR')) this.gun.reload();
      if (input.pressed('KeyE')) this.tryPickup();
      if (input.pressed('KeyB')) this.player.binocs = !this.player.binocs;
      if (input.pressed('KeyQ')) this.whistle();
      if (input.pressed('Enter')) this.openChat();
    }
    this.whistleCD -= dt;

    if (sim > 0) {
      this.gun.update(sim, this.player, input);
      const elev = this.atmo.update(sim, this.camera, this.player.pos, this.atmo.hour < this.atmo.month.set + 0.25 ? TIME_SCALE : 0);
      this.birds.update(sim, this.playerList(), this.atmo.hour);
      if (this.authority) this.processBirdEvents();
      this.veg.update(sim);
      this.terrain.update(sim);
      this.fx.update(sim);
      this.hulls.update(sim);
      for (const p of this.players.values()) if (p.avatar) p.avatar.update(sim);
      this.grass.update(this.player.pos);
      // Lebanese hunting soundscape: other hunters' shots far across the valley
      this.ambientShot -= sim;
      if (this.ambientShot <= 0) {
        const dawn = Math.exp(-(((this.atmo.hour - 7) / 1.5) ** 2));
        this.ambientShot = 8 + Math.random() * 30 * (1.4 - dawn);
        audio.distantShot();
      }
      if (elev < 4 && this.atmo.hour > 12 && !this.duskWarned) {
        this.duskWarned = true;
        this.hud.message('The light is fading — last chances of the day', 'info');
      }
    }

    this.netTimer -= dt;
    if (this.net && this.netTimer <= 0) {
      this.netTimer = 0.1;
      this.netTick();
    }

    audio.setListener(this.camera);
    this.updateHud();
    this.renderer.render(this.scene, this.camera);
    input.endFrame();
  }

  updateHud() {
    const hud = this.hud;
    const gun = this.gun;
    hud.setAmmo(gun.loaded, gun.reserve, !!gun.reloading);
    hud.setAim(this.player.ads && gun.ads > 0.6, this.player.binocs);
    hud.setClock(this.atmo.hour, this.hunt);
    // markers for downed birds
    const markers = [];
    const me = this.player.pos;
    let near = null;
    for (const b of this.birds.birds.values()) {
      if (b.state !== 'dead' && b.state !== 'falling') continue;
      const p = b.renderPos || b.pos;
      const d = Math.hypot(p.x - me.x, p.z - me.z);
      if (d > 220) continue;
      const mine = b.owner === this.myId;
      markers.push({ yaw: Math.atan2(p.x - me.x, -(p.z - me.z)), label: `${d.toFixed(0)}m`, color: mine ? '#e2a23b' : '#b9ae98' });
      if (b.state === 'dead' && d < 2.6) near = b;
    }
    hud.drawCompass(this.player.yaw, markers);
    if (near) hud.prompt(`<b>E</b> pick up <span class="ar">${near.sp.ar}</span> ${near.sp.en}`);
    else if (this.player.outOfBounds > 0) hud.prompt('Edge of the hunting ground · حدود منطقة الصيد');
    else if (!gun.canFire && !gun.reloading) hud.prompt('<b>R</b> reload');
    else hud.prompt('');
    const showBoard = this.input.down('Tab');
    if (showBoard !== this.boardShown || (showBoard && Math.random() < 0.05)) {
      this.boardShown = showBoard;
      hud.scoreboard(showBoard, [...this.players.values()], this.hunt);
    }
  }
}
