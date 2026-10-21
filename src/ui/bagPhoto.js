import * as THREE from 'three';
import { SPECIES, GAME_SPECIES } from '../config/species.js';
import { createBirdMesh, poseWings } from '../birds/birdModel.js';
import { buildShotgunModel } from '../player/shotgun.js';
import { loadTex } from '../core/assets.js';

// The end-of-day photo: the bag laid out in rows on a dry-stone wall, with
// the gun across the top and a few spent cartridges, in warm evening light.

export async function renderBagPhoto(bag, w = 720, h = 380) {
  const birds = [];
  for (const id of GAME_SPECIES) for (let i = 0; i < (bag[id] || 0); i++) birds.push(id);
  if (!birds.length) return null;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(w, h);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2a2118);
  scene.add(new THREE.HemisphereLight(0xffe9c8, 0x3a2c1c, 1.1));
  const sun = new THREE.DirectionalLight(0xffd29a, 2.6);
  sun.position.set(-1.2, 2.2, 0.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -1.6, right: 1.6, top: 1, bottom: -1, near: 0.1, far: 6 });
  scene.add(sun);

  // the wall top: flat limestone
  const stone = await loadTex('stacked_stone_wall_diff.jpg', true);
  const tex = stone.clone();
  tex.needsUpdate = true;
  tex.repeat.set(1.6, 1.2);
  const slab = new THREE.Mesh(new THREE.PlaneGeometry(4, 3), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, color: 0xd8d2c4 }));
  slab.rotation.x = -Math.PI / 2;
  slab.receiveShadow = true;
  scene.add(slab);

  // birds in rows, largest first, laid on their sides as hunters lay them
  birds.sort((a, b) => SPECIES[b].length - SPECIES[a].length);
  const cols = Math.min(birds.length > 12 ? 8 : 6, birds.length);
  const rows = Math.ceil(birds.length / cols);
  const colGap = 0.27;
  const rowGap = 0.34;
  birds.forEach((id, i) => {
    const sp = SPECIES[id];
    const m = createBirdMesh(id);
    poseWings(m, 'fold', 0, 1, 0);
    const r = Math.floor(i / cols);
    const c = i % cols;
    const n = Math.min(cols, birds.length - r * cols);
    m.root.position.set((c - (n - 1) / 2) * colGap, sp.length * 0.17, (r - (rows - 1) / 2) * rowGap + 0.08);
    // head towards the camera's top, lying on alternate sides
    m.root.rotation.set(0, Math.PI + (Math.random() - 0.5) * 0.25, (Math.PI / 2) * (i % 2 ? 1 : -1) * 0.92);
    m.root.traverse((o) => {
      if (o.isMesh) o.castShadow = true;
    });
    scene.add(m.root);
  });
  const width = Math.max(1.15, (cols - 1) * colGap + 0.7);
  const depth = (rows - 1) * rowGap + 0.5;

  // the gun lying across the wall above the birds
  const gun = buildShotgunModel({ arms: false }).gun;
  gun.rotation.set(-Math.PI / 2, 0, Math.PI / 2 - 0.05, 'ZXY');
  gun.position.set(0.2, 0.035, -depth / 2 - 0.12);
  gun.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });
  scene.add(gun);
  // a few spent cartridges
  const hullMat = new THREE.MeshStandardMaterial({ color: 0x9a1f1a, roughness: 0.6 });
  const brassMat = new THREE.MeshStandardMaterial({ color: 0xc8a050, metalness: 1, roughness: 0.35 });
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.0105, 0.0105, 0.07, 10), hullMat));
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.0112, 0.0112, 0.014, 10), brassMat);
    b.position.y = -0.035;
    g.add(b);
    g.rotation.set(Math.PI / 2, 0, Math.random() * 3);
    g.position.set(width / 2 - 0.1 + Math.random() * 0.12, 0.012, depth / 2 + Math.random() * 0.1);
    g.traverse((o) => o.isMesh && (o.castShadow = true));
    scene.add(g);
  }

  // frame it: the whole layout, from above and a little in front
  const cam = new THREE.PerspectiveCamera(32, w / h, 0.05, 20);
  const hfov = 2 * Math.atan(Math.tan((16 * Math.PI) / 180) * (w / h));
  const d = Math.max((width / 2 + 0.1) / Math.tan(hfov / 2), (depth / 2 + 0.3) / Math.tan((16 * Math.PI) / 180));
  cam.position.set(0, d * 0.92, d * 0.42);
  cam.lookAt(0, 0, 0);
  Object.assign(sun.shadow.camera, { left: -width, right: width, top: depth + 0.5, bottom: -depth - 0.5 });
  sun.shadow.camera.updateProjectionMatrix();
  renderer.render(scene, cam);
  const url = renderer.domElement.toDataURL('image/jpeg', 0.9);
  renderer.dispose();
  renderer.forceContextLoss();
  return url;
}
