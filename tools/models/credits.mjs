// Write public/models/CREDITS.md from the credits fetch.mjs collected.
//   node tools/models/credits.mjs <download dir> public/models
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [dl, out] = process.argv.slice(2);
const credits = JSON.parse(fs.readFileSync(path.join(dl, 'credits.json'), 'utf8'));
const src = JSON.parse(fs.readFileSync(path.join(here, 'sources.json'), 'utf8'));
const uses = {};
for (const t of [...src.textures, ...src.models]) (uses[t.id] ||= []).push(t.use);

const rows = Object.entries(credits).map(
  ([id, c]) => `| [${c.name}](${c.page}) | ${c.authors.join(', ')} | ${c.licence} | ${[...new Set(uses[id] || [])].join('; ')} |`
);
const md = `# Models and foliage: credits

Everything in this folder is made from CC0 (public domain) assets from
[Poly Haven](https://polyhaven.com). CC0 needs no attribution; the authors are
listed here with thanks.

- \`foliage/\`: card atlases composited from the photographed leaves, twigs,
  needle sprays and grass blades below (tools/models/bake_foliage.py).
- \`bark/\`: fir bark, recompressed.
- \`rocks/\`, \`deadwood/\`: the scanned shapes, decimated to a few thousand and
  a few hundred triangles with their ambient occlusion baked into the vertex
  colours (tools/models/build_models.mjs). The game textures them itself.

| Asset | Authors | Licence | Used for |
|---|---|---|---|
${rows.join('\n')}

Rebuild: see tools/models/build.sh.
`;
fs.writeFileSync(path.join(out, 'CREDITS.md'), md);
console.log('wrote', path.join(out, 'CREDITS.md'));
