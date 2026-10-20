// Generate spoken lines with ElevenLabs text-to-speech.
// Usage: node tools/audio/elevenlabs-voice.mjs <lines.json> <outDir>
// lines.json: { "voice": "<voice id>", "model": "eleven_v4", "lines": [{ "name": "...", "text": "..." }] }
import fs from 'node:fs';
import path from 'node:path';

function loadKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  const m = fs.readFileSync(path.resolve('.env.local'), 'utf8').match(/^ELEVENLABS_API_KEY=(.+)$/m);
  if (!m) throw new Error('ELEVENLABS_API_KEY not found');
  return m[1].trim();
}

const key = loadKey();
const [file, outDir] = process.argv.slice(2);
const job = JSON.parse(fs.readFileSync(file, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });
for (const l of job.lines) {
  const out = path.join(outDir, `${l.name}.mp3`);
  if (fs.existsSync(out)) continue;
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${job.voice}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: l.text,
      model_id: job.model,
      language_code: job.language || undefined,
      voice_settings: { stability: 0.35, similarity_boost: 0.75, style: 0.6, use_speaker_boost: true },
    }),
  });
  if (!r.ok) {
    console.log(`FAIL ${l.name}: ${r.status} ${(await r.text()).slice(0, 300)}`);
    if (r.status === 401 || r.status === 402) break;
    continue;
  }
  fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
  console.log(`ok ${l.name}`);
}
