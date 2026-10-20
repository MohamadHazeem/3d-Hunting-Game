import * as THREE from 'three';
import { Random } from '../core/rng.js';

// Hand-painted (procedural) leaf-cluster textures with alpha, one per tree
// type. Drawn once on a canvas at startup.

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

function hsl(h, s, l, a = 1) {
  return `hsla(${h},${s}%,${l}%,${a})`;
}

// Canvas alpha is premultiplied, so fully transparent texels are black and
// bleed dark fringes into leaves/grass when mip-mapped. Copy the pixels into a
// DataTexture and fill the transparent texels with the average leaf colour.
export function bleedTexture(c) {
  const W = c.width;
  const H = c.height;
  const src = c.getContext('2d').getImageData(0, 0, W, H).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < src.length; i += 4) {
    if (src[i + 3] > 128) {
      r += src[i]; g += src[i + 1]; b += src[i + 2]; n++;
    }
  }
  r /= n || 1; g /= n || 1; b /= n || 1;
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const si = ((H - 1 - y) * W + x) * 4; // flip rows: canvas is top-down
      const di = (y * W + x) * 4;
      const a = src[si + 3];
      const k = a / 255;
      out[di] = src[si] * k + r * (1 - k);
      out[di + 1] = src[si + 1] * k + g * (1 - k);
      out[di + 2] = src[si + 2] * k + b * (1 - k);
      out[di + 3] = a;
    }
  }
  const t = new THREE.DataTexture(out, W, H, THREE.RGBAFormat);
  t.colorSpace = THREE.SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

function finish(c) {
  return bleedTexture(c);
}

function twig(ctx, x0, y0, x1, y1, w, col) {
  ctx.strokeStyle = col;
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo((x0 + x1) / 2 + (y1 - y0) * 0.1, (y0 + y1) / 2, x1, y1);
  ctx.stroke();
}

function leaf(ctx, x, y, len, wid, ang, fill) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.5, -wid, len, 0);
  ctx.quadraticCurveTo(len * 0.5, wid, 0, 0);
  ctx.fill();
  ctx.restore();
}

// type: olive | oak | pine | juniper | cedar | shrub
export function makeFoliageTexture(type, seed = 1) {
  const S = 512;
  const [c, ctx] = canvas(S);
  const r = new Random(seed);
  ctx.clearRect(0, 0, S, S);
  const cx = S / 2;
  const cy = S / 2;

  if (type === 'olive') {
    // narrow silvery leaves, dark above / pale beneath
    for (let b = 0; b < 9; b++) {
      const a = r.float(0, Math.PI * 2);
      const L = r.float(120, 220);
      const ex = cx + Math.cos(a) * L;
      const ey = cy + Math.sin(a) * L;
      twig(ctx, cx + r.float(-30, 30), cy + r.float(-30, 30), ex, ey, 3, '#4a4234');
      for (let i = 0; i < 26; i++) {
        const t = r.float(0.15, 1);
        const px = cx + (ex - cx) * t + r.float(-14, 14);
        const py = cy + (ey - cy) * t + r.float(-14, 14);
        const under = r.chance(0.35);
        const col = under ? hsl(r.float(70, 90), r.float(10, 18), r.float(62, 72)) : hsl(r.float(75, 95), r.float(18, 28), r.float(26, 38));
        leaf(ctx, px, py, r.float(34, 52), r.float(4, 6), a + r.float(-1.2, 1.2), col);
      }
    }
  } else if (type === 'oak') {
    // Kermes / Palestine oak: small, dense, glossy dark leaves
    for (let i = 0; i < 1500; i++) {
      const ang = r.float(0, Math.PI * 2);
      const rad = Math.sqrt(r.next()) * 230;
      const px = cx + Math.cos(ang) * rad;
      const py = cy + Math.sin(ang) * rad;
      const l = r.float(18, 34);
      const col = hsl(r.float(80, 105), r.float(25, 40), r.float(14, 30) + (1 - rad / 230) * 4);
      leaf(ctx, px, py, l, l * 0.35, r.float(0, Math.PI * 2), col);
    }
    for (let i = 0; i < 260; i++) {
      const ang = r.float(0, Math.PI * 2);
      const rad = Math.sqrt(r.next()) * 220;
      leaf(ctx, cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad, 22, 8, r.float(0, 6.3), hsl(85, 30, 40, 0.9));
    }
  } else if (type === 'pine' || type === 'cedar') {
    // needle tufts radiating from twigs
    const tufts = type === 'pine' ? 34 : 60;
    for (let tIdx = 0; tIdx < tufts; tIdx++) {
      const ang = r.float(0, Math.PI * 2);
      const rad = Math.sqrt(r.next()) * 200;
      const tx = cx + Math.cos(ang) * rad;
      const ty = cy + Math.sin(ang) * rad;
      twig(ctx, cx, cy, tx, ty, 2.2, '#4a3828');
      const n = type === 'pine' ? 46 : 30;
      const len = type === 'pine' ? r.float(40, 64) : r.float(16, 26);
      for (let i = 0; i < n; i++) {
        const a = r.float(0, Math.PI * 2);
        ctx.strokeStyle =
          type === 'pine' ? hsl(r.float(85, 110), r.float(28, 42), r.float(20, 34)) : hsl(r.float(150, 175), r.float(18, 28), r.float(20, 32));
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(tx + Math.cos(a) * len * r.float(0.6, 1), ty + Math.sin(a) * len * r.float(0.6, 1));
        ctx.stroke();
      }
    }
  } else if (type === 'juniper') {
    // scale-like foliage in clumps, blue-grey green, with dark berries
    for (let i = 0; i < 900; i++) {
      const ang = r.float(0, Math.PI * 2);
      const rad = Math.sqrt(r.next()) * 225;
      const px = cx + Math.cos(ang) * rad;
      const py = cy + Math.sin(ang) * rad;
      ctx.fillStyle = hsl(r.float(110, 150), r.float(10, 22), r.float(22, 38));
      ctx.beginPath();
      ctx.ellipse(px, py, r.float(6, 14), r.float(3, 6), r.float(0, 3.14), 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = hsl(250, 18, r.float(22, 36));
      ctx.beginPath();
      ctx.arc(cx + r.float(-200, 200), cy + r.float(-200, 200), r.float(3, 5), 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // shrub: thorny burnet & broom – grey-brown twiggy cushions
    for (let i = 0; i < 1300; i++) {
      const ang = r.float(0, Math.PI * 2);
      const rad = Math.sqrt(r.next()) * 230;
      const px = cx + Math.cos(ang) * rad;
      const py = cy + Math.sin(ang) * rad;
      const brown = r.chance(0.5);
      ctx.fillStyle = brown ? hsl(r.float(25, 40), r.float(18, 30), r.float(22, 40)) : hsl(r.float(70, 95), r.float(15, 30), r.float(25, 38));
      leaf(ctx, px, py, r.float(8, 18), r.float(2, 4), r.float(0, 6.3), ctx.fillStyle);
    }
  }
  // soft radial fade so cards don't show hard edges
  const g = ctx.createRadialGradient(cx, cy, S * 0.3, cx, cy, S * 0.5);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = 'source-over';
  return finish(c);
}

// Dry Mediterranean grass tuft (golden in autumn, greener in winter).
export function makeGrassTexture(tint, dryness, seed = 7) {
  const W = 256;
  const Hh = 256;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = Hh;
  const ctx = c.getContext('2d');
  const r = new Random(seed);
  for (let i = 0; i < 140; i++) {
    const x0 = r.float(20, W - 20);
    const h = r.float(0.45, 1) * Hh * 0.95;
    const bend = r.float(-40, 40);
    const dry = r.next() < dryness;
    const hue = dry ? r.float(36, 48) : r.float(65, 95);
    const sat = dry ? r.float(30, 52) : r.float(30, 45);
    const lig = dry ? r.float(48, 68) : r.float(26, 40);
    ctx.strokeStyle = hsl(hue, sat, lig);
    ctx.lineWidth = r.float(1.2, 3);
    ctx.beginPath();
    ctx.moveTo(x0, Hh);
    ctx.quadraticCurveTo(x0 + bend * 0.3, Hh - h * 0.6, x0 + bend, Hh - h);
    ctx.stroke();
    if (dry && r.chance(0.25)) {
      // seed heads
      ctx.fillStyle = hsl(hue - 4, sat, lig - 8);
      ctx.beginPath();
      ctx.ellipse(x0 + bend, Hh - h, 2.5, 7, bend * 0.01, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return bleedTexture(c);
}
