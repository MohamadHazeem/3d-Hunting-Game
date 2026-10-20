import * as THREE from 'three';

const loader = new THREE.TextureLoader();
const cache = new Map();
let maxAniso = 8;

export function setMaxAnisotropy(v) {
  maxAniso = v;
}

// Textures live in /public/textures (CC0 photo-scanned materials from Poly Haven).
export function loadTex(name, srgb = false, repeat = true) {
  const key = name + (srgb ? ':s' : '');
  if (cache.has(key)) return cache.get(key);
  const base = import.meta.env.BASE_URL || '/';
  const p = new Promise((resolve) => {
    loader.load(
      `${base}textures/${name}`,
      (tex) => {
        if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
        if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.anisotropy = maxAniso;
        resolve(tex);
      },
      undefined,
      () => {
        // Fall back to a flat texture so the game still runs offline.
        const data = new Uint8Array(srgb ? [150, 140, 110, 255] : [128, 128, 255, 255]);
        const t = new THREE.DataTexture(data, 1, 1);
        t.needsUpdate = true;
        resolve(t);
      }
    );
  });
  cache.set(key, p);
  return p;
}
