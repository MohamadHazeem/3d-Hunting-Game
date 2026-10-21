// Decimate and compress the scanned CC0 models for the web.
//
//   cd tools/models && npm install
//   node tools/models/build_models.mjs <download dir> public/models
//
// For every job: keep only the scanned shape (the scans' UV seams would stop
// the simplifier, and the game textures stone and wood itself, triplanar), weld,
// simplify to a couple of thousand triangles (LOD0) and a couple of hundred
// (LOD1, meshes named *_lod1), recompute normals, bake ambient occlusion into
// the vertex colours (rays against the shape itself and the ground it sits
// in), quantise and meshopt-compress, and write <out>/<name>.glb. Only the
// meshes listed in `keep` are kept (sets like rock_moss_set_01 hold several).

import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weld, prune, dedup, meshopt, mergeDocuments, simplifyPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

const [srcDir, outDir] = process.argv.slice(2);
if (!srcDir || !outDir) {
  console.error('usage: node build_models.mjs <download dir> <public/models>');
  process.exit(1);
}

// tris: [lod0, lod1] targets per mesh (one entry: a single level)
const JOBS = [
  { id: 'boulder_01', out: 'rocks/boulder_01', tris: [1600, 200] },
  { id: 'namaqualand_boulder_02', out: 'rocks/boulder_02', tris: [1600, 200] },
  { id: 'namaqualand_boulder_05', out: 'rocks/boulder_05', tris: [1400, 180] },
  { id: 'rock_moss_set_01', out: 'rocks/rock_set', tris: [900, 140], keep: ['rock01', 'rock03', 'rock04', 'rock05'] },
  { id: 'rock_07', out: 'rocks/stone_07', tris: [240] },
  { id: 'rock_09', out: 'rocks/stone_09', tris: [200] },
  { id: 'dry_branches_medium_01', out: 'deadwood/branches', tris: [420] },
  { id: 'tree_stump_01', out: 'deadwood/stump', tris: [1000, 180] },
  { id: 'dead_tree_trunk', out: 'deadwood/trunk', tris: [1000, 160] },
];

await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.decoder': MeshoptDecoder,
  'meshopt.encoder': MeshoptEncoder,
});

function triangles(mesh) {
  let n = 0;
  for (const p of mesh.listPrimitives()) {
    const idx = p.getIndices();
    n += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3;
  }
  return n;
}

async function load(job) {
  const dir = path.join(srcDir, 'models', job.id);
  const file = fs.readdirSync(dir).find((f) => f.endsWith('.gltf'));
  const doc = await io.read(path.join(dir, file));
  const root = doc.getRoot();
  if (job.keep) {
    for (const node of root.listNodes()) {
      if (node.getMesh() && !job.keep.some((k) => node.getName().endsWith(k))) {
        node.getMesh().dispose();
        node.dispose();
      }
    }
  }
  // shape only: positions and indices
  for (const mesh of root.listMeshes()) {
    for (const p of mesh.listPrimitives()) {
      for (const sem of p.listSemantics()) if (sem !== 'POSITION') p.setAttribute(sem, null);
      p.setMaterial(null);
    }
  }
  for (const m of root.listMaterials()) m.dispose();
  await doc.transform(prune(), weld());
  return doc;
}

// Simplify each mesh towards `target` triangles. meshopt's error bound stops
// it early on rough scans, so loosen the bound until the target is reached.
async function decimate(doc, target) {
  for (const mesh of doc.getRoot().listMeshes()) {
    const n = triangles(mesh);
    if (n <= target) continue;
    for (const error of [0.004, 0.01, 0.03, 0.1]) {
      const ratio = target / triangles(mesh);
      if (ratio >= 1) break;
      for (const p of mesh.listPrimitives()) simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio, error, lockBorder: false });
      if (triangles(mesh) <= target * 1.15) break;
    }
  }
}

// Ambient occlusion per vertex: cosine-weighted rays against the mesh, and
// anything heading into the ground (the lowest fifth of the shape is buried
// when placed) counts as blocked. Stored as COLOR_0 (grey).
function bakeAO(doc, prim, rays = 40) {
  const pos = prim.getAttribute('POSITION').getArray();
  const nor = prim.getAttribute('NORMAL').getArray();
  const idx = prim.getIndices().getArray();
  const nv = pos.length / 3;
  let minY = Infinity;
  let maxY = -Infinity;
  let ext = 0;
  for (let i = 0; i < nv; i++) {
    minY = Math.min(minY, pos[i * 3 + 1]);
    maxY = Math.max(maxY, pos[i * 3 + 1]);
  }
  for (let i = 0; i < nv; i++) ext = Math.max(ext, Math.abs(pos[i * 3]), Math.abs(pos[i * 3 + 2]));
  const ground = minY + (maxY - minY) * 0.2;
  const maxD = Math.max(maxY - minY, ext) * 0.6;
  const tri = idx.length / 3;
  const out = new Float32Array(nv * 3);
  // fixed quasi-random directions (Fibonacci) around +Z, rotated per vertex
  const dirs = [];
  for (let k = 0; k < rays; k++) {
    const u = (k + 0.5) / rays;
    const r = Math.sqrt(u);
    const a = k * 2.399963;
    dirs.push([r * Math.cos(a), r * Math.sin(a), Math.sqrt(1 - u)]);
  }
  const e1 = [0, 0, 0], e2 = [0, 0, 0];
  for (let v = 0; v < nv; v++) {
    const ox = pos[v * 3], oy = pos[v * 3 + 1], oz = pos[v * 3 + 2];
    const nx = nor[v * 3], ny = nor[v * 3 + 1], nz = nor[v * 3 + 2];
    // tangent frame
    let tx = Math.abs(nx) > 0.9 ? 0 : 1, ty = Math.abs(nx) > 0.9 ? 1 : 0, tz = 0;
    let bx = ny * tz - nz * ty, by = nz * tx - nx * tz, bz = nx * ty - ny * tx;
    let bl = Math.hypot(bx, by, bz);
    bx /= bl; by /= bl; bz /= bl;
    tx = by * nz - bz * ny; ty = bz * nx - bx * nz; tz = bx * ny - by * nx;
    let open = 0;
    for (const [a, b, c] of dirs) {
      const dx = tx * a + bx * b + nx * c, dy = ty * a + by * b + ny * c, dz = tz * a + bz * b + nz * c;
      const px = ox + nx * 1e-3 * maxD, py = oy + ny * 1e-3 * maxD, pz = oz + nz * 1e-3 * maxD;
      // into the ground?
      if (dy < 0 && py + dy * maxD < ground) continue;
      let hit = false;
      for (let t = 0; t < tri && !hit; t++) {
        const i0 = idx[t * 3] * 3, i1 = idx[t * 3 + 1] * 3, i2 = idx[t * 3 + 2] * 3;
        e1[0] = pos[i1] - pos[i0]; e1[1] = pos[i1 + 1] - pos[i0 + 1]; e1[2] = pos[i1 + 2] - pos[i0 + 2];
        e2[0] = pos[i2] - pos[i0]; e2[1] = pos[i2 + 1] - pos[i0 + 1]; e2[2] = pos[i2 + 2] - pos[i0 + 2];
        const hx = dy * e2[2] - dz * e2[1], hy = dz * e2[0] - dx * e2[2], hz = dx * e2[1] - dy * e2[0];
        const det = e1[0] * hx + e1[1] * hy + e1[2] * hz;
        if (Math.abs(det) < 1e-12) continue;
        const f = 1 / det;
        const sx = px - pos[i0], sy = py - pos[i0 + 1], sz = pz - pos[i0 + 2];
        const u = f * (sx * hx + sy * hy + sz * hz);
        if (u < 0 || u > 1) continue;
        const qx = sy * e1[2] - sz * e1[1], qy = sz * e1[0] - sx * e1[2], qz = sx * e1[1] - sy * e1[0];
        const w = f * (dx * qx + dy * qy + dz * qz);
        if (w < 0 || u + w > 1) continue;
        const d = f * (e2[0] * qx + e2[1] * qy + e2[2] * qz);
        if (d > 1e-5 && d < maxD) hit = true;
      }
      if (!hit) open++;
    }
    const ao = Math.pow(open / rays, 0.8);
    out[v * 3] = out[v * 3 + 1] = out[v * 3 + 2] = ao;
  }
  prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(out).setBuffer(doc.getRoot().listBuffers()[0]));
}

// smooth, area-weighted vertex normals on the welded mesh
function smoothNormals(doc, prim) {
  const pos = prim.getAttribute('POSITION').getArray();
  const idx = prim.getIndices().getArray();
  const n = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    for (const i of [a, b, c]) {
      n[i] += fx;
      n[i + 1] += fy;
      n[i + 2] += fz;
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l;
    n[i + 1] /= l;
    n[i + 2] /= l;
  }
  prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(n).setBuffer(doc.getRoot().listBuffers()[0]));
}

async function finish(doc) {
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const p of mesh.listPrimitives()) {
      smoothNormals(doc, p);
      bakeAO(doc, p);
    }
  }
}

function oneBuffer(doc) {
  const [b0, ...rest] = doc.getRoot().listBuffers();
  for (const a of doc.getRoot().listAccessors()) a.setBuffer(b0);
  for (const b of rest) b.dispose();
}

for (const job of JOBS) {
  const doc = await load(job);
  await decimate(doc, job.tris[0]);
  await finish(doc);
  if (job.tris[1]) {
    const lod1 = await load(job);
    await decimate(lod1, job.tris[1]);
    await finish(lod1);
    for (const n of lod1.getRoot().listNodes()) n.setName(n.getName() + '_lod1');
    for (const m of lod1.getRoot().listMeshes()) m.setName(m.getName() + '_lod1');
    mergeDocuments(doc, lod1);
    // one scene holding both levels, one buffer
    const [s0, ...rest] = doc.getRoot().listScenes();
    for (const sc of rest) {
      for (const n of sc.listChildren()) s0.addChild(n);
      sc.dispose();
    }
  }
  oneBuffer(doc);
  await doc.transform(dedup(), prune());
  await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const out = path.join(outDir, job.out + '.glb');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await io.write(out, doc);
  const summary = doc
    .getRoot()
    .listNodes()
    .filter((n) => n.getMesh())
    .map((n) => `${n.getName()}:${triangles(n.getMesh())}`)
    .join(' ');
  console.log(job.out, (fs.statSync(out).size / 1024).toFixed(0) + ' KB', summary);
}
