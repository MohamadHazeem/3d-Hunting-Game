// Generate sound effects with the ElevenLabs text-to-sound API.
// Usage: node tools/audio/elevenlabs-sfx.mjs <jobs.json> <outDir>
// jobs.json: [{ "name": "shot_near_1", "prompt": "...", "duration": 2.5, "influence": 0.6, "loop": false }]
// The key comes from ELEVENLABS_API_KEY or .env.local (never commit it).
import fs from 'node:fs';
import path from 'node:path';

function loadKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  const env = fs.readFileSync(path.resolve('.env.local'), 'utf8');
  const m = env.match(/^ELEVENLABS_API_KEY=(.+)$/m);
  if (!m) throw new Error('ELEVENLABS_API_KEY not found');
  return m[1].trim();
}

const key = loadKey();
const [jobsFile, outDir] = process.argv.slice(2);
const jobs = JSON.parse(fs.readFileSync(jobsFile, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });

async function credits() {
  const r = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': key } });
  const d = await r.json();
  return d.character_limit - d.character_count;
}

let left = await credits();
console.log(`credits left: ${left}`);
for (const j of jobs) {
  const out = path.join(outDir, `${j.name}.mp3`);
  if (fs.existsSync(out)) {
    console.log(`skip ${j.name} (exists)`);
    continue;
  }
  const body = { text: j.prompt, prompt_influence: j.influence ?? 0.5, model_id: 'eleven_text_to_sound_v2' };
  if (j.duration) body.duration_seconds = j.duration;
  if (j.loop) body.loop = true;
  const r = await fetch('https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128', {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    console.log(`FAIL ${j.name}: ${r.status} ${(await r.text()).slice(0, 300)}`);
    if (r.status === 401 || r.status === 402 || r.status === 429) break;
    continue;
  }
  fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
  const now = await credits();
  console.log(`ok ${j.name} (${j.duration ?? 'auto'}s) cost ${left - now}, left ${now}`);
  left = now;
}
