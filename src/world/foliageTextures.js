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

// Fraction of texels whose alpha is at least `ref` (0..255).
function coverage(d, ref) {
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] >= ref) n++;
  return n / (d.length / 4);
}

// Build the mip chain by hand, scaling each level's alpha so the share of
// texels that pass the alpha test stays the same as at full size. Plain mip
// averaging either thins leaves and grass to nothing in the distance or (where
// blades overlap) fuses them into solid pale blocks.
function coverageMips(level0, W, H, ref = 128) {
  const target = coverage(level0, ref);
  const mips = [{ data: level0, width: W, height: H }];
  let src = level0;
  let w = W;
  let h = H;
  while (w > 1 || h > 1) {
    const nw = Math.max(1, w >> 1);
    const nh = Math.max(1, h >> 1);
    const avg = new Uint8Array(nw * nh * 4);
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        const x0 = Math.min(w - 1, x * 2), x1 = Math.min(w - 1, x * 2 + 1);
        const y0 = Math.min(h - 1, y * 2), y1 = Math.min(h - 1, y * 2 + 1);
        const a = (y0 * w + x0) * 4, b = (y0 * w + x1) * 4, c = (y1 * w + x0) * 4, e = (y1 * w + x1) * 4;
        const o = (y * nw + x) * 4;
        for (let k = 0; k < 4; k++) avg[o + k] = (src[a + k] + src[b + k] + src[c + k] + src[e + k] + 2) >> 2;
      }
    }
    // binary-search an alpha scale that restores the original coverage
    let lo = 0.25;
    let hi = 6;
    for (let it = 0; it < 12; it++) {
      const s = (lo + hi) / 2;
      let n = 0;
      for (let i = 3; i < avg.length; i += 4) if (avg[i] * s >= ref) n++;
      if (n / (avg.length / 4) < target) lo = s;
      else hi = s;
    }
    const s = (lo + hi) / 2;
    const out = new Uint8Array(avg);
    for (let i = 3; i < out.length; i += 4) out[i] = Math.min(255, avg[i] * s);
    mips.push({ data: out, width: nw, height: nh });
    src = avg;
    w = nw;
    h = nh;
  }
  return mips;
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
  t.mipmaps = coverageMips(out, W, H);
  t.generateMipmaps = false;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

function finish(c) {
  return bleedTexture(c);
}

// ---------- photographed foliage atlases (public/models/foliage) ----------
// Baked by tools/models/bake_foliage.py from CC0 leaf, twig, needle and grass
// scans: four clusters in a 2x2 grid, each standing on the bottom centre of
// its cell. Colour and coverage come as two files because a canvas loses the
// colour under transparent texels; the two are joined here and given the
// same coverage-preserving mips as the painted textures.

const atlasCache = new Map();

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.decoding = 'async';
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('could not load ' + url));
    im.src = url;
  });
}

function pixels(im) {
  const c = document.createElement('canvas');
  c.width = im.width;
  c.height = im.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(im, 0, 0);
  return ctx.getImageData(0, 0, im.width, im.height).data;
}

// Resolves to a DataTexture, or null when the files can't be had (the caller
// falls back to a painted texture).
export function loadFoliageAtlas(name) {
  if (atlasCache.has(name)) return atlasCache.get(name);
  const base = (import.meta.env.BASE_URL || '/') + 'models/foliage/';
  const p = Promise.all([loadImage(`${base}${name}_c.webp`), loadImage(`${base}${name}_a.png`)])
    .then(([ci, ai]) => {
      const W = ci.width;
      const H = ci.height;
      const col = pixels(ci);
      const alp = pixels(ai);
      const out = new Uint8Array(W * H * 4);
      for (let y = 0; y < H; y++) {
        const si = (H - 1 - y) * W * 4; // flip rows: images are top-down
        const di = y * W * 4;
        for (let x = 0; x < W * 4; x += 4) {
          out[di + x] = col[si + x];
          out[di + x + 1] = col[si + x + 1];
          out[di + x + 2] = col[si + x + 2];
          out[di + x + 3] = alp[si + x];
        }
      }
      const t = new THREE.DataTexture(out, W, H, THREE.RGBAFormat);
      t.colorSpace = THREE.SRGBColorSpace;
      t.mipmaps = coverageMips(out, W, H);
      t.generateMipmaps = false;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.anisotropy = 4;
      t.needsUpdate = true;
      return t;
    })
    .catch((e) => {
      console.warn('foliage atlas', name, e.message);
      return null;
    });
  atlasCache.set(name, p);
  return p;
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
  // A real tuft: blades spring from a narrow clump and fan outwards, so the
  // silhouette is a ragged fan rather than a rectangle. Blades are drawn back
  // to front, darker and shadowed towards the base of the clump.
  const blades = [];
  for (let i = 0; i < 95; i++) {
    const x0 = W / 2 + r.gauss() * W * 0.09;
    const h = (0.35 + 0.65 * Math.pow(r.next(), 0.7)) * Hh * 0.96;
    const lean = (x0 - W / 2) * r.float(1.2, 2.6) + r.float(-30, 30);
    blades.push({ x0, h, lean, w: r.float(1.1, 2.6), dry: r.next() < dryness, k: r.next() });
  }
  blades.sort((a, b) => b.h - a.h); // tall ones behind
  for (const b of blades) {
    const hue = b.dry ? 36 + b.k * 14 : 62 + b.k * 30;
    const sat = b.dry ? 30 + b.k * 22 : 30 + b.k * 16;
    const lig = b.dry ? 46 + b.k * 22 : 24 + b.k * 16;
    const g = ctx.createLinearGradient(0, Hh, 0, Hh - b.h);
    g.addColorStop(0, hsl(hue - 6, sat * 0.8, lig * 0.45));
    g.addColorStop(0.35, hsl(hue, sat, lig * 0.85));
    g.addColorStop(1, hsl(hue + 2, sat, lig));
    ctx.strokeStyle = g;
    ctx.lineWidth = b.w;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(b.x0, Hh);
    ctx.quadraticCurveTo(b.x0 + b.lean * 0.25, Hh - b.h * 0.6, b.x0 + b.lean, Hh - b.h);
    ctx.stroke();
    if (b.dry && b.k > 0.72) {
      // seed heads
      ctx.fillStyle = hsl(hue - 4, sat, lig - 6);
      ctx.beginPath();
      ctx.ellipse(b.x0 + b.lean, Hh - b.h, 2.2, 6.5, b.lean * 0.008, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return bleedTexture(c);
}
