// Download the CC0 source assets listed in sources.json from Poly Haven into
// a working folder (keep it outside the repo: the sources are big and only
// the processed results go into public/models).
//
//   node tools/models/fetch.mjs <download dir>
//
// Re-runnable: files already there are skipped. Also writes credits.json
// (asset, authors, licence, page) for CREDITS.md.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2];
if (!out) {
  console.error('usage: node fetch.mjs <download dir>');
  process.exit(1);
}
fs.mkdirSync(out, { recursive: true });
const src = JSON.parse(fs.readFileSync(path.join(here, 'sources.json'), 'utf8'));
const API = 'https://api.polyhaven.com';

async function json(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'lebanon-hunt-3d asset fetch' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function download(url, dst) {
  if (fs.existsSync(dst) && fs.statSync(dst).size > 0) return false;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  fs.writeFileSync(dst, Buffer.from(await r.arrayBuffer()));
  return true;
}

const credits = {};
async function credit(id) {
  if (credits[id]) return;
  const info = await json(`${API}/info/${id}`);
  credits[id] = {
    name: info.name,
    authors: Object.keys(info.authors || {}),
    licence: 'CC0 1.0',
    page: `https://polyhaven.com/a/${id}`,
  };
}

for (const t of src.textures) {
  const files = await json(`${API}/files/${t.id}`);
  for (const m of t.maps) {
    const byRes = files[m]?.[t.res];
    if (!byRes) throw new Error(`${t.id}: no ${m} at ${t.res}`);
    const fmt = t.fmt && byRes[t.fmt] ? t.fmt : byRes.png ? 'png' : 'jpg';
    const dst = path.join(out, 'tex', `${t.id}__${m}_${t.res}.${fmt}`);
    if (await download(byRes[fmt].url, dst)) console.log('got', dst);
  }
  await credit(t.id);
}

for (const m of src.models) {
  const files = await json(`${API}/files/${m.id}`);
  const g = files.gltf?.[m.res]?.gltf;
  if (!g) throw new Error(`${m.id}: no gltf at ${m.res}`);
  const dir = path.join(out, 'models', m.id);
  if (await download(g.url, path.join(dir, path.basename(g.url)))) console.log('got', m.id);
  for (const [rel, f] of Object.entries(g.include || {})) await download(f.url, path.join(dir, rel));
  await credit(m.id);
}

fs.writeFileSync(path.join(out, 'credits.json'), JSON.stringify(credits, null, 2));
console.log('done:', Object.keys(credits).length, 'assets');
