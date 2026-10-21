import { settings, setSetting } from './settings.js';

// English / Arabic. Static page text is marked with data-i18n="key": the
// English stays in the HTML and is restored from there, the Arabic comes
// from AR below. Text built in code goes through t(key, vars).

export const isAr = () => settings.lang === 'ar';

const AR = {
  brandSub: 'فرّي · سمن · شكب · صلنج · كيخن · ترغل · مطوّق — على سناسل وسهول وأحراج لبنان',
  choose: 'اختار مكان الصيد',
  hunter: 'الصياد',
  name: 'الاسم',
  dog: 'خود كلب الصيد معك',
  settings: 'الإعدادات',
  guide: 'دليل الطيور',
  menuTip: 'الرسومات والماوس والصوت ومساعدة التصويب كلّها بالإعدادات، وبتنحفظ للمرّة الجاية.',
  play: 'العب',
  solo: 'صيد لوحدك',
  host: 'افتح صيدة وادعِ رفقاتك',
  join: 'انضم',
  controls: 'التحكّم',
  keys:
    '<b>WASD</b> مشي · <b>Shift</b> ركض · <b>C</b> انحناء · <b>Space</b> قفز<br /><b>الماوس اليمين</b> رفع البارودة · <b>الماوس الشمال</b> قوّص<br /><b>R</b> تعبئة · <b>E</b> لمّ الطير · <b>B</b> منظار<br /><b>Q</b> صفّير (بيجيب السمن والصلنج) · <b>F</b> الكلب · <b>M</b> الخريطة · <b>Tab</b> الجعبة والنتائج · <b>Enter</b> دردشة',
  playTip: 'قدّم عالطير المعترض — الخردق بياخد وقت ليوصل. المدى الفعّال حوالي ٣٥ متر. اللقلق محمي: ما تقوّص عليه أبداً. جرّب بارودتك على لوحات التدريب حدّ مكان البداية.',
  challenges: 'التحديات',
  preparing: 'عم نحضّر أرض الصيد…',
  pauseContinue: 'اكبس لتكمّل الصيد',
  endHunt: 'خلّص الصيدة',
  rest: 'ارتاح بالفيّ لطلعة العصر',
  tabControls: 'التحكّم',
  tabGun: 'البارودة',
  tabGraphics: 'الرسومات',
  tabSound: 'الصوت',
  tabAssists: 'مساعدة التصويب',
  sens: 'حساسية الماوس',
  adsSens: 'الحساسية والبارودة مرفوعة',
  fov: 'مجال الرؤية',
  invertY: 'اقلب الماوس فوق/تحت',
  keysSmall:
    '<b>WASD</b> مشي · <b>Shift</b> ركض · <b>C</b> انحناء · <b>Space</b> قفز · <b>الماوس اليمين</b> رفع البارودة · <b>الماوس الشمال</b> قوّص · <b>R</b> تعبئة · <b>E</b> لمّ الطير · <b>B</b> منظار · <b>Q</b> صفّير · <b>F</b> الكلب: لهون / فتّش / هجوم · <b>M</b> الخريطة · <b>Tab</b> الجعبة والرميات · <b>Enter</b> دردشة · <b>Esc</b> توقيف<br />اليد: العصا الشمال مشي · العصا اليمين نظر · <b>R2</b> قوّص · <b>L2</b> ارفع البارودة · <b>✕</b> قفز · <b>○</b> انحناء · <b>□</b> تعبئة · <b>△</b> لمّ الطير · <b>L1</b> منظار · <b>R1</b> صفّير · <b>↑</b> الكلب · <b>↓</b> الخريطة · <b>L3</b> ركض · <b>Options</b> توقيف',
  choke0: 'شوك السبطانة الأولى (التحتانية)',
  choke1: 'شوك السبطانة التانية (الفوقانية)',
  cartridges: 'الخرطوش',
  gunTip: 'الشوك المفتوح بيفلّش الخردق للطير القريب، والشوك الخانق بيضبّ الرشّة للبعيد. جرّبهم على لوحات التدريب. التغيير بيصير بالصيدة الجاية.',
  quality: 'الجودة',
  qualityTip: 'تغيير الجودة بيصير بالصيدة الجاية.',
  renderScale: 'دقّة العرض',
  showFps: 'اعرض عدد الإطارات بالثانية',
  volMaster: 'الصوت العام',
  volEffects: 'البارودة والخطوات والجوانح',
  volBirds: 'أصوات الطيور',
  volAmbience: 'أجواء الطبيعة',
  volVoice: 'الأصوات',
  volMusic: 'الموسيقى',
  companion: 'أبو علي، رفيقك بالصيد، بينادي عالطيور',
  soundTip: 'الأحسن مع سمّاعات: بتعرف من وين جايي السرب من صوته.',
  crosshair: 'نقطة التصويب',
  hitMarker: 'علامة الإصابة',
  shotFeedback: 'قلّي كيف خطيت (ورا، قدّام، فوق، تحت)',
  markers: 'اعرض الطير الواقع عالبوصلة',
  assistTip: 'طفّيهن إذا بدّك صيد أقرب للحقيقة.',
  hints: 'نصايح للصيّاد الجديد',
  guideTip: 'أسماء الطيور متل ما بيسمّوها الصيّادين بلبنان. الأسامي بتختلف من ضيعة لضيعة.',
  endOfHunt: 'آخر النهار',
  backToMenu: 'رجوع للقائمة',
  mapKey: '<b>M</b> سكّر · <span style="color:#e2a23b">●</span> طيورك · <span style="color:#8fc0ff">●</span> رفقاتك · <span style="color:#e2a23b">—</span> طريقك · ▪ لوحات التدريب',
};

// Placeholders and <option> labels.
const AR_ATTR = {
  namePh: 'أبو علي',
  codePh: 'الرمز',
  chatPh: 'قول شي…',
  'opt.CYL': 'سيلندر (مفتوح)',
  'opt.IC': 'ربع شوك',
  'opt.M': 'نص شوك',
  'opt.IM': 'تلات أرباع شوك',
  'opt.F': 'شوك كامل (فول)',
  'opt.7.5': '#٧½ — خردق أقل وأقوى (مطوّق، رميات بعيدة)',
  'opt.8': '#٨ — للكل (سمن، فرّي، ترغل)',
  'opt.9': '#٩ — خردق ناعم وكتير (فرّي وشكب عن قريب)',
  'opt.auto': 'تلقائي (حسب كرت الشاشة)',
  'opt.low': 'منخفضة (لابتوب)',
  'opt.medium': 'متوسطة',
  'opt.high': 'عالية (كمبيوتر ألعاب)',
  'opt.ultra': 'فائقة (كرت قوي)',
  'opt.rsDyn': 'متغيّرة (بتحافظ عالسرعة)',
};

// Text built in code: { en, ar }, with {name} placeholders.
const STR = {
  load1: { en: 'Shaping the mountains…', ar: 'عم نرسم الجبال…' },
  load2: { en: 'Laying textures…', ar: 'عم نفرش الأرض…' },
  load3: { en: 'Building the stone house…', ar: 'عم نعمّر البيت الحجر…' },
  load4: { en: 'Planting olive, oak and pine…', ar: 'عم نزرع الزيتون والسنديان والصنوبر…' },
  load5: { en: 'Growing grass…', ar: 'عم نطلّع الحشيش…' },
  load6: { en: 'Drawing the map…', ar: 'عم نرسم الخريطة…' },
  load7: { en: 'Compiling shaders…', ar: 'عم نجهّز الرسومات…' },
  ready: { en: 'Ready', ar: 'جاهز' },
  dogPoint: { en: 'The dog is on point! · الكلب واقف — walk in, or <b>F</b> to send it in', ar: 'الكلب واقف! تقدّم عليه، أو اكبس <b>F</b> ليهجم' },
  lookingFor: { en: 'Looking for: {list}', ar: 'الطير اليوم: {list}' },
  bigDay: { en: 'A big passage day — birds are pouring through! · يوم مرقة', ar: 'يوم مرقة! الطير عم يمرق بكترة' },
  quietDay: { en: 'A quiet morning — few birds moving today', ar: 'صبحية هادية — الطير قليل اليوم' },
  wind: { en: 'Wind {dir} {speed} m/s · ريح {ar}', ar: 'ريح {ar} · {speed} م/ث' },
  shareCode: { en: 'Share the code {code} with your friends', ar: 'ابعت الرمز {code} لرفقاتك' },
  left: { en: '{name} left the hunt', ar: '{name} فلّ من الصيدة' },
  joined: { en: '{name} joined the hunt', ar: '{name} انضمّ للصيدة' },
  hostEnded: { en: 'The host ended the hunt.', ar: 'صاحب الصيدة سكّرها.' },
  huntingWith: { en: '{name} is hunting with you', ar: '{name} عم يصيد معك' },
  unsafe: { en: 'Unsafe shot — {name} was in your line! −50 · انتبه عرفيقك', ar: 'رمية خطرة — {name} كان بوجّ البارودة! −٥٠' },
  unsafeDog: { en: "Careful — {name}'s dog was in your line! · انتبه عالكلب", ar: 'انتبه — كلب {name} كان بوجّ البارودة!' },
  unsafeMyDog: { en: 'Careful — your dog was in the line of fire! · انتبه عالكلب', ar: 'انتبه — كلبك كان بوجّ البارودة!' },
  onlyPellets: { en: '{tag} · only {n} pellet(s) struck{how}', ar: '{tag} · بس {n} خردقة صابت{how}' },
  missed: { en: 'missed', ar: 'راحت' },
  challenge: { en: 'Challenge: {title}', ar: 'تحدّي: {title}' },
  challengeDaily: { en: 'Challenge of the day: {title} · +50', ar: 'تحدّي اليوم: {title} · +٥٠' },
  board: { en: 'Board at {d} m · {choke}, {shot}: {on} pellets on the paper, {in} in the 75 cm circle ({pct}%)', ar: 'لوحة {d} م · {choke}، {shot}: {on} خردقة عالورقة، {in} جوّا دايرة ٧٥ سم ({pct}٪)' },
  stork: { en: '{ar} You shot a protected White Stork! −250 · طير محمي', ar: 'قوّصت لقلق محمي! −٢٥٠' },
  down: { en: '{ar} {en} down — {d} m', ar: '{ar} وقع — {d} م' },
  friendDown: { en: '{name}: {ar} {en}', ar: '{name}: {ar}' },
  wounded: { en: 'Hit the {ar} — wounded, mark where it drops', ar: 'انصاب ال{ar} — شوف وين بيوقع' },
  intoBag: { en: 'Into the bag: {ar} {en}{whose}', ar: 'عالجعبة: {ar}{whose}' },
  whistleFlock: { en: 'A flock turns towards your whistle…', ar: 'السرب لفّ عصوت الصفّير…' },
  dogGo: { en: 'Go on! · هيا', ar: 'هيّا!' },
  dogHeel: { en: 'Heel · لهون', ar: 'لهون!' },
  dogHunt: { en: 'Hunt on · فتّش', ar: 'فتّش!' },
  dogHunting: { en: 'Dog: <b>hunting</b>', ar: 'الكلب: <b>عم يفتّش</b>' },
  dogHeeling: { en: 'Dog: <b>at heel</b>', ar: 'الكلب: <b>حدّك</b>' },
  dogPointing: { en: 'Dog: <b>on point!</b>', ar: 'الكلب: <b>واقف!</b>' },
  dogFetching: { en: 'Dog: <b>fetching</b>', ar: 'الكلب: <b>عم يجيب الطير</b>' },
  best: { en: 'Your best day: {n} birds · {s} points', ar: 'أحسن نهار إلك: {n} طير · {s} نقطة' },
  rested: { en: 'You rest in the shade through the midday lull… the evening flight is starting', ar: 'ارتحت بالفيّ وقت الضهر… هلّق بلّشت طلعة العصر' },
  nightfall: { en: 'Night has fallen — time to head home · خلص النهار', ar: 'خلص النهار — يلا عالبيت' },
  fading: { en: 'The light is fading — last chances of the day', ar: 'الضو عم يروح — آخر فرص النهار' },
  pickUp: { en: '<b>E</b> pick up {ar} {en}', ar: '<b>E</b> لمّ ال{ar}' },
  boardsPrompt: { en: 'Practice boards at {list} m to your right — shoot one to see your pattern', ar: 'لوحات التدريب على {list} م عاليمين — قوّص على وحدة لتشوف الرشّة' },
  edge: { en: 'Edge of the hunting ground · حدود منطقة الصيد', ar: 'حدود منطقة الصيد' },
  reload: { en: '<b>R</b> reload', ar: '<b>R</b> عبّي' },
  gameBag: { en: 'Game bag · الجعبة', ar: 'الجعبة' },
  empty: { en: 'empty', ar: 'فاضية' },
  score: { en: 'Score', ar: 'النقاط' },
  shells: { en: '{n} shells', ar: '{n} خرطوشة' },
  reloading: { en: 'reloading…', ar: 'عم يعبّي…' },
  huntCode: { en: 'Hunt code', ar: 'رمز الصيدة' },
  hunters: { en: '{n} hunter(s)', ar: '{n} صيّاد' },
  windHud: { en: 'wind {s} m/s', ar: 'ريح {s} م/ث' },
  sbHunter: { en: 'Hunter', ar: 'الصياد' },
  sbHits: { en: 'Hits/Shots', ar: 'إصابات/رميات' },
  sbScore: { en: 'Score', ar: 'النقاط' },
  sbLast: { en: 'Your last shots', ar: 'آخر رمياتك' },
  sbDown: { en: 'down ({n} pellets)', ar: 'وقع ({n} خردقة)' },
  sbNoBird: { en: 'no bird near the line', ar: 'ما في طير عالخط' },
  // shot feedback
  behind: { en: 'behind by {m} m', ar: 'ورا الطير بـ{m} م' },
  ahead: { en: 'ahead by {m} m', ar: 'قدّام الطير بـ{m} م' },
  leftBy: { en: 'left by {m} m', ar: 'عالشمال بـ{m} م' },
  rightBy: { en: 'right by {m} m', ar: 'عاليمين بـ{m} م' },
  over: { en: 'over by {m} m', ar: 'فوقه بـ{m} م' },
  under: { en: 'under by {m} m', ar: 'تحته بـ{m} م' },
  thin: { en: 'pattern was on it, but too thin at this range', ar: 'الرشّة كانت عليه بس خفيفة عهالبعد' },
  unlucky: { en: 'pattern was on it — unlucky gap', ar: 'الرشّة كانت عليه — مرق من بين الخردق' },
  weak: { en: ' · at {d} m the pellets are weak', ar: ' · على {d} م الخردق ضعيف' },
  // summary
  stBag: { en: 'birds in the bag', ar: 'طير بالجعبة' },
  stScore: { en: 'score', ar: 'النقاط' },
  stShots: { en: 'shots', ar: 'رمية' },
  stRate: { en: 'birds per shot', ar: 'طير لكل رمية' },
  stLongest: { en: 'longest kill', ar: 'أبعد طير' },
  stAvg: { en: 'average shot', ar: 'معدّل البعد' },
  tipBehind: { en: 'Most misses on crossing birds were <b>behind</b> ({n} of {of}). Swing through the bird and keep the gun moving as you fire — at 30 m a crossing thrush needs about 1.5 m of lead.', ar: 'أكتر رمياتك عالطير المعترض راحت <b>وراه</b> ({n} من {of}). لحّق الطير بالبارودة وكفّي حرّكها وإنت عم تقوّص — السمنة المعترضة على ٣٠ م بدّها حوالي متر ونص قدّامها.' },
  tipAhead: { en: 'You were often <b>ahead</b> of crossing birds ({n} times). Give them a little less lead.', ar: 'كنت كتير <b>قدّام</b> الطير المعترض ({n} مرّات). قدّم أقل شوي.' },
  tipUnder: { en: 'Several shots went <b>under</b> ({n}). Rising birds climb as the shot travels — cover them with the barrels.', ar: 'كذا رمية راحت <b>تحت</b> ({n}). الطير الطالع بيعلى وقت ما الخردق ماشي — غطّيه بالسبطانة.' },
  tipOver: { en: 'Several shots went <b>over</b> ({n}). Dropping or landing birds need you to stay underneath them.', ar: 'كذا رمية راحت <b>فوق</b> ({n}). الطير النازل بدّك تضل تحته.' },
  tipFar: { en: '{n} shots were beyond 45 m, where the pattern is too thin to kill cleanly. Let them come closer.', ar: '{n} رميات كانت أبعد من ٤٥ م، والرشّة هونيك خفيفة. خلّي الطير يقرّب.' },
  tipGood: { en: 'Good shooting — no clear pattern in your misses.', ar: 'تقويص منيح — ما في غلطة وحدة عم تتكرّر.' },
  tipNone: { en: 'No shots at birds today. Walk slowly, use the binoculars and the whistle to bring flocks in.', ar: 'ما قوّصت عطير اليوم. امشي عمهلك، واستعمل المنظار والصفّير لتجيب السروب.' },
  challengesDone: { en: 'Challenges', ar: 'التحديات' },
  thTime: { en: 'Time', ar: 'الوقت' },
  thBird: { en: 'Bird', ar: 'الطير' },
  thRange: { en: 'Range', ar: 'البعد' },
  thBarrel: { en: 'Barrel', ar: 'الشوك' },
  thResult: { en: 'Result', ar: 'النتيجة' },
  thHow: { en: 'How', ar: 'كيف' },
  resDown: { en: 'down', ar: 'وقع' },
  resHit: { en: 'hit', ar: 'انصاب' },
  resMiss: { en: 'miss', ar: 'راحت' },
  pellets: { en: '{n} pellets', ar: '{n} خردقة' },
  // guide
  gSize: { en: 'Size', ar: 'الحجم' },
  gFlight: { en: 'Flight', ar: 'الطيران' },
  gNotes: { en: 'Notes', ar: 'ملاحظات' },
  gWhere: { en: 'In the game', ar: 'وين بتلاقيه' },
  gSizeVal: { en: '{l} cm long, {w} cm wingspan', ar: 'طوله {l} سم، وفرد جوانحه {w} سم' },
  gProtected: { en: 'Protected — never shoot. −250 points.', ar: 'محمي — ممنوع تقوّص عليه. −٢٥٠ نقطة.' },
  gGame: { en: 'Game bird · {p} points', ar: 'طير صيد · {p} نقطة' },
  gListen: { en: '▶ Listen to the call', ar: '▶ اسمع صوته' },
};

export function t(key, vars = {}) {
  const e = STR[key];
  let s = e ? (isAr() ? e.ar : e.en) : key;
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(v);
  return s;
}

// Western digits to Arabic-Indic, for numbers shown in Arabic text.
export function num(v) {
  const s = String(v);
  return isAr() ? s.replace(/[0-9]/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]) : s;
}

export function applyI18n(root = document) {
  const ar = isAr();
  const html = document.documentElement;
  html.lang = ar ? 'ar' : 'en';
  html.classList.toggle('lang-ar', ar);
  for (const el of root.querySelectorAll('[data-i18n]')) {
    if (el.dataset.en == null) el.dataset.en = el.innerHTML;
    el.innerHTML = ar && AR[el.dataset.i18n] != null ? AR[el.dataset.i18n] : el.dataset.en;
  }
  for (const el of root.querySelectorAll('[data-i18n-ph]')) {
    if (el.dataset.enPh == null) el.dataset.enPh = el.placeholder;
    el.placeholder = ar ? AR_ATTR[el.dataset.i18nPh] || el.dataset.enPh : el.dataset.enPh;
  }
  for (const el of root.querySelectorAll('option')) {
    const key = el.dataset.i18nOpt || (el.parentElement.dataset.setting === 'quality' ? `opt.${el.value}` : null) || (['choke0', 'choke1', 'shotSize'].includes(el.parentElement.dataset.setting) ? `opt.${el.value}` : null);
    if (!key) continue;
    if (el.dataset.en == null) el.dataset.en = el.textContent;
    el.textContent = ar && AR_ATTR[key] ? AR_ATTR[key] : el.dataset.en;
  }
}

export function setLang(lang) {
  setSetting('lang', lang);
  applyI18n();
}
