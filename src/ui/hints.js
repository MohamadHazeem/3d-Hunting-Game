import { isAr } from '../core/i18n.js';

// One-time tips for a new hunter, each shown the first time it's useful
// and then never again (remembered in localStorage).

const HINTS = {
  start: { en: 'Walk slowly and watch the sky. Hold the right mouse button to mount the gun, left to fire.', ar: 'امشِ ببطء وراقب السماء. اضغط زر الفأرة الأيمن لرفع البندقية، والأيسر لإطلاق النار.' },
  binocs: { en: 'Press B for the binoculars to spot birds far off; Q whistles passing thrush and finch flocks in.', ar: 'اضغط B لاستخدام المنظار ورصد الطيور البعيدة، واضغط Q للصفير وجذب أسراب السمنة والشرشور.' },
  flock: { en: 'Birds coming! Mount the gun early and swing ahead of them — crossing birds need lead.', ar: 'طيور قادمة! ارفع البندقية مبكرًا وصوّب أمامها، فالطائر العابر يحتاج إلى تقديم.' },
  miss: { en: 'The shot takes time to reach the bird: swing through it and keep the gun moving as you fire.', ar: 'تحتاج الطلقة وقتًا لتصل إلى الطائر: مرّر البندقية عبره وتابع تحريكها أثناء الإطلاق.' },
  down: { en: 'Bird down! Walk to it and press E — or let your dog bring it to you.', ar: 'سقط الطائر! اذهب إليه واضغط E، أو دع كلبك يحضره إليك.' },
  point: { en: 'Your dog is on point: the bird is just ahead of its nose. Walk in with the gun ready, or press F to send it in.', ar: 'كلبك يؤشّر: الطائر أمام أنفه تمامًا. تقدّم والبندقية جاهزة، أو اضغط F ليطيّره.' },
  reload: { en: 'Both barrels are empty — press R (or click) to break the gun and reload.', ar: 'السبطانتان فارغتان. اضغط R (أو انقر) لكسر البندقية وإعادة تعبئتها.' },
  wounded: { en: 'A wounded bird can fly on and drop later — watch where it goes and look for feathers.', ar: 'قد يواصل الطائر المصاب طيرانه ثم يسقط لاحقًا، فراقب وجهته وابحث عن الريش.' },
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
