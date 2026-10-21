// Dev-only tree lab (see treelab.html): lines up every species in each level
// of detail on a flat meadow under a sky-lit sun, for tuning trees.js.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { buildTree, treeLods } from '/src/world/trees.js';
import '/src/world/shading.js';
import { treeMaterial, windUniforms } from '/src/world/foliage.js';
import { loadFoliageAtlas } from '/src/world/foliageTextures.js';
import { loadTex } from '/src/core/assets.js';
import { loadModelTex } from '/src/world/models.js';

const q = new URLSearchParams(location.search);
const species = (q.get('species') || 'olive,oak,pine,juniper,cedar,fir,shrub').split(',');
const rows = [q.get('row') || 'near'];
const hour = parseFloat(q.get('hour') || '9.5');
const dist = parseFloat(q.get('dist') || '34');

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.7;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 5000);

const sky = new Sky();
sky.scale.setScalar(4000);
scene.add(sky);
const el = THREE.MathUtils.degToRad(Math.max(2, 45 * Math.sin((Math.PI * (hour - 6.5)) / 11.5)));
const az = THREE.MathUtils.degToRad(100 + 160 * ((hour - 6.5) / 11.5));
const sunDir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
sky.material.uniforms.sunPosition.value.copy(sunDir);
sky.material.uniforms.turbidity.value = 4;
sky.material.uniforms.rayleigh.value = 1.6;
const pm = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
const envSky = new Sky();
envSky.scale.setScalar(100);
envSky.material.uniforms.sunPosition.value.copy(sunDir);
envScene.add(envSky);
scene.environment = pm.fromScene(envScene).texture;
scene.environmentIntensity = 0.5;

const sun = new THREE.DirectionalLight(0xfff4e8, 3.2);
sun.position.copy(sunDir).multiplyScalar(200);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -90, right: 90, top: 90, bottom: -90, near: 1, far: 600 });
sun.shadow.bias = -0.0003;
sun.shadow.normalBias = 0.35;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xa8c4ff, 0x6b5a40, 0.6));

const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: 0x6f6a45, roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const BARK = {
  olive: ['bark_willow', [3.0, 3.4, 3.9]],
  oak: ['bark_brown_02', [1.5, 1.6, 2.0]],
  pine: ['pine_bark', [1.3, 1.3, 1.3]],
  juniper: ['bark_willow', [2.6, 2.4, 2.4]],
  cedar: ['@bark/fir_bark', [2.2, 2.3, 2.5]],
  fir: ['@bark/fir_bark', [2.0, 2.1, 2.3]],
};

async function bark(t) {
  const [name, color] = BARK[t];
  const [d, n] = name.startsWith('@')
    ? await Promise.all([loadModelTex(name.slice(1) + '_diff.jpg', true), loadModelTex(name.slice(1) + '_nor_gl.jpg')])
    : await Promise.all([loadTex(name + '_diff.jpg', true), loadTex(name + '_nor_gl.jpg')]);
  return treeMaterial('bark', { map: d, normalMap: n, color: new THREE.Color().setRGB(...color) });
}

const spacing = parseFloat(q.get('spacing') || '15');
const x0 = (-(species.length - 1) * spacing) / 2;
const info = {};
for (let i = 0; i < species.length; i++) {
  const t = species[i];
  const atlas = await loadFoliageAtlas(t);
  const leaf = treeMaterial('leaf', { map: atlas, trans: 0.5 });
  const bk = BARK[t] ? await bark(t) : null;
  const tree = buildTree(t, 1771 * 31 + 101 + t.length);
  if (t === 'shrub') for (const c of tree.cards) c.cell = 2 + (c.cell & 1);
  const lods = treeLods(tree, t === 'fir' || t === 'cedar' ? 0.4 : 0.25);
  info[t] = { cards: tree.cards.length, tubes: tree.tubes.length, meta: lods.meta };
  rows.forEach((row, j) => {
    const L = lods[row];
    for (const [geo, mat] of [[L.leaves, leaf], [L.wood, bk]]) {
      if (!geo || !mat) continue;
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x0 + i * spacing, 0, -j * 22);
      m.castShadow = m.receiveShadow = true;
      scene.add(m);
      info[t][row] = (info[t][row] || 0) + geo.index.count / 3;
    }
  });
}
window.__info = info;

camera.position.set(0, parseFloat(q.get('eye') || '2'), dist);
camera.lookAt(0, parseFloat(q.get('look') || '4.5'), 0);
window.__render = (t = 0) => {
  windUniforms.uTime.value = t;
  renderer.render(scene, camera);
};
window.__shot = async (name) => {
  window.__render(0);
  const url = canvas.toDataURL('image/jpeg', 0.9);
  return (await fetch('http://127.0.0.1:5186/save?name=' + name, { method: 'POST', body: url })).text();
};
// look at one species from `d` metres, eye at `eye`, aiming at height `look`
window.__view = (sp, d, look = 4, eye = 1.7) => {
  const x = x0 + species.indexOf(sp) * spacing;
  camera.position.set(x + d * 0.35, eye, d);
  camera.lookAt(x, look, 0);
};
window.__render(0);
window.__ready = true;
