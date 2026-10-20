// Hunting challenges, kept between hunts. Each one is checked from your own
// shot log, so they work the same in multiplayer.

export const CHALLENGES = [
  { id: 'rightLeft', en: 'A right and left', ar: 'دبلة', desc: 'Two birds down with the two barrels of one loading.' , descAr: 'طيرين بالسبطانتين من نفس التعبئة.' },
  { id: 'quailFive', en: 'Five quail, no misses', ar: 'خمس فري', desc: 'Five quail in a row without missing a shot.' , descAr: 'خمس فرّي ورا بعض بلا ولا خطأ.' },
  { id: 'thrush40', en: 'A thrush at 40 m', ar: 'سمنة بعيدة', desc: 'Take a song thrush at 40 m or more.' , descAr: 'سمنة على ٤٠ متر أو أبعد.' },
  { id: 'woodcockDusk', en: 'Woodcock at dusk', ar: 'شكب المغرب', desc: 'Take a woodcock after half past four in the afternoon.' , descAr: 'شكب بعد الأربعة ونص العصر.' },
  { id: 'firstLight', en: 'First light', ar: 'عالضو', desc: 'A bird down before a quarter past seven.' , descAr: 'طير قبل السبعة والربع الصبح.' },
  { id: 'fieldfarePair', en: 'Two kikhen from a flock', ar: 'جوز كيخن', desc: 'Two fieldfare within five seconds.' , descAr: 'كيخنتين خلال خمس ثواني.' },
  { id: 'incoming', en: 'Straight at you', ar: 'جاي عليك', desc: 'Take a bird flying straight towards you.' , descAr: 'طير جايي دغري عليك.' },
  { id: 'crosser', en: 'The long crosser', ar: 'معترض', desc: 'Take a fast crossing bird at 35 m or more.' , descAr: 'طير معترض سريع على ٣٥ متر أو أبعد.' },
  { id: 'woodcockFirst', en: 'The prize bird', ar: 'أول شكب', desc: 'Your first woodcock.' , descAr: 'أول شكب إلك.' },
  { id: 'chaffinchTen', en: 'Ten salanj', ar: 'عشرة صلنج', desc: 'Ten chaffinch in the bag in one hunt.' , descAr: 'عشرة صلنج بالجعبة بصيدة وحدة.' },
  { id: 'fullBag', en: 'A full game bag', ar: 'جعبة مليانة', desc: 'Fifteen birds in the bag in one hunt.' , descAr: 'خمستعشر طير بالجعبة بصيدة وحدة.' },
  { id: 'cleanShot', en: 'Clean shooting', ar: 'قوّاص نضيف', desc: 'End a hunt with six birds or more and at least one bird for every two shots.' , descAr: 'خلّص صيدة بستّ طيور أو أكتر، وطير لكل رميتين عالأقل.' },
];

const KEY = 'lbh.challenges';

function load() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  } catch {
    return {};
  }
}

function save(done) {
  try {
    localStorage.setItem(KEY, JSON.stringify(done));
  } catch {}
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// One challenge a day is worth a bonus.
export function dailyChallenge(date = today()) {
  let h = 0;
  for (const c of date) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return CHALLENGES[h % CHALLENGES.length];
}

export class ChallengeTracker {
  constructor(onDone) {
    this.done = load();
    this.onDone = onDone;
    this.thisHunt = [];
  }

  complete(id) {
    if (this.thisHunt.includes(id)) return;
    const c = CHALLENGES.find((x) => x.id === id);
    const first = !this.done[id];
    const daily = dailyChallenge().id === id && this.done[id]?.daily !== today();
    if (!first && !daily) return;
    this.done[id] = { date: this.done[id]?.date || today(), daily: daily ? today() : this.done[id]?.daily };
    save(this.done);
    this.thisHunt.push(id);
    this.onDone(c, { first, daily });
  }

  // After each of your shots. log: this hunt's shots; e: the newest.
  onShot(log, e) {
    if (e.result !== 'kill') return;
    const kills = log.filter((x) => x.result === 'kill');
    const prev = log[log.length - 2];
    if (prev && prev.result === 'kill' && prev.loadId === e.loadId && prev.barrel !== e.barrel && e.time - prev.time < 6) this.complete('rightLeft');
    const last5 = log.slice(-5);
    if (last5.length === 5 && last5.every((x) => x.spId === 'quail' && x.result === 'kill')) this.complete('quailFive');
    if (e.spId === 'songThrush' && e.dist >= 40) this.complete('thrush40');
    if (e.spId === 'woodcock') {
      this.complete('woodcockFirst');
      if (e.hour >= 16.5) this.complete('woodcockDusk');
    }
    if (e.hour < 7.25) this.complete('firstLight');
    if (e.spId === 'fieldfare' && kills.some((x) => x !== e && x.spId === 'fieldfare' && e.time - x.time < 5)) this.complete('fieldfarePair');
    if (e.along < -6 && e.dist > 12) this.complete('incoming');
    if (Math.abs(e.lat) > 8 && e.dist >= 35) this.complete('crosser');
  }

  onBag(bag) {
    if ((bag.chaffinch || 0) >= 10) this.complete('chaffinchTen');
    if (Object.values(bag).reduce((a, b) => a + b, 0) >= 15) this.complete('fullBag');
  }

  onEnd(me, log) {
    const bagged = Object.values(me.bag).reduce((a, b) => a + b, 0);
    if (bagged >= 6 && log.length && bagged / log.length >= 0.5) this.complete('cleanShot');
  }
}

export function challengeListHtml() {
  const done = load();
  const daily = dailyChallenge();
  return CHALLENGES.map((c) => {
    const d = done[c.id];
    const isDaily = c.id === daily.id;
    const ar = document.documentElement.lang === 'ar';
    const title = ar ? `<b>${c.ar}</b>` : `<b>${c.en}</b> <span class="ar">${c.ar}</span>`;
    return `<div class="ch${d ? ' done' : ''}${isDaily ? ' daily' : ''}"><span class="tick">${d ? '✓' : ''}</span><div>${title}${isDaily ? ` <em>${ar ? 'اليوم +٥٠' : 'today +50'}</em>` : ''}<div class="dim">${ar ? c.descAr : c.desc}</div></div></div>`;
  }).join('');
}
