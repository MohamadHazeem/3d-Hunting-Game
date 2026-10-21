import { audio } from './audio.js';
import { isAr } from '../core/i18n.js';

// Your hunting companion: calls the birds as they come and has a word about
// your shooting. Spoken with the browser's own text-to-speech in plain
// English, or Modern Standard Arabic when the game is in Arabic.

const LINES = {
  quail: { en: ['Quail! Flushing ahead!', 'Quail, quail!'], ar: ['سمّان! ينطلق أمامك!'] },
  songThrush: { en: ['Thrush coming in!', 'Thrush!'], ar: ['سمنة قادمة!'] },
  fieldfare: { en: ['Fieldfare! Big flock!'], ar: ['سمنة الحقول! سرب كبير!'] },
  chaffinch: { en: ['Chaffinch coming!'], ar: ['شرشور قادم!'] },
  woodcock: { en: ['Woodcock! Woodcock!'], ar: ['دجاجة الأرض!'] },
  turtleDove: { en: ['Turtle doves coming!'], ar: ['قمري قادم!'] },
  woodpigeon: { en: ['Pigeons! Watch out!'], ar: ['حمام خشبي! انتبه!'] },
  left: { en: ['Birds on your left!'], ar: ['طيور على يسارك!'] },
  right: { en: ['Birds on your right!'], ar: ['طيور على يمينك!'] },
  nice: { en: ['Good shot!', 'Nice one!', 'Clean kill!'], ar: ['إصابة جيدة!', 'أحسنت!', 'إصابة نظيفة!'] },
  double: { en: ['A right and left! Beautiful!'], ar: ['طائران بطلقتين! رائع!'] },
  miss: { en: ['Missed it.', 'Never mind, next one.'], ar: ['أخطأته.', 'لا بأس، التالي.'] },
  behind: { en: ['You were behind it. Give it more lead.'], ar: ['كنت خلفه، قدّم أكثر.'] },
  ahead: { en: ['Too far ahead of it.'], ar: ['تقدّمت عليه كثيرًا.'] },
  far: { en: ['Too far. Let them come closer.'], ar: ['إنه بعيد جدًا، دعه يقترب.'] },
  wounded: { en: ["It's hit. Watch where it falls."], ar: ['أصبته، راقب أين يسقط.'] },
  stork: { en: ["No! That's a stork, it's protected!"], ar: ['لا! هذا لقلق، إنه محمي!'] },
  dog: { en: ["The dog's on point! Walk in slowly."], ar: ['الكلب يؤشّر! تقدّم ببطء.'] },
  morning: { en: ['Good morning. The birds move at first light, so stay sharp.'], ar: ['صباح الخير. الطيور تتحرك مع أول الضوء، فكن متيقظًا.'] },
  dusk: { en: ["The light's going. Last chances."], ar: ['الضوء يخفت، إنها الفرص الأخيرة.'] },
  unsafe: { en: ["Careful! There's a hunter in front of you!"], ar: ['انتبه! هناك صياد أمامك!'] },
};

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;

// The clearest installed voice for a language. macOS also ships joke voices
// (Bubbles, Zarvox…), so only known natural voices are used.
const PREFERRED = ['Daniel', 'Arthur', 'Google UK English Male', 'Alex', 'Aaron', 'Samantha', 'Google US English', 'Karen', 'Moira', 'Tessa', 'Rishi', 'Majed', 'Maged', 'Tarik', 'Laila', 'Google العربية'];
const NOVELTY = /Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Good News|Hysterical|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox|Fred|Junior|Kathy|Ralph|Princess|Grandma|Grandpa|Eddy|Flo|Reed|Rocko|Sandy|Shelley/i;
function pickVoice(lang) {
  const voices = (synth ? synth.getVoices() : []).filter((v) => v.lang && v.lang.toLowerCase().startsWith(lang) && !NOVELTY.test(v.name));
  const rank = (v) => {
    const i = PREFERRED.findIndex((n) => v.name.startsWith(n));
    return (/(premium|enhanced|natural|neural)/i.test(v.name) ? 100 : 0) + (i >= 0 ? 50 - i : 0);
  };
  return voices.sort((a, b) => rank(b) - rank(a))[0] || null;
}

export class Companion {
  constructor() {
    this.enabled = true;
    this.quiet = 2; // seconds until he may speak again
    this.scanT = 0;
    if (synth) synth.onvoiceschanged = () => (this.voices = null);
  }

  say(key, { force = false, gap = 5, delay = 0.25, chance = 1 } = {}) {
    const set = LINES[key];
    if (!this.enabled || !synth || !set) return false;
    if (!force && (this.quiet > 0 || Math.random() > chance)) return false;
    const ar = isAr();
    const lang = ar ? 'ar' : 'en';
    this.voices = this.voices || {};
    if (this.voices[lang] === undefined) this.voices[lang] = pickVoice(lang);
    const voice = this.voices[lang];
    if (!voice) return false;
    const list = set[lang];
    const u = new SpeechSynthesisUtterance(list[Math.floor(Math.random() * list.length)]);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = 1.05;
    u.volume = Math.min(1, (audio.vol.voice ?? 1) * (audio.vol.master ?? 1));
    this.quiet = gap;
    setTimeout(() => {
      synth.cancel();
      synth.speak(u);
    }, delay * 1000);
    return true;
  }

  // Watch for flocks coming in and call them.
  update(dt, game) {
    this.quiet -= dt;
    this.scanT -= dt;
    if (this.scanT > 0) return;
    this.scanT = 0.4;
    const me = game.player.pos;
    // joining players have no flock groups (only the host simulates them):
    // treat each flying bird as its own "group", one call per species a while
    const groups = game.authority ? game.birds.groups : [...game.birds.birds.values()].filter((b) => b.state === 'flying').map((b) => ({ members: [b], ref: b }));
    this.recent = this.recent || {};
    for (const g of groups) {
      if (g.ref) {
        if (g.ref.announced || game.birds.time - (this.recent[g.ref.spId] || -99) < 8) continue;
        g.announced = false;
      }
      if (g.announced) continue;
      const lead = g.members.find((m) => game.birds.birds.has(m.id) && m.state === 'flying');
      if (!lead || lead.sp.protected) continue;
      const p = lead.renderPos || lead.pos;
      const dx = me.x - p.x;
      const dz = me.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 110 || d < 15) continue;
      const v = lead.vel;
      const closing = (v.x * dx + v.z * dz) / (d * (Math.hypot(v.x, v.z) || 1));
      if (closing < 0.6) continue;
      g.announced = true;
      if (g.ref) g.ref.announced = true;
      this.recent[lead.spId] = game.birds.time;
      // which side is it coming from, relative to where you face?
      const bearing = Math.atan2(p.x - me.x, -(p.z - me.z));
      let rel = bearing + game.player.yaw;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      if (Math.abs(rel) > 1.2 && Math.abs(rel) < 2.2 && Math.random() < 0.5) this.say(rel > 0 ? 'right' : 'left', { gap: 4 });
      else this.say(lead.spId, { gap: 4, chance: 0.85 });
      return;
    }
  }

  onFlush(spId, dist) {
    if (dist < 40) this.say(spId, { gap: 3, chance: 0.75, delay: 0.15 });
  }

  onShot(entry, double) {
    if (!entry.spId) return;
    if (double) return this.say('double', { force: true, gap: 4, delay: 0.6 });
    if (entry.result === 'kill') return this.say('nice', { gap: 5, chance: 0.45, delay: 0.7 });
    if (entry.result === 'wound') return this.say('wounded', { gap: 5, chance: 0.8, delay: 0.8 });
    if (entry.dist > 46) return this.say('far', { gap: 6, chance: 0.6, delay: 0.6 });
    if (entry.side === 'behind') return this.say('behind', { gap: 6, chance: 0.4, delay: 0.6 });
    if (entry.side === 'ahead') return this.say('ahead', { gap: 6, chance: 0.4, delay: 0.6 });
    this.say('miss', { gap: 6, chance: 0.3, delay: 0.6 });
  }

  onStork() {
    this.say('stork', { force: true, gap: 4, delay: 0.3 });
  }

  onDogPoint() {
    this.say('dog', { gap: 4, delay: 0.4 });
  }

  onUnsafe() {
    this.say('unsafe', { force: true, gap: 4, delay: 0.1 });
  }

  onStart(hour) {
    if (hour < 9.5) setTimeout(() => this.say('morning', { force: true, gap: 4 }), 2500);
  }

  onDusk() {
    this.say('dusk', { force: true, gap: 4 });
  }
}
