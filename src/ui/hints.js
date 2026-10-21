import { isAr } from '../core/i18n.js';

// One-time tips for a new hunter, each shown the first time it's useful
// and then never again (remembered in localStorage).

const HINTS = {
  start: { en: 'Walk slowly and watch the sky. Hold the right mouse button to mount the gun, left to fire.', ar: 'امشي عمهلك وراقب السما. اكبس الماوس اليمين لترفع البارودة، والشمال لتقوّص.' },
  binocs: { en: 'Press B for the binoculars to spot birds far off; Q whistles passing thrush and finch flocks in.', ar: 'اكبس B للمنظار لتشوف الطير البعيد، وQ لتصفّر للسمن والصلنج.' },
  flock: { en: 'Birds coming! Mount the gun early and swing ahead of them — crossing birds need lead.', ar: 'في طير جايي! ارفع البارودة بكّير ولحّقه — الطير المعترض بدّه تقديم.' },
  miss: { en: 'The shot takes time to reach the bird: swing through it and keep the gun moving as you fire.', ar: 'الخردق بياخد وقت ليوصل للطير: لحّقه وكفّي حرّك البارودة وإنت عم تقوّص.' },
  down: { en: 'Bird down! Walk to it and press E — or let your dog bring it to you.', ar: 'وقع الطير! روح لعنده واكبس E — أو خلّي الكلب يجيبلك ياه.' },
  point: { en: 'Your dog is on point: the bird is just ahead of its nose. Walk in with the gun ready, or press F to send it in.', ar: 'الكلب واقف: الطير قدّام مناخيره. تقدّم والبارودة جاهزة، أو اكبس F ليهجم.' },
  reload: { en: 'Both barrels are empty — press R (or click) to break the gun and reload.', ar: 'السبطانتين فاضيين — اكبس R لتكسر البارودة وتعبّي.' },
  wounded: { en: 'A wounded bird can fly on and drop later — watch where it goes and look for feathers.', ar: 'الطير المصاب ممكن يكمّل ويوقع بعدين — شوف وين راح ودوّر عالريش.' },
};

export class Hints {
  constructor(el) {
    this.el = el;
    this.enabled = true;
    try {
      this.seen = new Set(JSON.parse(localStorage.getItem('lbh.hintsSeen') || '[]'));
    } catch {
      this.seen = new Set();
    }
    this.timer = 0;
  }

  show(id) {
    if (!this.enabled || this.seen.has(id) || !HINTS[id]) return;
    this.seen.add(id);
    try {
      localStorage.setItem('lbh.hintsSeen', JSON.stringify([...this.seen]));
    } catch {}
    this.el.innerHTML = `<b>${isAr() ? 'نصيحة' : 'Tip'}</b> ${isAr() ? HINTS[id].ar : HINTS[id].en}`;
    this.el.classList.add('on');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.el.classList.remove('on'), 9000);
  }
}
