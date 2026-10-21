import { isAr, num } from '../core/i18n.js';

// Text for the spotting HUD, need zones, callers and the objective line.
// English is English only; Arabic is Modern Standard Arabic. Kept apart from
// i18n.js so it can be edited on its own.

const STR = {
  // meters
  vis: { en: 'Visibility', ar: 'الظهور' },
  noise: { en: 'Noise', ar: 'الضجيج' },
  // markers
  birdTag: { en: '{sp} · {d} m', ar: '{sp} · {d} م' },
  birdTagN: { en: '{sp} ×{n} · {d} m', ar: '{sp} ×{n} · {d} م' },
  heard: { en: 'calling · {d} m', ar: 'ينادي · {d} م' },
  sign: { en: 'Sign · {d} m', ar: 'أثر · {d} م' },
  // settings
  setBirdSize: { en: 'Bird size', ar: 'حجم الطيور' },
  setVisible: { en: 'Easy to see (larger)', ar: 'سهلة الرؤية (أكبر)' },
  setRealistic: { en: 'Real size', ar: 'الحجم الحقيقي' },
  setMarkers: { en: 'Mark birds I spot with the binoculars', ar: 'وسم الطيور التي أرصدها بالمنظار' },
  setArrows: { en: 'Arrows for flocks heading my way', ar: 'أسهم للأسراب المتّجهة نحوي' },
  // callers
  callerThrush: { en: 'Thrush whistle', ar: 'صفّارة السُّمنة' },
  callerQuail: { en: 'Quail call', ar: 'نداء السُّمانى' },
  callerDove: { en: 'Dove cooer', ar: 'مُقلِّد الهديل' },
  callerHud: { en: '{name} · <b>Q</b> call · <b>V</b> change', ar: '{name} · <b>Q</b> للنداء · <b>V</b> للتبديل' },
  callerWait: { en: '{name} · ready in {s} s', ar: '{name} · جاهز بعد {s} ث' },
  quailAnswer: { en: '{n} quail answered your call — listen, and look for the markers', ar: 'أجاب نداءَك {n} من السُّمانى — أصغِ وابحث عن العلامات' },
  quailNone: { en: 'No quail answered here — try another field', ar: 'لم يُجب أيّ سُمانى هنا — جرّب حقلًا آخر' },
  doveIn: { en: 'Doves are turning towards your call — keep still', ar: 'اليمام يستدير نحو ندائك — اثبت مكانك' },
  doveNone: { en: 'No doves within hearing — wait for a flock, then call', ar: 'لا يمام في مدى السمع — انتظر سربًا ثم نادِ' },
  // need zones
  zFeed: { en: '{sp} feeding area', ar: 'منطقة تغذّي طيور {sp}' },
  zRoost: { en: '{sp} roost', ar: 'مبيت طيور {sp}' },
  zDrink: { en: '{sp} drinking spot', ar: 'مشرب طيور {sp}' },
  zLine: { en: '{sp} flight line', ar: 'خطّ طيران طيور {sp}' },
  zGround: { en: '{sp} cover', ar: 'مكمن طيور {sp}' },
  zGroundFeed: { en: '{sp} feeding in the stubble', ar: 'تغذّي طيور {sp} في الحصيد' },
  pOlive: { en: 'olive grove', ar: 'بستان الزيتون' },
  pPine: { en: 'pines', ar: 'أشجار الصنوبر' },
  pOak: { en: 'oak wood', ar: 'غابة البلوط' },
  pJuniper: { en: 'junipers', ar: 'أشجار العرعر' },
  pCedar: { en: 'cedars', ar: 'أشجار الأرز' },
  pStubble: { en: 'stubble field', ar: 'حقل الحصيد' },
  pWater: { en: 'water trough', ar: 'حوض الماء' },
  pRidge: { en: 'open ridge', ar: 'التلّة المكشوفة' },
  zoneFound: { en: 'Found: {title} — {place}, {hours}. Marked on your map (M).', ar: 'اكتشفت: {title} — {place}، {hours}. أُضيفت إلى خريطتك (M).' },
  zoneFoundBy: { en: '{name} found: {title} — marked on the map (M).', ar: 'اكتشف {name}: {title} — أُضيفت إلى الخريطة (M).' },
  signFeathers: { en: 'Feathers and droppings under the trees', ar: 'ريش وذَرق تحت الأشجار' },
  signGround: { en: 'Scratchings and droppings on the ground', ar: 'آثار نبش وذَرق على الأرض' },
  signWater: { en: 'Fresh tracks and feathers at the water', ar: 'آثار حديثة وريش عند الماء' },
  // objective line
  oFeed: { en: '{sp} are feeding in the {place} until {to}', ar: 'تتغذّى طيور {sp} في {place} حتى {to}' },
  oRoost: { en: '{sp} are coming in to roost in the {place} until dark', ar: 'تعود طيور {sp} إلى مبيتها في {place} حتى حلول الظلام' },
  oDrink: { en: '{sp} are coming down to drink at the {place} until {to}', ar: 'تنزل طيور {sp} للشرب عند {place} حتى {to}' },
  oLine: { en: '{sp} are flying over the {place} on their way to roost until {to}', ar: 'تعبر طيور {sp} فوق {place} في طريقها إلى المبيت حتى {to}' },
  oGround: { en: '{sp} are sitting tight in the {place} until {to}', ar: 'تكمن طيور {sp} في {place} حتى {to}' },
  oGroundFeed: { en: '{sp} are feeding in the {place} until {to}', ar: 'تتغذّى طيور {sp} في {place} حتى {to}' },
  oHead: { en: ' — head {dir}, {d} m', ar: ' — اتّجه إلى {dir}، {d} م' },
  oThere: { en: ' — you are in the right place: keep still and watch', ar: ' — أنت في المكان الصحيح: اثبت وراقب' },
  oSearch: { en: ' — somewhere to the {dir}: look for sign, or glass it with binoculars (B)', ar: ' — في مكانٍ ما باتجاه {dir}: ابحث عن الأثر أو تفحّص المكان بالمنظار (B)' },
  oNext: { en: 'Next: {title} from {from}, to the {dir}', ar: 'التالي: {title} ابتداءً من {from}، باتجاه {dir}' },
  oPickup: { en: 'Pick up your bird: {d} m to the {dir} (E)', ar: 'التقط طيرك: على بُعد {d} م باتجاه {dir} (E)' },
  oWait: { en: 'Stand still in cover and let the flocks come to you — the arrows show what is heading your way', ar: 'اثبت في مكانٍ مستور ودع الأسراب تأتي إليك — تشير الأسهم إلى ما يتّجه نحوك' },
  oWalk: { en: 'Walk the cover slowly to put up {sp} — let your dog work ahead', ar: 'امشِ في الغطاء ببطء لتُطيِّر {sp} — ودع كلبك يتقدّمك' },
  oSpot: { en: 'Glass the trees with binoculars (B) to spot birds and find where they feed', ar: 'تفحّص الأشجار بالمنظار (B) لرصد الطيور ومعرفة أماكن تغذّيها' },
  // compass points
  dN: { en: 'north', ar: 'الشمال' },
  dNE: { en: 'north-east', ar: 'الشمال الشرقي' },
  dE: { en: 'east', ar: 'الشرق' },
  dSE: { en: 'south-east', ar: 'الجنوب الشرقي' },
  dS: { en: 'south', ar: 'الجنوب' },
  dSW: { en: 'south-west', ar: 'الجنوب الغربي' },
  dW: { en: 'west', ar: 'الغرب' },
  dNW: { en: 'north-west', ar: 'الشمال الغربي' },
};

// Bird names for this HUD: English singular / plural, and Modern Standard Arabic.
const NAMES = {
  quail: { en: 'Quail', pl: 'Quail', ar: 'السُّمانى' },
  woodcock: { en: 'Woodcock', pl: 'Woodcock', ar: 'دجاج الأرض' },
  songThrush: { en: 'Song Thrush', pl: 'Thrush', ar: 'السُّمنة' },
  fieldfare: { en: 'Fieldfare', pl: 'Fieldfares', ar: 'سُمنة الحقول' },
  chaffinch: { en: 'Chaffinch', pl: 'Chaffinches', ar: 'الشُّرشور' },
  turtleDove: { en: 'Turtle Dove', pl: 'Turtle doves', ar: 'القُمري' },
  woodpigeon: { en: 'Woodpigeon', pl: 'Woodpigeons', ar: 'الحمام المطوّق' },
  stork: { en: 'White Stork', pl: 'Storks', ar: 'اللقلق الأبيض' },
};

export function gt(key, vars = {}) {
  const e = STR[key];
  let s = e ? (isAr() ? e.ar : e.en) : key;
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(v);
  return s;
}

// A bird's name; `plural` for sentences like "Thrush are feeding…".
export function birdName(spId, plural = false) {
  const n = NAMES[spId];
  if (!n) return spId;
  return isAr() ? n.ar : plural ? n.pl : n.en;
}

// Digits in the reader's script.
export const n0 = (v) => num(Math.round(v));

export function fmtHour(h) {
  const t = ((Math.round(h * 60) % 1440) + 1440) % 1440;
  return num(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
}

const TITLE = { feed: 'zFeed', roost: 'zRoost', drink: 'zDrink', line: 'zLine', ground: 'zGround', groundFeed: 'zGroundFeed' };
const PLACE = { olive: 'pOlive', pine: 'pPine', oak: 'pOak', juniper: 'pJuniper', cedar: 'pCedar', stubble: 'pStubble', water: 'pWater', ridge: 'pRidge' };
const DOING = { feed: 'oFeed', roost: 'oRoost', drink: 'oDrink', line: 'oLine', ground: 'oGround', groundFeed: 'oGroundFeed' };

// A need zone's name ("Song Thrush feeding area"), its place ("olive grove")
// and its hours ("06:30–10:00, 16:36–18:18").
export const zoneTitle = (z) => gt(TITLE[z.kind] || 'zFeed', { sp: birdName(z.sp) });
export const zonePlace = (z) => gt(PLACE[z.place] || 'pRidge');
export const zoneHours = (z) => z.hours.map(([a, b]) => `${fmtHour(a)}–${fmtHour(b)}`).join(isAr() ? '، ' : ', ');
// What its birds are doing there now, until `to`.
export const zoneDoing = (z, to) => gt(DOING[z.kind] || 'oFeed', { sp: birdName(z.sp, true), place: zonePlace(z), to: fmtHour(to) });

// Compass point of a bearing (0 = north, clockwise, radians) as words.
export function dirName(bearing) {
  const i = Math.round(((((bearing * 180) / Math.PI) % 360) + 360) % 360 / 45) % 8;
  return gt(['dN', 'dNE', 'dE', 'dSE', 'dS', 'dSW', 'dW', 'dNW'][i]);
}
