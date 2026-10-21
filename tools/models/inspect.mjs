// Print the meshes, triangle counts, sizes and textures of glTF files.
//   node tools/models/inspect.mjs file.gltf|glb ...
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
await MeshoptDecoder.ready;
for (const f of process.argv.slice(2)) {
  const doc = await io.read(f);
  const root = doc.getRoot();
  console.log('==', f);
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    let tris = 0;
    for (const p of mesh.listPrimitives()) {
      const idx = p.getIndices();
      tris += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3;
    }
    const b = getBounds(node);
    const size = b.max.map((v, i) => +(v - b.min[i]).toFixed(2));
    const mat = mesh.listPrimitives()[0].getMaterial();
    console.log(' ', node.getName(), '| tris', tris, '| size', size.join('x'), '| mat', mat && mat.getName());
  }
  for (const t of root.listTextures()) {
    const s = t.getSize();
    console.log('   tex', t.getName() || t.getURI(), t.getMimeType(), s && s.join('x'), Math.round(t.getImage().byteLength / 1024) + 'KB');
  }
}
