import * as THREE from 'three';
import { HUNTS, huntById } from './config/hunts.js';
import { SPECIES, GAME_SPECIES } from './config/species.js';
import { Terrain, PLAY_RADIUS } from './world/terrain.js';
import { Vegetation, windUniforms } from './world/vegetation.js';
import { Wind } from './core/wind.js';
import { Grass } from './world/grass.js';
import { Structures } from './world/structures.js';
import { Atmosphere } from './world/sky.js';
import { BirdManager } from './birds/birds.js';
import { Player } from './player/player.js';
import { Shotgun, CHOKES, CHOKE_TYPES, SHOT_SIZES, fitChokes } from './player/shotgun.js';
import { PatternBoards } from './player/boards.js';
import { Dog } from './dog/dog.js';
import { Particles, ShellHulls } from './player/effects.js';
import { Input } from './core/input.js';
import { setMaxAnisotropy } from './core/assets.js';
import { resolveQuality, tierSettings, gfxSettings, setRenderScale, getQualityInfo } from './gfx/quality.js';
import { GfxPipeline } from './gfx/pipeline.js';
import { audio, VOLUME_DEFAULTS } from './audio/audio.js';
import { Companion } from './audio/companion.js';
import { settings, setSetting, onSettingChange, bindSettings } from './core/settings.js';
import { ChallengeTracker, challengeListHtml, CHALLENGES } from './core/challenges.js';
import { t, num, isAr, applyI18n, setLang } from './core/i18n.js';
import { HUD } from './ui/hud.js';
import { HuntMap } from './ui/map.js';
import { openGuide } from './ui/guide.js';
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
      .map((s) => `<span class="chip${SPECIES[s].protected ? ' prot' : ''}"><b>${SPECIES[s].ar}</b>${isAr() ? '' : SPECIES[s].en.replace(' (protected)', '')}</span>`)
      .join('');
    const ar = isAr();
    card.innerHTML = `<div class="t-ar">${h.ar}</div>${ar ? '' : `<div class="t-en">${h.en}</div>`}<div class="t-reg">${ar ? h.regionAr : h.region}</div>
      <div class="t-when">${ar ? h.monthAr : `${h.month} · ${h.monthAr}`} · ${num(fmtHour(h.startHour))}</div><div class="t-blurb">${ar ? h.blurbAr : h.blurb}</div><div class="birds">${chips}</div>`;
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
applyI18n();
renderMenu();
$('challenges').innerHTML = challengeListHtml();
for (const b of document.querySelectorAll('.lang-switch button')) {
  b.classList.toggle('sel', b.dataset.lang === settings.lang);
  b.onclick = () => {
    setLang(b.dataset.lang);
    for (const x of document.querySelectorAll('.lang-switch button')) x.classList.toggle('sel', x === b);
    renderMenu();
    $('challenges').innerHTML = challengeListHtml();
  };
}
setupSettingsPanel();

// ---------------------------------------------------------------- settings

function setupSettingsPanel() {
  const panel = $('settings');
  bindSettings(panel);
  bindSettings($('menu'));
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
  const rs = $('renderScale');
  rs.value = gfxSettings.renderScale == null ? '' : String(gfxSettings.renderScale);
  rs.onchange = () => setRenderScale(rs.value === '' ? null : parseFloat(rs.value));
  const q = getQualityInfo();
  $('gfxInfo').textContent = q.tier ? `Running at ${q.tier}${q.requested === 'auto' ? ' (picked automatically)' : ''} · ${q.gpu || 'graphics card unknown'} · ${q.fps || '—'} fps · render scale ${Math.round((q.renderScale || 1) * 100)}%` : '';
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
$('btnRest').onclick = (e) => {
  e.stopPropagation();
  if (game) game.restUntilEvening();
};
$('btnGuide').onclick = () => openGuide($('guide'));
$('btnPauseGuide').onclick = (e) => {
  e.stopPropagation();
  openGuide($('guide'));
};
$('btnGuideClose').onclick = () => $('guide').classList.add('hidden');
$('guide').onclick = (e) => {
  if (e.target === $('guide')) $('guide').classList.add('hidden');
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
    this.shotLog = [];
    this.companion = new Companion();
    this.companion.enabled = settings.companion;
    this.challenges = new ChallengeTracker((c, how) => this.onChallenge(c, how));
  }

  progress(p, text) {
    $('loadBar').style.width = `${Math.round(p * 100)}%`;
    if (text) $('loadText').textContent = text;
  }

  async build() {
    const canvas = $('game');
    // anti-aliasing happens in the post-processing pipeline (MSAA render target)
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.setSize(innerWidth, innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.6;
    // 'auto' becomes a concrete tier here (GPU name + a quick benchmark)
    const q = (this.quality = await resolveQuality(this.quality, renderer));
    renderer.shadowMap.enabled = tierSettings(q).shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    setMaxAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
    this.renderer = renderer;

    const scene = new THREE.Scene();
    this.scene = scene;
    const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 24000);
    scene.add(camera);
    this.camera = camera;
    this.gfx = new GfxPipeline(renderer, scene, camera, q);

    this.progress(0.02, t('load1'));
    await nextFrame();
    const terrain = new Terrain(this.hunt, q);
    terrain.generate((p) => this.progress(0.02 + p * 0.35));
    this.terrain = terrain;
    audio.setWorld((x, z) => terrain.height(x, z));
    this.progress(0.4, t('load2'));
    await nextFrame();
    await terrain.buildMeshes(scene);

    this.progress(0.5, t('load3'));
    await nextFrame();
    const structures = new Structures(this.hunt, terrain);
    await structures.build(scene);
    this.structures = structures;

    this.progress(0.58, t('load4'));
    await nextFrame();
    const veg = new Vegetation(this.hunt, terrain, q);
    await veg.build(scene, structures.clearing);
    this.veg = veg;

    this.progress(0.82, t('load5'));
    await nextFrame();
    this.grass = new Grass(this.hunt, terrain, q);
    this.grass.build(scene);

    this.atmo = new Atmosphere(renderer, scene, this.hunt, q);
    if (this.opts.welcome) this.atmo.hour = this.opts.welcome.hour;

    this.fx = new Particles(scene);
    this.hulls = new ShellHulls(scene, terrain);
    this.birds = new BirdManager(scene, terrain, veg, this.hunt, this.authority);
    this.wind = new Wind(this.hunt);
    const w = this.opts.welcome;
    if (w && w.wind) Object.assign(this.wind, { base: w.wind.base, from: w.wind.from });
    this.setupPassage(w && w.passage);
    this.birds.wind = this.wind.vec;
    this.world = { terrain, veg, structures, birds: this.birds };

    this.input = new Input(canvas);
    this.player = new Player(camera, this.world, this.input);
    for (const k of ['sens', 'adsSens', 'invertY', 'fov', 'showFps', 'crosshair']) this.applySetting(k, settings[k]);
    this.gun = new Shotgun(camera, scene, this.world, this.fx, this.hulls);
    this.gun.onShot = (o, d, b) => this.onLocalShot(o, d, b);
    this.gun.wind = this.wind.vec;
    fitChokes(settings.choke0, settings.choke1);
    this.gun.setShotSize(settings.shotSize);
    this.gun.onBirdHits = (id, n, imp, dist) => this.onLocalHits(id, n, imp, dist);

    const spawn = this.findSpawn();
    this.player.spawn(spawn.x, spawn.z, spawn.yaw);
    this.boards = new PatternBoards(scene, terrain, veg, this.player.pos, spawn.yaw);
    this.gun.boards = this.boards;
    this.gun.onShotResult = (r) => this.onShotResult(r);
    this.gun.onBoardResult = (res, shot) => this.onBoardResult(res, shot);
    if (settings.dog) {
      this.dog = new Dog(scene, this.world, {
        myId: this.myId,
        onFlush: (b, pos) => {
          if (this.authority) this.birds.dogFlush(b.id, pos);
          else this.net.send({ t: 'dogFlush', bird: b.id, p: pos.toArray() });
        },
        onDeliver: (id) => this.deliver(id),
        onPoint: (b) => {
          this.hud.message(t('dogPoint'), 'kill');
          this.companion.onDogPoint();
        },
      });
      this.dog.place(spawn.x + 1.5, spawn.z + 2);
    }
    this.addPlayer(this.myId, settings.name, true);

    if (this.authority) this.birds.initialPopulation(this.playerList());
    this.setupNet();

    this.progress(0.93, t('load6'));
    await nextFrame();
    this.map = new HuntMap($('map'), terrain, structures);
    this.progress(0.95, t('load7'));
    await nextFrame();
    // warm up shaders so the first frames don't stutter
    this.player.update(0, false);
    this.atmo.update(0, camera, this.player.pos, 0);
    renderer.compile(scene, camera);
    this.progress(1, t('ready'));

    addEventListener('resize', () => this.resize());
    this.resize();
    this.input.onLockChange = () => {
      const locked = this.input.engaged;
      this.hud.pause(!locked && !this.chatOpen, this.net ? `Hunt code: ${this.net.code}` : '');
      if (locked) audio.resume();
    };
    $('pause').onclick = () => this.input.lock();
    canvas.onclick = () => {
      if (!this.input.locked && !this.chatOpen) this.input.lock();
    };
    window.__game = this;
    if (import.meta.env.DEV) window.__audio = audio;
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
    else if (k === 'companion' && this.companion) this.companion.enabled = v;
  }

  // How strong the migration is today: some mornings the thrush pour through,
  // others are quiet.
  setupPassage(given) {
    const autumn = ['September', 'October', 'November'].includes(this.hunt.month);
    if (given) this.passage = given;
    else {
      const r = Math.random();
      const kind = r < 0.22 ? 'quiet' : r < 0.78 ? 'normal' : 'big';
      this.passage = { kind, mul: { quiet: 0.45, normal: 1, big: 1.9 }[kind], heading: autumn ? Math.PI + (Math.random() - 0.5) * 0.8 : Math.random() * Math.PI * 2 };
    }
    this.birds.passage = this.passage.mul;
    this.birds.passageHeading = this.passage.heading;
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
    this.gfx.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.fx.setViewportHeight(h * this.renderer.getPixelRatio(), this.camera.fov);
  }

  begin() {
    this.hud.show(true);
    this.hud.setRoom(this.net ? this.net.code : null, this.players.size);
    this.updateHudStats();
    this.hud.message(isAr() ? `<span class="ar">${this.hunt.ar}</span> — ${this.hunt.monthAr}` : `<span class="ar">${this.hunt.ar}</span> ${this.hunt.en} — ${this.hunt.month}`, 'info');
    const list = Object.keys(this.hunt.species).filter((s) => !SPECIES[s].protected);
    this.hud.message(t('lookingFor', { list: list.map((s) => `<span class="ar">${SPECIES[s].ar}</span>`).join(' ') }), 'info');
    const flyers = list.some((s) => SPECIES[s].behaviour === 'flyover');
    if (flyers && this.passage.kind === 'big') this.hud.message(t('bigDay'), 'kill');
    else if (flyers && this.passage.kind === 'quiet') this.hud.message(t('quietDay'), 'info');
    const wn = this.wind.name;
    this.hud.message(t('wind', { dir: wn.en, speed: num(this.wind.speed.toFixed(0)), ar: `<span class="ar">${wn.ar}</span>` }), 'info');
    this.companion.onStart(this.atmo.hour);
    if (this.mode === 'host') this.hud.message(t('shareCode', { code: `<b style="color:#e2a23b;letter-spacing:.2em">${this.net.code}</b>` }), 'info');
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
    if (p.dog) p.dog.dispose();
    this.players.delete(id);
    this.hud.setRoom(this.net ? this.net.code : null, this.players.size);
    this.hud.message(t('left', { name: esc(p.name) }), 'info');
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
        net.send({ t: 'welcome', you: from, hunt: this.hunt.id, hour: this.atmo.hour, roster: this.roster(), wind: { base: this.wind.base, from: this.wind.from }, passage: this.passage }, from);
        net.broadcast({ t: 'roster', list: this.roster() });
        net.broadcast(this.scoresMsg());
        this.hud.message(t('joined', { name: esc(m.name) }), 'info');
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
        p.dg = m.dg;
        this.remoteDog(p, m.dg);
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
      net.on('dogFlush', (m) => this.birds.dogFlush(m.bird, new THREE.Vector3(...m.p)));
      net.on('whistle', (m, from) => {
        const pos = new THREE.Vector3(...m.p);
        audio.play('whistle', pos, { gain: 0.9, ref: 6, rate: 1.8 });
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
            this.remoteDog(p, s.dg);
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
      net.on('whistle', (m) => audio.play('whistle', new THREE.Vector3(...m.p), { gain: 0.9, ref: 6, rate: 1.8 }));
      net.on('chat', (m) => this.hud.chat(m.from, m.text));
      net.on('hour', (m) => (this.atmo.hour = m.hour));
      net.on('hostLost', () => {
        this.hud.message(t('hostEnded'), 'warn');
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
      this.hud.message(t('huntingWith', { name: esc(r.name) }), 'info');
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
      dg: this.dog ? this.dog.netState() : null,
    };
    if (net.isHost) {
      const list = [{ id: this.myId, ...state }];
      for (const p of this.players.values()) {
        if (p.me) continue;
        list.push({ id: p.id, p: [p.pos.x, p.pos.y, p.pos.z], yaw: p.yaw || 0, pitch: p.pitch || 0, c: p.crouch, s: p.speed, dg: p.dg });
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
    this.checkSafety(o, d);
    if (this.net) {
      const m = { t: 'shot', id: this.myId, o: o.toArray().map((v) => +v.toFixed(2)), d: d.toArray().map((v) => +v.toFixed(4)), b };
      this.net.broadcast(m);
    }
  }

  // A real hunter never swings through another hunter or his dog. A shot
  // whose line passes near one costs points.
  checkSafety(o, d) {
    const inLine = (p, chestY, maxD, slack) => {
      const v = new THREE.Vector3(p.x - o.x, p.y + chestY - o.y, p.z - o.z);
      const dist = v.length();
      if (dist > maxD || dist < 1) return false;
      const along = v.dot(d);
      if (along <= 0) return false;
      const off = Math.sqrt(Math.max(0, dist * dist - along * along));
      return off < slack + dist * 0.035;
    };
    for (const p of this.players.values()) {
      if (p.me) continue;
      if (inLine(p.pos, 1.2, 90, 0.6)) {
        const me = this.players.get(this.myId);
        me.score -= 50;
        this.hud.message(t('unsafe', { name: esc(p.name) }), 'warn');
        this.companion.onUnsafe();
        this.updateHudStats();
        if (this.net) this.net.broadcast({ t: 'chat', from: '⚠', text: `${settings.name} fired towards ${p.name}` });
        return;
      }
      if (p.dog && inLine(p.dog.pos, 0.5, 50, 0.4)) {
        this.hud.message(t('unsafeDog', { name: esc(p.name) }), 'warn');
        return;
      }
    }
    if (this.dog && inLine(this.dog.pos, 0.5, 50, 0.4)) this.hud.message(t('unsafeMyDog'), 'warn');
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
    const entry = { hour: this.atmo.hour, time: this.clock.elapsedTime, loadId: this.gun.loadId || 0, barrel: r.barrel, choke: r.choke || CHOKES[r.barrel].short, spId: r.spId || null, dist: r.dist || 0, hits: r.hits || 0, lat: r.lat || 0, along: r.along || 0, result: 'miss', how: '' };
    if (r.target) {
      const sp = SPECIES[r.spId];
      entry.result = r.hits >= sp.toughness ? 'kill' : r.hits > 0 ? 'wound' : 'miss';
      const m = describeMiss(r);
      entry.how = m.text;
      entry.side = m.side;
      entry.vert = m.vert;
      if (settings.shotFeedback && entry.result !== 'kill') {
        const tag = `<span class="ar">${sp.ar}</span> ${num(r.dist.toFixed(0))} ${isAr() ? 'م' : 'm'}`;
        if (entry.result === 'wound') this.hud.message(t('onlyPellets', { tag, n: num(r.hits), how: m.text ? ' — ' + m.text : '' }), 'info');
        else this.hud.message(`${tag} · ${m.text || t('missed')}`, 'info');
      }
    }
    this.shotLog.push(entry);
    const before = this.challenges.thisHunt.length;
    this.challenges.onShot(this.shotLog, entry);
    const prev = this.shotLog[this.shotLog.length - 2];
    const double = entry.result === 'kill' && prev && prev.result === 'kill' && prev.loadId === entry.loadId && prev.barrel !== entry.barrel && entry.time - prev.time < 6;
    this.companion.onShot(entry, double || (this.challenges.thisHunt.length > before && this.challenges.thisHunt.at(-1) === 'rightLeft'));
  }

  onChallenge(c, how) {
    const me = this.players.get(this.myId);
    if (how.daily) me.score += 50;
    const title = isAr() ? `<b>${c.ar}</b>` : `<b>${c.en}</b> <span class="ar">${c.ar}</span>`;
    this.hud.message(t(how.daily ? 'challengeDaily' : 'challenge', { title }), 'kill');
    audio.play('hitConfirm', null, { gain: 0.3, rate: 1.5 });
    this.updateHudStats();
    if (this.net) this.net.broadcast(this.scoresMsg());
  }

  onBoardResult(res, shot) {
    for (const b of res) {
      const pct = Math.round((b.inCircle / shot.spec.pellets) * 100);
      this.hud.message(t('board', { d: num(b.dist.toFixed(0)), choke: shot.choke.name, shot: shot.spec.name, on: num(b.onBoard), in: num(b.inCircle), pct: num(pct) }), 'info');
    }
  }

  // Skip the midday lull: the hunter sits under an olive tree until the
  // evening flight (host or solo only; clients follow the host's clock).
  restUntilEvening() {
    if (!this.authority) return;
    const evening = Math.max(this.atmo.hour, this.atmo.month.set - 2.2);
    if (evening <= this.atmo.hour + 0.25) return;
    this.atmo.hour = evening;
    if (this.net) this.net.broadcast({ t: 'hour', hour: this.atmo.hour });
    this.hud.message(t('rested'), 'info');
    this.input.lock();
  }

  endHunt() {
    if (this.ended) return;
    this.ended = true;
    this.input.unlock();
    this.hud.pause(false);
    this.hud.show(false);
    this.renderer.setAnimationLoop(null);
    if (this.net) this.net.close();
    this.challenges.onEnd(this.players.get(this.myId), this.shotLog);
    $('summaryBody').innerHTML = summaryHtml(this.players.get(this.myId), this.shotLog, this.hunt, this.challenges.thisHunt);
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
      } else if (e.type === 'flush') {
        const b = this.birds.birds.get(e.id);
        if (b) this.companion.onFlush(e.spId, b.pos.distanceTo(this.player.pos));
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
        this.hud.message(t('stork', { ar: `<span class="ar">${sp.ar}</span>` }), 'warn');
        this.companion.onStork();
      } else {
        this.hud.message(t('down', { ar: `<span class="ar">${sp.ar}</span>`, en: sp.en, d: num(dist.toFixed(0)) }), 'kill');
      }
      this.updateHudStats();
    } else {
      const p = this.players.get(m.by);
      if (p) this.hud.message(t('friendDown', { name: esc(p.name), ar: `<span class="ar">${sp.ar}</span>`, en: sp.en }), 'info');
    }
  }

  onWoundEvent(m) {
    if (m.by !== this.myId) return;
    const sp = SPECIES[m.sp];
    if (settings.hitMarker) this.hud.hitMarker(false);
    this.hud.message(t('wounded', { ar: `<span class="ar">${sp.ar}</span>` }), 'info');
  }

  // Another hunter's dog, drawn from what they send.
  remoteDog(p, dg) {
    if (!dg) return;
    if (!p.dog) p.dog = new Dog(this.scene, this.world, { remote: true, seed: p.id.length * 7 + 3 });
    p.dog.applyRemote(dg);
  }

  // The dog has brought a bird back to us.
  deliver(birdId) {
    if (this.authority) this.doPickup(birdId, this.myId);
    else this.net.send({ t: 'pickup', bird: birdId });
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
      const whose = m.owner !== this.myId ? ` (${esc(this.players.get(m.owner)?.name || '…')})` : '';
      this.hud.message(t('intoBag', { ar: `<span class="ar">${sp.ar}</span>`, en: sp.en, whose }), 'kill');
      this.challenges.onBag(this.players.get(this.myId).bag);
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
    audio.play('whistle', null, { gain: 0.5, rate: 1.8 });
    if (this.authority) {
      const n = this.birds.whistle(pos);
      if (n) this.hud.message(t('whistleFlock'), 'info');
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
    this.input.pollGamepad(dt);
    const locked = this.input.engaged;
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
      if (input.pressed('KeyM')) this.map.show(!this.map.open);
      if (input.pressed('KeyF') && this.dog) {
        const r = this.dog.command();
        this.hud.message(t(r === 'flush' ? 'dogGo' : r === 'heel' ? 'dogHeel' : 'dogHunt'), 'info');
      }
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
      this.map.track(sim, this.player.pos);
      this.hulls.update(sim);
      for (const p of this.players.values()) {
        if (p.avatar) p.avatar.update(sim);
        if (p.dog) p.dog.update(sim);
      }
      if (this.dog) this.dog.update(sim, this.player, this.wind.vec);
      this.grass.update(this.player.pos);
      // Lebanese hunting soundscape: other hunters' shots far across the valley
      this.ambientShot -= sim;
      if (this.ambientShot <= 0) {
        const dawn = Math.exp(-(((this.atmo.hour - 7) / 1.5) ** 2));
        this.ambientShot = 8 + Math.random() * 30 * (1.4 - dawn);
        audio.distantShot();
      }
      this.wind.update(sim);
      this.companion.update(sim, this);
      windUniforms.uWind.value = 0.35 + this.wind.speed / 5;
      this.updateSoundscape(sim);
      if (elev < 4 && this.atmo.hour > 12 && !this.duskWarned) {
        this.duskWarned = true;
        this.hud.message(t('fading'), 'info');
        this.companion.onDusk();
      }
      // after dark the hunt is over
      if (this.atmo.hour >= this.atmo.month.set + 0.24) {
        this.nightT = (this.nightT || 0) + sim;
        if (this.nightT > 45 && !this.ended) {
          this.hud.message(t('nightfall'), 'warn');
          setTimeout(() => this.endHunt(), 3500);
          this.nightT = -1e9;
        }
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
    this.gfx.render(this);
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
    audio.updateAmbience(dt, { hour: this.atmo.hour, trees: this.treeDensity || 0, wind: Math.min(1, 0.15 + this.wind.speed / 8) });
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
    const canRest = this.authority && this.atmo.hour > 10.3 && this.atmo.hour < this.atmo.month.set - 2.5;
    $('btnRest').classList.toggle('hidden', !canRest);
    hud.setWind(this.wind.from, this.wind.speed, this.player.yaw);
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
    if (this.dog && this.dog.state === 'point' && settings.markers) {
      const p = this.dog.pos;
      const d = Math.hypot(p.x - me.x, p.z - me.z);
      markers.push({ yaw: Math.atan2(p.x - me.x, -(p.z - me.z)), label: `dog ${d.toFixed(0)}m`, color: '#ffffff' });
    }
    hud.drawCompass(this.player.yaw, markers);
    if (this.map.open) {
      this.map.draw({ me, yaw: this.player.yaw, players: [...this.players.values()], birds: this.birds.birds.values(), myId: this.myId, boards: this.boards.boards });
    }
    if (near) hud.prompt(t('pickUp', { ar: `<span class="ar">${near.sp.ar}</span>`, en: near.sp.en }));
    else if (this.boards.boards.length && this.boards.nearFiringPoint(me) && this.clock.elapsedTime < 240) hud.prompt(t('boardsPrompt', { list: this.boards.boards.map((b) => num(b.dist)).join(' · ') }));
    else if (this.player.outOfBounds > 0) hud.prompt(t('edge'));
    else if (!gun.canFire && !gun.reloading) hud.prompt(t('reload'));
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
    parts.push(t({ ahead: 'ahead', behind: 'behind', left: 'leftBy', right: 'rightBy' }[side], { m: num(H.toFixed(1)) }));
  }
  if (V > tol) {
    vert = r.v > 0 ? 'over' : 'under';
    parts.push(t(vert, { m: num(V.toFixed(1)) }));
  }
  let text = parts.join(isAr() ? '، ' : ', ');
  if (!parts.length) text = t(r.dist > 42 ? 'thin' : 'unlucky');
  if (r.pelletSpeed < 150 || r.dist > 48) text += t('weak', { d: num(r.dist.toFixed(0)) });
  return { text, side, vert };
}

function summaryHtml(me, log, hunt, challengesDone = []) {
  const bagged = Object.values(me.bag).reduce((a, b) => a + b, 0);
  const atBirds = log.filter((e) => e.spId);
  const kills = atBirds.filter((e) => e.result === 'kill');
  const longest = kills.reduce((m, e) => Math.max(m, e.dist), 0);
  const avg = atBirds.length ? atBirds.reduce((a, e) => a + e.dist, 0) / atBirds.length : 0;
  const pct = log.length ? Math.round((me.hits / log.length) * 100) : 0;
  const stat = (v, l) => `<div class="stat"><b>${num(v)}</b><span>${l}</span></div>`;
  const bagList = GAME_SPECIES.filter((s) => me.bag[s]).map((s) => `<span class="ar">${SPECIES[s].ar}</span> ${num(me.bag[s])}`).join(' · ');

  // advice from the misses
  const misses = atBirds.filter((e) => e.result !== 'kill');
  const count = (k, v) => misses.filter((e) => e[k] === v).length;
  const behind = count('side', 'behind');
  const ahead = count('side', 'ahead');
  const under = count('vert', 'under');
  const over = count('vert', 'over');
  const far = atBirds.filter((e) => e.dist > 45).length;
  const tips = [];
  if (behind >= 2 && behind > ahead * 1.5) tips.push(t('tipBehind', { n: num(behind), of: num(behind + ahead) }));
  if (ahead >= 2 && ahead > behind * 1.5) tips.push(t('tipAhead', { n: num(ahead) }));
  if (under >= 2 && under > over * 1.5) tips.push(t('tipUnder', { n: num(under) }));
  if (over >= 2 && over > under * 1.5) tips.push(t('tipOver', { n: num(over) }));
  if (far >= 2) tips.push(t('tipFar', { n: num(far) }));
  if (!tips.length) tips.push(t(atBirds.length ? 'tipGood' : 'tipNone'));

  const rows = log
    .slice(-24)
    .map((e) => {
      const sp = e.spId ? SPECIES[e.spId] : null;
      const hh = Math.floor(e.hour);
      const mm = String(Math.floor((e.hour - hh) * 60)).padStart(2, '0');
      const res = t({ kill: 'resDown', wound: 'resHit', miss: 'resMiss' }[e.result]);
      const bird = sp ? (isAr() ? `<span class="ar">${sp.ar}</span>` : `<span class="ar">${sp.ar}</span> ${sp.en}`) : '—';
      return `<tr><td>${num(hh)}:${num(mm)}</td><td>${bird}</td><td>${e.dist ? num(e.dist.toFixed(0)) + (isAr() ? ' م' : ' m') : ''}</td><td>${e.choke}</td><td class="res-${e.result}">${res}</td><td>${e.result === 'kill' ? t('pellets', { n: num(e.hits) }) : e.how || ''}</td></tr>`;
    })
    .join('');
  const m = isAr() ? ' م' : ' m';
  return `<div class="stats">${stat(bagged, t('stBag'))}${stat(me.score, t('stScore'))}${stat(log.length, t('stShots'))}${stat(pct + '%', t('stRate'))}${stat(longest ? longest.toFixed(0) + m : '—', t('stLongest'))}${stat(avg ? avg.toFixed(0) + m : '—', t('stAvg'))}</div>
    ${bagList ? `<p>${bagList}</p>` : ''}
    ${challengesDone.length ? `<div class="advice">${t('challengesDone')}: ${challengesDone.map((id) => { const c = CHALLENGES.find((x) => x.id === id); return isAr() ? `<b>${c.ar}</b>` : `<b>${c.en}</b> <span class="ar">${c.ar}</span>`; }).join(' · ')}</div>` : ''}
    <div class="advice">${tips.join('<br>')}</div>
    ${rows ? `<table class="shotlog"><tr><th>${t('thTime')}</th><th>${t('thBird')}</th><th>${t('thRange')}</th><th>${t('thBarrel')}</th><th>${t('thResult')}</th><th>${t('thHow')}</th></tr>${rows}</table>` : ''}
    <p class="dim">${isAr() ? `${hunt.ar} · ${hunt.monthAr}` : `${hunt.en} · ${hunt.month}`}</p>`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
