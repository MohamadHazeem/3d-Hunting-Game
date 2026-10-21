import { PLAY_RADIUS } from '../world/terrain.js';
import { zoneTitle, zoneHours } from './gameplayText.js';

// The hunting-ground map (M): shaded relief with woods, fields, terraces,
// snow, the track and the house, plus your route, your friends, every bird
// that's down and the need zones you have found (set `zones` and `hour`).

const RES = 360;
const SPAN = PLAY_RADIUS * 2 + 60; // metres across

export class HuntMap {
  constructor(el, terrain, structures) {
    this.el = el;
    this.canvas = el.querySelector('canvas');
    this.canvas.width = this.canvas.height = RES * 2;
    this.ctx = this.canvas.getContext('2d');
    this.base = this.renderBase(terrain, structures);
    this.route = [];
    this.routeT = 0;
  }

  toPx(x, z) {
    return [((x / SPAN) + 0.5) * RES * 2, ((z / SPAN) + 0.5) * RES * 2];
  }

  renderBase(t, structures) {
    const c = document.createElement('canvas');
    c.width = c.height = RES;
    const g = c.getContext('2d');
    const img = g.createImageData(RES, RES);
    const H = new Float32Array(RES * RES);
    const step = SPAN / RES;
    for (let j = 0; j < RES; j++) {
      for (let i = 0; i < RES; i++) H[j * RES + i] = t.height((i + 0.5) * step - SPAN / 2, (j + 0.5) * step - SPAN / 2);
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (const h of H) {
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    for (let j = 0; j < RES; j++) {
      for (let i = 0; i < RES; i++) {
        const x = (i + 0.5) * step - SPAN / 2;
        const z = (j + 0.5) * step - SPAN / 2;
        const h = H[j * RES + i];
        const hx = H[j * RES + Math.min(RES - 1, i + 1)] - H[j * RES + Math.max(0, i - 1)];
        const hz = H[Math.min(RES - 1, j + 1) * RES + i] - H[Math.max(0, j - 1) * RES + i];
        // light from the north-west
        const shade = Math.max(0.35, Math.min(1.25, 0.9 + (-hx - hz) * 0.06));
        const m = t.maskAt(x, z);
        let r = 196, gg = 178, b = 132; // dry ground
        const mix = (k, cr, cg, cb) => {
          r += (cr - r) * k;
          gg += (cg - gg) * k;
          b += (cb - b) * k;
        };
        mix(m.field * 0.6, 214, 190, 128);
        mix(m.terrace * 0.5, 170, 150, 110);
        mix(m.forest * 0.85, 92, 112, 66);
        mix(m.snow, 236, 238, 240);
        if (t.road(x, z) < 2.5) mix(0.8, 150, 120, 84);
        // contour lines every 10 m
        const e = (h - lo) / 10;
        if (Math.abs(e - Math.round(e)) < 0.08 * Math.max(1, Math.hypot(hx, hz) * 0.15)) mix(0.25, 60, 45, 30);
        const outside = Math.hypot(x, z) > PLAY_RADIUS;
        const k = (j * RES + i) * 4;
        img.data[k] = r * shade * (outside ? 0.55 : 1);
        img.data[k + 1] = gg * shade * (outside ? 0.55 : 1);
        img.data[k + 2] = b * shade * (outside ? 0.55 : 1);
        img.data[k + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    if (structures && structures.houseInfo) {
      const { x, z } = structures.houseInfo;
      g.fillStyle = '#a2412c';
      g.fillRect(((x / SPAN) + 0.5) * RES - 3, ((z / SPAN) + 0.5) * RES - 3, 6, 6);
    }
    this.relief = { lo, hi };
    return c;
  }

  // called every frame; cheap unless the map is open
  track(dt, pos) {
    this.routeT -= dt;
    if (this.routeT <= 0) {
      this.routeT = 3;
      const last = this.route[this.route.length - 1];
      if (!last || Math.hypot(last[0] - pos.x, last[1] - pos.z) > 4) this.route.push([pos.x, pos.z]);
    }
  }

  show(on) {
    this.el.classList.toggle('hidden', !on);
    this.open = on;
  }

  // Need zones you've found: a ring with an icon for what the birds do there,
  // the species and the hours; bright while the zone is on.
  drawZones(g, W) {
    const hour = this.hour ?? 12;
    g.textAlign = 'center';
    for (const z of this.zones.list) {
      if (!z.found) continue;
      const [px, pz] = this.toPx(z.x, z.z);
      const R = Math.max(16, (z.r / SPAN) * W);
      const on = this.zones.active(z, hour);
      g.fillStyle = on ? 'rgba(155,226,122,0.28)' : 'rgba(243,234,216,0.12)';
      g.strokeStyle = on ? '#9be27a' : 'rgba(243,234,216,0.6)';
      g.lineWidth = 2;
      g.setLineDash([6, 4]);
      g.beginPath();
      g.arc(px, pz, R, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.setLineDash([]);
      zoneIcon(g, z, px, pz, on ? '#9be27a' : '#f3ead8');
      g.font = '700 15px Inter, Cairo, sans-serif';
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(20,14,8,0.85)';
      const t1 = zoneTitle(z);
      const t2 = zoneHours(z);
      g.strokeText(t1, px, pz + R + 18);
      g.fillStyle = '#f3ead8';
      g.fillText(t1, px, pz + R + 18);
      g.font = '600 13px Inter, Cairo, sans-serif';
      g.strokeText(t2, px, pz + R + 35);
      g.fillStyle = on ? '#9be27a' : '#b9ae98';
      g.fillText(t2, px, pz + R + 35);
    }
  }

  draw({ me, yaw, players, birds, myId, boards }) {
    if (!this.open) return;
    const g = this.ctx;
    const W = RES * 2;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.base, 0, 0, W, W);
    // play boundary
    g.strokeStyle = 'rgba(243,234,216,0.5)';
    g.setLineDash([8, 6]);
    g.lineWidth = 2;
    g.beginPath();
    g.arc(W / 2, W / 2, (PLAY_RADIUS / SPAN) * W, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    // route
    if (this.route.length > 1) {
      g.strokeStyle = 'rgba(226,162,59,0.75)';
      g.lineWidth = 2.5;
      g.beginPath();
      this.route.forEach(([x, z], i) => {
        const [px, pz] = this.toPx(x, z);
        if (i) g.lineTo(px, pz);
        else g.moveTo(px, pz);
      });
      const [mx, mz] = this.toPx(me.x, me.z);
      g.lineTo(mx, mz);
      g.stroke();
    }
    // practice boards
    g.fillStyle = '#f3ead8';
    for (const b of boards) {
      const [px, pz] = this.toPx(b.center.x, b.center.z);
      g.fillRect(px - 3, pz - 3, 6, 6);
    }
    if (this.zones) this.drawZones(g, W);
    // downed birds
    for (const b of birds) {
      if (b.state !== 'dead' && b.state !== 'falling') continue;
      const p = b.renderPos || b.pos;
      const [px, pz] = this.toPx(p.x, p.z);
      g.fillStyle = b.owner === myId ? '#e2a23b' : '#b9ae98';
      g.beginPath();
      g.arc(px, pz, 5, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = '#1a140e';
      g.lineWidth = 1.5;
      g.stroke();
    }
    // friends
    g.font = '600 16px Inter, sans-serif';
    g.textAlign = 'center';
    for (const p of players) {
      if (p.me) continue;
      const [px, pz] = this.toPx(p.pos.x, p.pos.z);
      g.fillStyle = '#8fc0ff';
      g.beginPath();
      g.arc(px, pz, 7, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#f3ead8';
      g.fillText(p.name, px, pz - 12);
    }
    // you: an arrow pointing the way you face (yaw 0 = north, up the map)
    const [mx, mz] = this.toPx(me.x, me.z);
    g.save();
    g.translate(mx, mz);
    g.rotate(-yaw);
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#1a140e';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -14);
    g.lineTo(9, 10);
    g.lineTo(0, 5);
    g.lineTo(-9, 10);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
    // north and scale
    g.fillStyle = '#f3ead8';
    g.font = '800 20px Inter, sans-serif';
    g.fillText('N', W - 30, 34);
    const px100 = (100 / SPAN) * W;
    g.fillRect(24, W - 30, px100, 4);
    g.font = '600 14px Inter, sans-serif';
    g.textAlign = 'left';
    g.fillText('100 m', 24, W - 38);
  }
}

// A small icon for a zone: a leaf (feeding), a moon (roosting), a drop
// (drinking), an arrow (flight line) or grass (cover).
function zoneIcon(g, z, x, y, col) {
  g.save();
  g.translate(x, y);
  g.fillStyle = 'rgba(20,14,8,0.8)';
  g.beginPath();
  g.arc(0, 0, 13, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = col;
  g.strokeStyle = col;
  g.lineWidth = 2.2;
  g.lineCap = 'round';
  g.beginPath();
  if (z.kind === 'roost') {
    g.arc(0, 0, 7, 0.6, Math.PI * 2 - 0.6);
    g.arc(4, 0, 5.5, Math.PI * 2 - 1.2, 1.2, true);
    g.fill();
  } else if (z.kind === 'drink') {
    g.moveTo(0, -8);
    g.quadraticCurveTo(7, 1, 0, 7);
    g.quadraticCurveTo(-7, 1, 0, -8);
    g.fill();
  } else if (z.kind === 'line') {
    g.rotate(z.dir ?? 0);
    g.moveTo(-8, 0);
    g.lineTo(7, 0);
    g.moveTo(2, -5);
    g.lineTo(7, 0);
    g.lineTo(2, 5);
    g.stroke();
  } else if (z.kind === 'ground') {
    for (const dx of [-5, 0, 5]) {
      g.moveTo(dx, 7);
      g.quadraticCurveTo(dx + 1, 0, dx + (dx || 2), -7);
    }
    g.stroke();
  } else {
    g.ellipse(0, 0, 4.5, 8, 0.6, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(20,14,8,0.8)';
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(-4, 5);
    g.lineTo(4, -5);
    g.stroke();
  }
  g.restore();
}
