import * as THREE from 'three';
import { HUNTS, huntById } from './config/hunts.js';
import { SPECIES, GAME_SPECIES } from './config/species.js';
import { Terrain, PLAY_RADIUS } from './world/terrain.js';
import { Vegetation } from './world/vegetation.js';
import { Grass } from './world/grass.js';
import { Structures } from './world/structures.js';
import { Atmosphere } from './world/sky.js';
import { BirdManager } from './birds/birds.js';
import { Player } from './player/player.js';
import { Shotgun, CHOKES } from './player/shotgun.js';
import { PatternBoards } from './player/boards.js';
import { Particles, ShellHulls } from './player/effects.js';
import { Input } from './core/input.js';
import { setMaxAnisotropy } from './core/assets.js';
import { audio, VOLUME_DEFAULTS } from './audio/audio.js';
import { settings, setSetting, onSettingChange, bindSettings } from './core/settings.js';
import { HUD } from './ui/hud.js';
import { Net } from './net/net.js';
import { Avatar } from './net/avatar.js';

const $ = (id) => document.getElementById(id);
const TIME_SCALE = 4; // game seconds per real second

// ---------------------------------------------------------------- menu

settings.hunt = HUNTS[0].id;

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
renderMenu();
setupSettingsPanel();

// ---------------------------------------------------------------- settings

function setupSettingsPanel() {
  const panel = $('settings');
  bindSettings(panel);
  for (const el of panel.querySelectorAll('[data-volume]')) {
    const bus = el.dataset.volume;
    const out = el.parentElement.querySelector('output');
    el.value = audio.vol[bus] ?? VOLUME_DEFAULTS[bus];
    const show = () => (out.textContent = `${Math.round(el.value * 100)}%`);
    show();
    el.addEventListener('input', () => {
      audio.setVolume(bus, parseFloat(el.value));
      show();
    });
  }
  for (const b of panel.querySelectorAll('.tab-btn')) {
    b.onclick = () => {
      for (const x of panel.querySelectorAll('.tab-btn')) x.classList.toggle('sel', x === b);
      for (const t of panel.querySelectorAll('.tab')) t.classList.toggle('hidden', t.dataset.tab !== b.dataset.tab);
    };
  }
  $('btnSettings').onclick = () => openSettings();
  $('btnSettingsClose').onclick = () => closeSettings();
  panel.onclick = (e) => {
    if (e.target === panel) closeSettings();
  };
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.classList.contains('hidden')) closeSettings();
  });
}

function openSettings() {
  $('settings').classList.remove('hidden');
}

function closeSettings() {
  $('settings').classList.add('hidden');
}

onSettingChange((k, v) => {
  if (game) game.applySetting(k, v);
});

// Builds for sandboxed hosts without WebRTC (set VITE_SOLO_ONLY=1) offer solo play only.
if (import.meta.env.VITE_SOLO_ONLY) {
  for (const id of ['btnHost', 'btnJoin', 'joinCode']) $(id).disabled = true;
  $('netStatus').textContent = 'Hunting with friends needs the GitHub Pages version of the game. Solo hunting works here.';
}

function readSettings() {
  setSetting('name', ($('name').value.trim() || 'Hunter ' + Math.floor(Math.random() * 90 + 10)).slice(0, 16));
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
  if (game) game.endHunt();
  else location.reload();
};
$('btnPauseSettings').onclick = (e) => {
  e.stopPropagation();
  openSettings();
};
$('btnSummaryDone').onclick = () => location.reload();

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
    this.shotLog = [];
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
    audio.setWorld((x, z) => terrain.height(x, z));
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
    for (const k of ['sens', 'adsSens', 'invertY', 'fov', 'showFps', 'crosshair']) this.applySetting(k, settings[k]);
    this.gun = new Shotgun(camera, scene, this.world, this.fx, this.hulls);
    this.gun.onShot = (o, d, b) => this.onLocalShot(o, d, b);
    this.gun.onBirdHits = (id, n, imp, dist) => this.onLocalHits(id, n, imp, dist);

    const spawn = this.findSpawn();
    this.player.spawn(spawn.x, spawn.z, spawn.yaw);
    this.boards = new PatternBoards(scene, terrain, veg, this.player.pos, spawn.yaw);
    this.gun.boards = this.boards;
    this.gun.onShotResult = (r) => this.onShotResult(r);
    this.gun.onBoardResult = (res, barrel) => this.onBoardResult(res, barrel);
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

  applySetting(k, v) {
    const p = this.player;
    if (!p) return;
    if (k === 'sens') p.sensitivity = v;
    else if (k === 'adsSens') p.adsSensitivity = v;
    else if (k === 'invertY') p.invertY = v;
    else if (k === 'fov') p.baseFov = v;
    else if (k === 'showFps') $('fps').classList.toggle('hidden', !v);
    else if (k === 'crosshair') this.hud.crosshairOn = v;
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
    audio.setScene({
      month: this.hunt.month,
      kind: this.hunt.terrain.kind,
      village: true,
      church: ['koura', 'chouf', 'free'].includes(this.hunt.id),
    });
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

  // What happened to a shot of yours, once the pellets have passed.
  onShotResult(r) {
    const entry = { hour: this.atmo.hour, barrel: r.barrel, spId: r.spId || null, dist: r.dist || 0, hits: r.hits || 0, result: 'miss', how: '' };
    if (r.target) {
      const sp = SPECIES[r.spId];
      entry.result = r.hits >= sp.toughness ? 'kill' : r.hits > 0 ? 'wound' : 'miss';
      const m = describeMiss(r);
      entry.how = m.text;
      entry.side = m.side;
      entry.vert = m.vert;
      if (settings.shotFeedback && entry.result !== 'kill') {
        const tag = `<span class="ar">${sp.ar}</span> ${r.dist.toFixed(0)} m`;
        if (entry.result === 'wound') this.hud.message(`${tag} · only ${r.hits} pellet${r.hits > 1 ? 's' : ''} struck${m.text ? ' — ' + m.text : ''}`, 'info');
        else this.hud.message(`${tag} · ${m.text || 'missed'}`, 'info');
      }
    }
    this.shotLog.push(entry);
  }

  onBoardResult(res, barrel) {
    for (const b of res) {
      const pct = Math.round((b.inCircle / 400) * 100);
      this.hud.message(`Board at ${b.dist.toFixed(0)} m · ${CHOKES[barrel].name}: ${b.onBoard} pellets on the paper, ${b.inCircle} in the 75 cm circle (${pct}%)`, 'info');
    }
  }

  endHunt() {
    if (this.ended) return;
    this.ended = true;
    this.input.unlock();
    this.hud.pause(false);
    this.hud.show(false);
    this.renderer.setAnimationLoop(null);
    if (this.net) this.net.close();
    $('summaryBody').innerHTML = summaryHtml(this.players.get(this.myId), this.shotLog, this.hunt);
    $('summary').classList.remove('hidden');
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
      if (settings.hitMarker) this.hud.hitMarker(true);
      audio.play('hitConfirm', null, { gain: 0.25 });
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
    if (settings.hitMarker) this.hud.hitMarker(false);
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
      this.boards.update();
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
      this.updateSoundscape(sim);
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
    this.updateFps();
    this.renderer.render(this.scene, this.camera);
    input.endFrame();
  }

  // Ambience follows the hour, the trees around you and the wind.
  updateSoundscape(dt) {
    this.ambT = (this.ambT || 0) - dt;
    if (this.ambT <= 0) {
      this.ambT = 0.5;
      const p = this.player.pos;
      this.treeDensity = Math.min(1, this.veg.treesNear(p.x, p.z, 28).length / 14);
    }
    const t = this.clock.elapsedTime;
    const base = this.hunt.terrain.kind === 'highland' ? 0.75 : this.hunt.terrain.kind === 'plain' ? 0.5 : 0.35;
    const wind = Math.min(1, Math.max(0, base + 0.18 * Math.sin(t * 0.07) + 0.1 * Math.sin(t * 0.23 + 1.7)));
    audio.updateAmbience(dt, { hour: this.atmo.hour, trees: this.treeDensity || 0, wind });
  }

  updateFps() {
    if (!settings.showFps) return;
    const now = performance.now() / 1000;
    this.fpsAcc = (this.fpsAcc || 0) + (now - (this.fpsLast || now));
    this.fpsLast = now;
    this.fpsN = (this.fpsN || 0) + 1;
    if (this.fpsAcc > 0.5) {
      $('fps').textContent = `${Math.round(this.fpsN / this.fpsAcc)} fps · ${((this.fpsAcc / this.fpsN) * 1000).toFixed(1)} ms`;
      this.fpsAcc = 0;
      this.fpsN = 0;
    }
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
      if (d > 220 || !settings.markers) continue;
      const mine = b.owner === this.myId;
      markers.push({ yaw: Math.atan2(p.x - me.x, -(p.z - me.z)), label: `${d.toFixed(0)}m`, color: mine ? '#e2a23b' : '#b9ae98' });
      if (b.state === 'dead' && d < 2.6) near = b;
    }
    hud.drawCompass(this.player.yaw, markers);
    if (near) hud.prompt(`<b>E</b> pick up <span class="ar">${near.sp.ar}</span> ${near.sp.en}`);
    else if (this.boards.boards.length && this.boards.nearFiringPoint(me) && this.clock.elapsedTime < 240) hud.prompt(`Practice boards at ${this.boards.boards.map((b) => b.dist).join(' · ')} m to your right — shoot one to see your pattern`);
    else if (this.player.outOfBounds > 0) hud.prompt('Edge of the hunting ground · حدود منطقة الصيد');
    else if (!gun.canFire && !gun.reloading) hud.prompt('<b>R</b> reload');
    else hud.prompt('');
    const showBoard = this.input.down('Tab');
    if (showBoard !== this.boardShown || (showBoard && Math.random() < 0.05)) {
      this.boardShown = showBoard;
      hud.scoreboard(showBoard, [...this.players.values()], this.hunt, this.shotLog.slice(-6));
    }
  }
}

// ---------------------------------------------------------------- shot feedback

// How a shot went past its bird, in hunters' terms: behind or ahead of a
// crossing bird, over or under, or the pattern on it but too thin.
function describeMiss(r) {
  const crossing = Math.abs(r.lat) > 2.5;
  const tol = Math.max(0.12, r.spread * 0.7);
  const H = Math.abs(r.h);
  const V = Math.abs(r.v);
  const parts = [];
  let side = null;
  let vert = null;
  if (H > tol) {
    if (crossing) side = Math.sign(r.h) === Math.sign(r.lat) ? 'ahead' : 'behind';
    else side = r.h > 0 ? 'right' : 'left';
    parts.push(`${side} by ${H.toFixed(1)} m`);
  }
  if (V > tol) {
    vert = r.v > 0 ? 'over' : 'under';
    parts.push(`${vert} by ${V.toFixed(1)} m`);
  }
  let text = parts.join(', ');
  if (!parts.length) text = r.dist > 42 ? 'pattern was on it, but too thin at this range' : 'pattern was on it — unlucky gap';
  if (r.pelletSpeed < 150 || r.dist > 48) text += ` · at ${r.dist.toFixed(0)} m the pellets are weak`;
  return { text, side, vert };
}

function summaryHtml(me, log, hunt) {
  const bagged = Object.values(me.bag).reduce((a, b) => a + b, 0);
  const atBirds = log.filter((e) => e.spId);
  const kills = atBirds.filter((e) => e.result === 'kill');
  const longest = kills.reduce((m, e) => Math.max(m, e.dist), 0);
  const avg = atBirds.length ? atBirds.reduce((a, e) => a + e.dist, 0) / atBirds.length : 0;
  const pct = log.length ? Math.round((me.hits / log.length) * 100) : 0;
  const stat = (v, l) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`;
  const bagList = GAME_SPECIES.filter((s) => me.bag[s]).map((s) => `<span class="ar">${SPECIES[s].ar}</span> ${me.bag[s]}`).join(' · ');

  // advice from the misses
  const misses = atBirds.filter((e) => e.result !== 'kill');
  const count = (k, v) => misses.filter((e) => e[k] === v).length;
  const behind = count('side', 'behind');
  const ahead = count('side', 'ahead');
  const under = count('vert', 'under');
  const over = count('vert', 'over');
  const far = atBirds.filter((e) => e.dist > 45).length;
  const tips = [];
  if (behind >= 2 && behind > ahead * 1.5) tips.push(`Most misses on crossing birds were <b>behind</b> (${behind} of ${behind + ahead}). Swing through the bird and keep the gun moving as you fire — at 30 m a crossing thrush needs about 1.5 m of lead.`);
  if (ahead >= 2 && ahead > behind * 1.5) tips.push(`You were often <b>ahead</b> of crossing birds (${ahead} times). Give them a little less lead.`);
  if (under >= 2 && under > over * 1.5) tips.push(`Several shots went <b>under</b> (${under}). Rising birds climb as the shot travels — cover them with the barrels.`);
  if (over >= 2 && over > under * 1.5) tips.push(`Several shots went <b>over</b> (${over}). Dropping or landing birds need you to stay underneath them.`);
  if (far >= 2) tips.push(`${far} shots were beyond 45 m, where the pattern is too thin to kill cleanly. Let them come closer.`);
  if (!tips.length) tips.push(atBirds.length ? 'Good shooting — no clear pattern in your misses.' : 'No shots at birds today. Walk slowly, use the binoculars and the whistle to bring flocks in.');

  const rows = log
    .slice(-24)
    .map((e) => {
      const sp = e.spId ? SPECIES[e.spId] : null;
      const hh = Math.floor(e.hour);
      const mm = String(Math.floor((e.hour - hh) * 60)).padStart(2, '0');
      const res = { kill: 'down', wound: 'hit', miss: 'miss' }[e.result];
      return `<tr><td>${hh}:${mm}</td><td>${sp ? `<span class="ar">${sp.ar}</span> ${sp.en}` : '—'}</td><td>${e.dist ? e.dist.toFixed(0) + ' m' : ''}</td><td>${CHOKES[e.barrel].short}</td><td class="res-${e.result}">${res}</td><td>${e.result === 'kill' ? e.hits + ' pellets' : e.how || ''}</td></tr>`;
    })
    .join('');
  return `<div class="stats">${stat(bagged, 'birds in the bag')}${stat(me.score, 'score')}${stat(log.length, 'shots')}${stat(pct + '%', 'birds per shot')}${stat(longest ? longest.toFixed(0) + ' m' : '—', 'longest kill')}${stat(avg ? avg.toFixed(0) + ' m' : '—', 'average shot')}</div>
    ${bagList ? `<p>${bagList}</p>` : ''}
    <div class="advice">${tips.join('<br>')}</div>
    ${rows ? `<table class="shotlog"><tr><th>Time</th><th>Bird</th><th>Range</th><th>Barrel</th><th>Result</th><th>How</th></tr>${rows}</table>` : ''}
    <p class="dim">${hunt.en} · ${hunt.month}</p>`;
}
