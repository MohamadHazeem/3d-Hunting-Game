import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

// Scanned CC0 models and their textures in /public/models (decimated and
// compressed by tools/models/build_models.mjs; see CREDITS.md there).
// Everything resolves to null when a file can't be had, so the world falls
// back to its procedural stand-ins and still runs offline.

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const texLoader = new THREE.TextureLoader();
const cache = new Map();

export function modelUrl(p) {
  return (import.meta.env.BASE_URL || '/') + 'models/' + p;
}

// The meshes of a .glb, each with its geometry and material, by node name.
export function loadModel(name) {
  const key = 'm:' + name;
  if (cache.has(key)) return cache.get(key);
  const p = loader
    .loadAsync(modelUrl(name + '.glb'))
    .then((gltf) => {
      const meshes = [];
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        // meshopt files are quantised (normalised ints with the scale in the
        // node): back to plain floats before baking the node's transform in
        const g = new THREE.BufferGeometry();
        for (const [k, a] of Object.entries(o.geometry.attributes)) {
          const f = new Float32Array(a.count * a.itemSize);
          const get = [a.getX, a.getY, a.getZ, a.getW];
          for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = get[c].call(a, i);
          g.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize));
        }
        if (o.geometry.index) g.setIndex(Array.from(o.geometry.index.array));
        g.applyMatrix4(o.matrixWorld);
        if (g.attributes.normal) g.normalizeNormals();
        meshes.push({ name: o.name, geometry: g, material: o.material });
      });
      return meshes;
    })
    .catch((e) => {
      console.warn('model', name, e.message || e);
      return null;
    });
  cache.set(key, p);
  return p;
}

export function loadModelTex(path, srgb = false, aniso = 8) {
  const key = 't:' + path + srgb;
  if (cache.has(key)) return cache.get(key);
  const p = texLoader
    .loadAsync(modelUrl(path))
    .then((t) => {
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = aniso;
      return t;
    })
    .catch(() => null);
  cache.set(key, p);
  return p;
}
