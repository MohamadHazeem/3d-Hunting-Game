import { SPECIES, GAME_SPECIES } from '../config/species.js';

const $ = (id) => document.getElementById(id);

export class HUD {
  constructor() {
    this.el = $('hud');
    this.feed = $('feed');
    this.compass = $('compass');
    this.cctx = this.compass.getContext('2d');
    this.hit = $('hitmarker');
    this.hitTimer = 0;
    $('binoc').innerHTML = `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
      <defs><mask id="bm"><rect width="100" height="100" fill="white"/>
      <circle cx="37" cy="50" r="21" fill="black"/><circle cx="63" cy="50" r="21" fill="black"/></mask>
      <radialGradient id="bg"><stop offset="80%" stop-color="black" stop-opacity="0"/><stop offset="100%" stop-color="black" stop-opacity="0.7"/></radialGradient></defs>
      <rect width="100" height="100" fill="black" mask="url(#bm)"/>
      <circle cx="37" cy="50" r="21" fill="url(#bg)"/><circle cx="63" cy="50" r="21" fill="url(#bg)"/>
      <line x1="50" y1="46" x2="50" y2="54" stroke="rgba(255,255,255,0.35)" stroke-width="0.15"/>
      <line x1="46" y1="50" x2="54" y2="50" stroke="rgba(255,255,255,0.35)" stroke-width="0.15"/></svg>`;
  }

  show(on) {
    this.el.classList.toggle('hidden', !on);
  }

  message(html, kind = 'info') {
    const d = document.createElement('div');
    d.className = `msg ${kind}`;
    d.innerHTML = html;
    this.feed.prepend(d);
    while (this.feed.children.length > 5) this.feed.lastChild.remove();
    setTimeout(() => d.remove(), 4200);
  }

  chat(from, text) {
    const d = document.createElement('div');
    d.innerHTML = `<b style="color:#e2a23b">${esc(from)}:</b> ${esc(text)}`;
    $('chatLog').append(d);
    while ($('chatLog').children.length > 8) $('chatLog').firstChild.remove();
    setTimeout(() => d.remove(), 12000);
  }

  hitMarker(kill) {
    this.hit.classList.remove('show', 'kill');
    void this.hit.offsetWidth;
    this.hit.classList.add('show');
    if (kill) this.hit.classList.add('kill');
    clearTimeout(this.hitTimer);
    this.hitTimer = setTimeout(() => this.hit.classList.remove('show'), 120);
  }

  setAmmo(loaded, reserve, reloading) {
    $('sh0').classList.toggle('empty', !loaded[0]);
    $('sh1').classList.toggle('empty', !loaded[1]);
    $('reserve').textContent = reloading ? 'reloading…' : `${reserve} shells`;
  }

  setBag(bag, score) {
    const rows = GAME_SPECIES.filter((s) => bag[s] || 0)
      .map((s) => `<div class="row-b"><span><span class="ar">${SPECIES[s].ar}</span> ${SPECIES[s].en}</span><b>${bag[s]}</b></div>`)
      .join('');
    $('bag').innerHTML = `<div class="title">Game bag · الجعبة</div>${rows || '<div class="dim" style="color:#b9ae98">empty</div>'}`;
    $('score').innerHTML = `Score <b style="color:#e2a23b">${score}</b>`;
  }

  setClock(hour, hunt) {
    const h = Math.floor(hour);
    const m = Math.floor((hour - h) * 60);
    $('clock').innerHTML = `<b>${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}</b> · ${hunt.month}<br><span class="ar">${hunt.ar}</span>`;
  }

  // Wind: an arrow showing where it blows relative to where you face.
  setWind(fromBearing, speed, yaw) {
    const el = $('wind');
    const rel = fromBearing + Math.PI + yaw; // yaw 0 faces north; turning left is +yaw
    const deg = Math.round((rel * 180) / Math.PI);
    const s = speed.toFixed(0);
    if (this.windDeg === deg && this.windS === s) return;
    this.windDeg = deg;
    this.windS = s;
    el.innerHTML = `<span class="arrow" style="transform:rotate(${deg}deg)">↑</span> wind ${s} m/s`;
  }

  setRoom(code, players) {
    $('room').innerHTML = code ? `Hunt code <b>${code}</b><br>${players} hunter${players === 1 ? '' : 's'}` : '';
  }

  prompt(html) {
    $('prompt').innerHTML = html || '';
  }

  setAim(ads, binocs) {
    $('crosshair').style.opacity = ads || binocs || this.crosshairOn === false ? 0 : 1;
    $('vignette').classList.toggle('on', ads);
    $('binoc').classList.toggle('on', binocs);
  }

  // markers: [{yaw (radians, world), label, color}]
  drawCompass(yaw, markers) {
    const ctx = this.cctx;
    const W = this.compass.width;
    const H = this.compass.height;
    ctx.clearRect(0, 0, W, H);
    const grd = ctx.createLinearGradient(0, 0, W, 0);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(0.2, 'rgba(0,0,0,0.35)');
    grd.addColorStop(0.8, 'rgba(0,0,0,0.35)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 8, W, 26);
    const fov = Math.PI * 0.9;
    // heading: 0 = north (-z). yaw 0 faces -z.
    const heading = -yaw;
    const toX = (ang) => {
      let d = ang - heading;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return W / 2 + (d / fov) * W;
    };
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let deg = 0; deg < 360; deg += 15) {
      const a = (deg * Math.PI) / 180;
      const x = toX(a);
      if (x < 0 || x > W) continue;
      const major = deg % 90 === 0;
      const alpha = 1 - Math.abs(x - W / 2) / (W / 2);
      ctx.globalAlpha = Math.max(0, alpha);
      if (major) {
        ctx.fillStyle = deg === 0 ? '#e2a23b' : '#f3ead8';
        ctx.font = '700 15px Inter';
        ctx.fillText(['N', 'E', 'S', 'W'][deg / 90], x, 21);
      } else if (deg % 45 === 0) {
        ctx.fillStyle = '#b9ae98';
        ctx.font = '600 11px Inter';
        ctx.fillText(['NE', 'SE', 'SW', 'NW'][(deg - 45) / 90], x, 21);
      } else {
        ctx.fillStyle = 'rgba(243,234,216,0.5)';
        ctx.fillRect(x - 0.5, 16, 1, 9);
      }
    }
    ctx.globalAlpha = 1;
    for (const m of markers) {
      const x = toX(m.yaw);
      if (x < 0 || x > W) continue;
      ctx.fillStyle = m.color;
      ctx.beginPath();
      ctx.moveTo(x, 34);
      ctx.lineTo(x - 5, 42);
      ctx.lineTo(x + 5, 42);
      ctx.fill();
      ctx.font = '600 10px Inter';
      ctx.fillText(m.label, x, 4 + 1);
    }
    ctx.fillStyle = '#f3ead8';
    ctx.fillRect(W / 2 - 1, 30, 2, 6);
  }

  scoreboard(show, rows, hunt, shots = []) {
    const el = $('scoreboard');
    el.classList.toggle('hidden', !show);
    if (!show) return;
    const head = GAME_SPECIES.map((s) => `<th title="${SPECIES[s].en}"><span class="ar" style="margin:0">${SPECIES[s].ar}</span></th>`).join('');
    const body = rows
      .map(
        (r) =>
          `<tr><td><b>${esc(r.name)}</b></td>${GAME_SPECIES.map((s) => `<td>${r.bag[s] || 0}</td>`).join('')}<td>${r.hits}/${r.shots}</td><td><b style="color:#e2a23b">${r.score}</b></td></tr>`
      )
      .join('');
    const species = Object.keys(hunt.species)
      .map((s) => `<span class="ar" style="margin:0">${SPECIES[s].ar}</span> ${SPECIES[s].en} — ${SPECIES[s].note}`)
      .join('<br>');
    const log = shots
      .slice()
      .reverse()
      .map((e) => `<div>${e.spId ? `<span class="ar" style="margin:0">${SPECIES[e.spId].ar}</span> ${e.dist.toFixed(0)} m — ` : ''}${e.result === 'kill' ? `down (${e.hits} pellets)` : e.how || 'no bird near the line'}</div>`)
      .join('');
    el.innerHTML = `<table><tr><th>Hunter</th>${head}<th>Hits/Shots</th><th>Score</th></tr>${body}</table>${log ? `<div class="note"><b>Your last shots</b>${log}</div>` : ''}<div class="note">${species}</div>`;
  }

  pause(show, info = '') {
    $('pause').classList.toggle('hidden', !show);
    $('pauseInfo').textContent = info;
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
