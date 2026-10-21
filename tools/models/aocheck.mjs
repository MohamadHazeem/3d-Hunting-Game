// Print the baked occlusion range of each mesh in .glb files.
//   node tools/models/aocheck.mjs public/models/rocks/*.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  for (const m of doc.getRoot().listMeshes()) {
    const c = m.listPrimitives()[0].getAttribute('COLOR_0');
    if (!c) continue;
    const v = [];
    const el = [];
    for (let i = 0; i < c.getCount(); i++) v.push(c.getElement(i, el)[0]);
    v.sort((a, b) => a - b);
    const q = (k) => v[Math.floor((v.length - 1) * k)].toFixed(2);
    // share of normals pointing away from the centre (outward winding)
    const P = m.listPrimitives()[0].getAttribute('POSITION');
    const N = m.listPrimitives()[0].getAttribute('NORMAL');
    const cen = [0, 0, 0];
    const a = [], b = [];
    for (let i = 0; i < P.getCount(); i++) P.getElement(i, a).forEach((x, k) => (cen[k] += x / P.getCount()));
    let out = 0;
    for (let i = 0; i < P.getCount(); i++) {
      P.getElement(i, a);
      N.getElement(i, b);
      if ((a[0] - cen[0]) * b[0] + (a[1] - cen[1]) * b[1] + (a[2] - cen[2]) * b[2] > 0) out++;
    }
    console.log('  outward normals', (out / P.getCount()).toFixed(2));
    console.log(m.getName(), 'min', q(0), 'p10', q(0.1), 'med', q(0.5), 'max', q(1), c.getNormalized() ? 'normalised' : '', c.getComponentType());
  }
}
