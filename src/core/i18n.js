import { settings, setSetting } from './settings.js';

// English (the default) / Modern Standard Arabic. Static page text is
// marked with data-i18n="key": the English stays in the HTML and is restored
// from there, the Arabic comes from AR below. Text built in code goes
// through t(key, vars). English text never contains Arabic.

export const isAr = () => settings.lang === 'ar';

const AR = {
  title: 'صيد لبنان',
  titleSmall: 'صيد لبنان',
  brandEn: 'صيد الطيور <span>ثلاثي الأبعاد</span>',
  brandSub: 'السمّان والسمنة ودجاجة الأرض والشرشور وسمنة الحقول والقمري والحمام الخشبي، على مصاطب لبنان وسهوله وغاباته',
  choose: 'اختر أرض الصيد',
  hunter: 'الصياد',
  name: 'الاسم',
  dog: 'اصطحب كلب الصيد',
  settings: 'الإعدادات',
  guide: 'دليل الطيور',
  menuTip: 'الرسومات والفأرة والصوت ومساعدات التصويب كلها في الإعدادات، وتُحفظ للمرة القادمة.',
  play: 'العب',
  solo: 'صيد منفرد',
  host: 'استضف رحلة صيد مع الأصدقاء',
  join: 'انضم',
  controls: 'التحكم',
  keys:
    '<b>WASD</b> مشي · <b>Shift</b> ركض · <b>C</b> انحناء · <b>Space</b> قفز<br />' +
    '<b>زر الفأرة الأيمن</b> رفع البندقية · <b>زر الفأرة الأيسر</b> إطلاق<br />' +
    '<b>R</b> إعادة التعبئة · <b>E</b> التقاط الطائر · <b>B</b> المنظار<br />' +
    '<b>Q</b> استخدام النداء · <b>V</b> تغيير النداء · <b>F</b> الكلب · <b>G</b> الطُّعوم · <b>M</b> الخريطة · <b>Tab</b> الجعبة والنتائج · <b>Enter</b> المحادثة',
  playTip: 'صوّب أمام الطائر العابر، فالطلقة تحتاج وقتًا لتصل. المدى الفعّال نحو ٣٥ مترًا. لا تطلق النار على اللقالق أبدًا فهي محمية. جرّب بندقيتك على لوحات التدريب قرب نقطة البداية.',
  challenges: 'التحديات',
  preparing: 'جارٍ تجهيز أرض الصيد…',
  pauseContinue: 'انقر لمتابعة الصيد',
  endHunt: 'إنهاء رحلة الصيد',
  rest: 'استرح في الظل حتى طيران المساء',
  tabControls: 'التحكم',
  tabGun: 'البندقية',
  tabGraphics: 'الرسومات',
  tabSound: 'الصوت',
  tabAssists: 'مساعدات التصويب',
  sens: 'حساسية الفأرة',
  adsSens: 'الحساسية عند رفع البندقية',
  fov: 'مجال الرؤية',
  invertY: 'عكس حركة الفأرة العمودية',
  keysSmall:
    '<b>WASD</b> مشي · <b>Shift</b> ركض · <b>C</b> انحناء · <b>Space</b> قفز · ' +
    '<b>زر الفأرة الأيمن</b> رفع البندقية · <b>زر الفأرة الأيسر</b> إطلاق · ' +
    '<b>R</b> إعادة التعبئة · <b>E</b> التقاط · <b>B</b> المنظار (رصد الطيور ووسمها) · <b>Q</b> النداء · <b>V</b> تغيير النداء · ' +
    '<b>F</b> الكلب · <b>G</b> الطُّعوم · <b>M</b> الخريطة · <b>Tab</b> الجعبة والطلقات · ' +
    '<b>Enter</b> المحادثة · <b>Esc</b> إيقاف مؤقت<br />' +
    'يد التحكم: العصا اليسرى للمشي · العصا اليمنى للنظر · <b>R2</b> إطلاق · <b>L2</b> رفع البندقية · ' +
    '<b>✕</b> قفز · <b>○</b> انحناء · <b>□</b> إعادة التعبئة · <b>△</b> التقاط · <b>L1</b> المنظار · ' +
    '<b>R1</b> النداء · <b>→</b> تغيير النداء · <b>↑</b> الكلب · <b>↓</b> الخريطة · <b>L3</b> ركض · <b>R3</b> الطُّعوم · <b>Options</b> إيقاف مؤقت',
  choke0: 'خانق السبطانة الأولى (السفلية)',
  choke1: 'خانق السبطانة الثانية (العلوية)',
  cartridges: 'الخراطيش',
  gunTip: 'الخانق المفتوح ينشر الرشّ للطيور القريبة، والخانق الضيق يجمعه للبعيدة. جرّبها على لوحات التدريب. يُطبَّق التغيير في رحلة الصيد التالية.',
  quality: 'الجودة',
  qualityTip: 'يُطبَّق تغيير الجودة في رحلة الصيد التالية.',
  renderScale: 'دقة العرض',
  showFps: 'عرض عدد الإطارات في الثانية',
  volMaster: 'الصوت العام',
  volEffects: 'البندقية والخطوات والأجنحة',
  volBirds: 'أصوات الطيور',
  volAmbience: 'أصوات الطبيعة',
  volVoice: 'الأصوات',
  volMusic: 'الموسيقى',
  companion: 'رفيق الصيد يعلن عن الطيور بصوته',
  soundTip: 'الأفضل استخدام سماعات الرأس: ستعرف من أين يأتي السرب من صوته.',
  crosshair: 'نقطة التصويب',
  hitMarker: 'علامة الإصابة',
  shotFeedback: 'أخبرني كيف أخطأت (خلف، أمام، فوق، تحت)',
  markers: 'عرض الطيور الساقطة على البوصلة',
  hints: 'نصائح للصياد الجديد',
  assistTip: 'أوقفها لصيد أقرب إلى الواقع.',
  guideTip: 'أسماء الطيور بالعربية الفصحى، مع وصف طيرانها وموسمها في لبنان.',
  endOfHunt: 'نهاية رحلة الصيد',
  backToMenu: 'العودة إلى القائمة',
  lodgeTitle: 'سجل الجوائز',
  mapKey: '<b>M</b> إغلاق · <span style="color:#e2a23b">●</span> طيورك · <span style="color:#8fc0ff">●</span> أصدقاؤك · <span style="color:#e2a23b">—</span> مسارك · ▪ لوحات التدريب',
};

// Placeholders and <option> labels.
const AR_ATTR = {
  namePh: 'أبو علي',
  codePh: 'الرمز',
  chatPh: 'اكتب رسالة…',
  'opt.CYL': 'أسطواني (مفتوح)',
  'opt.IC': 'ربع خانق',
  'opt.M': 'نصف خانق',
  'opt.IM': 'ثلاثة أرباع خانق',
  'opt.F': 'خانق كامل',
  'opt.7.5': '#٧½ — رشّ أقل وأقوى (الحمام الخشبي والطلقات البعيدة)',
  'opt.8': '#٨ — للاستخدام العام (السمنة والسمّان والقمري)',
  'opt.9': '#٩ — رشّ ناعم وكثير (السمّان ودجاجة الأرض عن قرب)',
  'opt.auto': 'تلقائي (حسب بطاقة الرسومات)',
  'opt.low': 'منخفضة (حواسيب محمولة)',
  'opt.medium': 'متوسطة',
  'opt.high': 'عالية (حاسوب ألعاب)',
  'opt.ultra': 'فائقة (بطاقة رسومات قوية)',
  'opt.rsDyn': 'متغيّرة (تحافظ على السلاسة)',
};

// Text built in code: { en, ar }, with {name} placeholders.
const STR = {
  load1: { en: 'Shaping the mountains…', ar: 'جارٍ تشكيل الجبال…' },
  load2: { en: 'Laying textures…', ar: 'جارٍ فرش الأرض…' },
  load3: { en: 'Building the stone house…', ar: 'جارٍ بناء البيت الحجري…' },
  load4: { en: 'Planting olive, oak and pine…', ar: 'جارٍ غرس الزيتون والبلوط والصنوبر…' },
  load5: { en: 'Growing grass…', ar: 'جارٍ إنبات العشب…' },
  load6: { en: 'Drawing the map…', ar: 'جارٍ رسم الخريطة…' },
  load7: { en: 'Compiling shaders…', ar: 'جارٍ تجهيز الرسومات…' },
  ready: { en: 'Ready', ar: 'جاهز' },
  pageTitle: { en: 'Lebanon Hunt 3D', ar: 'صيد لبنان' },
  dogPoint: { en: 'Your dog is on point! Walk in, or press <b>F</b> to send it in', ar: 'كلبك يؤشّر! تقدّم، أو اضغط <b>F</b> ليطيّر الطائر' },
  lookingFor: { en: 'Birds today: {list}', ar: 'طيور اليوم: {list}' },
  bigDay: { en: 'A big passage day — birds are pouring through!', ar: 'يوم عبور كثيف — الطيور تمرّ بأعداد كبيرة!' },
  quietDay: { en: 'A quiet morning — few birds moving today', ar: 'صباح هادئ — الطيور قليلة اليوم' },
  wind: { en: 'Wind from the {dir}, {speed} m/s', ar: 'رياح {ar} بسرعة {speed} م/ث' },
  shareCode: { en: 'Share the code {code} with your friends', ar: 'شارك الرمز {code} مع أصدقائك' },
  left: { en: '{name} left the hunt', ar: 'غادر {name} رحلة الصيد' },
  joined: { en: '{name} joined the hunt', ar: 'انضم {name} إلى رحلة الصيد' },
  hostEnded: { en: 'The host ended the hunt.', ar: 'أنهى المضيف رحلة الصيد.' },
  huntingWith: { en: '{name} is hunting with you', ar: '{name} يصطاد معك' },
  unsafe: { en: 'Unsafe shot — {name} was in your line of fire! −50', ar: 'طلقة خطرة — كان {name} في خط النار! −٥٠' },
  unsafeDog: { en: "Careful — {name}'s dog was in your line of fire!", ar: 'انتبه — كان كلب {name} في خط النار!' },
  unsafeMyDog: { en: 'Careful — your dog was in the line of fire!', ar: 'انتبه — كان كلبك في خط النار!' },
  onlyPellets: { en: '{tag} · only {n} pellet(s) struck{how}', ar: '{tag} · أصابته {n} حبات فقط{how}' },
  missed: { en: 'missed', ar: 'أخطأت' },
  challenge: { en: 'Challenge complete: {title}', ar: 'اكتمل التحدي: {title}' },
  challengeDaily: { en: 'Challenge of the day complete: {title} · +50', ar: 'اكتمل تحدي اليوم: {title} · +٥٠' },
  board: {
    en: 'Board at {d} m · {choke}, {shot}: {on} pellets on the paper, {in} in the 75 cm circle ({pct}%)',
    ar: 'لوحة على {d} م · {choke}، {shot}: {on} حبة على الورقة، {in} داخل دائرة ٧٥ سم ({pct}٪)',
  },
  stork: { en: 'You shot a protected White Stork! −250', ar: 'أصبت لقلقًا أبيض محميًا! −٢٥٠' },
  down: { en: '{name} down — {d} m', ar: 'سقط {name} — {d} م' },
  friendDown: { en: '{who}: {name}', ar: '{who}: {name}' },
  wounded: { en: 'Hit the {name} — wounded, mark where it drops', ar: 'أصبت {name} — إنه جريح، راقب أين يسقط' },
  intoBag: { en: 'Into the bag: {name}{whose}', ar: 'إلى الجعبة: {name}{whose}' },
  whistleFlock: { en: 'A flock turns towards your whistle…', ar: 'سرب يستدير نحو صفيرك…' },
  dogGo: { en: 'Go on!', ar: 'هيا!' },
  dogHeel: { en: 'Heel', ar: 'إلى جانبي' },
  dogHunt: { en: 'Hunt on', ar: 'ابحث' },
  fading: { en: 'The light is fading — last chances of the day', ar: 'الضوء يخفت — آخر فرص النهار' },
  rested: { en: 'You rest in the shade through the midday lull… the evening flight is starting', ar: 'استرحت في الظل وقت الظهيرة… بدأ طيران المساء' },
  nightfall: { en: 'Night has fallen — time to head home', ar: 'حلّ الليل — حان وقت العودة' },
  pickUp: { en: '<b>E</b> pick up the {name}', ar: '<b>E</b> التقط {name}' },
  boardsPrompt: { en: 'Practice boards at {list} m to your right — shoot one to see your pattern', ar: 'لوحات تدريب على بعد {list} م إلى يمينك — أطلق على واحدة لترى انتشار الرش' },
  edge: { en: 'Edge of the hunting ground', ar: 'حدود أرض الصيد' },
  reload: { en: '<b>R</b> reload', ar: '<b>R</b> أعد التعبئة' },
  gameBag: { en: 'Game bag', ar: 'الجعبة' },
  empty: { en: 'empty', ar: 'فارغة' },
  score: { en: 'Score', ar: 'النقاط' },
  shells: { en: '{n} shells', ar: '{n} خرطوشة' },
  reloading: { en: 'reloading…', ar: 'إعادة التعبئة…' },
  huntCode: { en: 'Hunt code', ar: 'رمز الرحلة' },
  hunters: { en: '{n} hunter(s)', ar: '{n} صياد' },
  windHud: { en: 'wind {s} m/s', ar: 'الرياح {s} م/ث' },
  sbHunter: { en: 'Hunter', ar: 'الصياد' },
  sbHits: { en: 'Hits/Shots', ar: 'إصابات/طلقات' },
  sbScore: { en: 'Score', ar: 'النقاط' },
  sbLast: { en: 'Your last shots', ar: 'طلقاتك الأخيرة' },
  sbDown: { en: 'down ({n} pellets)', ar: 'سقط ({n} حبات)' },
  sbNoBird: { en: 'no bird near the line', ar: 'لا طائر قرب خط الإطلاق' },
  behind: { en: 'behind by {m} m', ar: 'خلف الطائر بـ{m} م' },
  ahead: { en: 'ahead by {m} m', ar: 'أمام الطائر بـ{m} م' },
  leftBy: { en: 'left by {m} m', ar: 'إلى اليسار بـ{m} م' },
  rightBy: { en: 'right by {m} m', ar: 'إلى اليمين بـ{m} م' },
  over: { en: 'over by {m} m', ar: 'فوقه بـ{m} م' },
  under: { en: 'under by {m} m', ar: 'تحته بـ{m} م' },
  thin: { en: 'pattern was on it, but too thin at this range', ar: 'كان الرش عليه، لكنه متفرق جدًا على هذه المسافة' },
  unlucky: { en: 'pattern was on it — unlucky gap', ar: 'كان الرش عليه — مرّ من فجوة' },
  weak: { en: ' · at {d} m the pellets are weak', ar: ' · على {d} م يكون الرش ضعيفًا' },
  stBag: { en: 'birds in the bag', ar: 'طائر في الجعبة' },
  stScore: { en: 'score', ar: 'النقاط' },
  stShots: { en: 'shots', ar: 'طلقة' },
  stRate: { en: 'birds per shot', ar: 'طائر لكل طلقة' },
  stLongest: { en: 'longest kill', ar: 'أبعد إصابة' },
  stAvg: { en: 'average shot', ar: 'متوسط المسافة' },
  tipBehind: {
    en: 'Most misses on crossing birds were <b>behind</b> ({n} of {of}). Swing through the bird and keep the gun moving as you fire — at 30 m a crossing thrush needs about 1.5 m of lead.',
    ar: 'معظم طلقاتك على الطيور العابرة كانت <b>خلفها</b> ({n} من {of}). مرّر البندقية عبر الطائر وتابع تحريكها أثناء الإطلاق — السمنة العابرة على ٣٠ م تحتاج إلى تقديم نحو متر ونصف.',
  },
  tipAhead: { en: 'You were often <b>ahead</b> of crossing birds ({n} times). Give them a little less lead.', ar: 'كنت كثيرًا <b>أمام</b> الطيور العابرة ({n} مرات). قلّل التقديم قليلًا.' },
  tipUnder: { en: 'Several shots went <b>under</b> ({n}). Rising birds climb as the shot travels — cover them with the barrels.', ar: 'عدة طلقات مرّت <b>تحت</b> الطائر ({n}). الطائر الصاعد يرتفع أثناء مسير الطلقة، فغطّه بالسبطانة.' },
  tipOver: { en: 'Several shots went <b>over</b> ({n}). Dropping or landing birds need you to stay underneath them.', ar: 'عدة طلقات مرّت <b>فوق</b> الطائر ({n}). الطائر الهابط يتطلب أن تبقى تحته.' },
  tipFar: { en: '{n} shots were beyond 45 m, where the pattern is too thin to kill cleanly. Let them come closer.', ar: '{n} طلقات كانت أبعد من ٤٥ م، حيث يكون الرش متفرقًا جدًا. دع الطيور تقترب.' },
  tipGood: { en: 'Good shooting — no clear pattern in your misses.', ar: 'رماية جيدة — لا نمط واضح في أخطائك.' },
  tipNone: { en: 'No shots at birds today. Walk slowly, use the binoculars and the whistle to bring flocks in.', ar: 'لم تطلق على أي طائر اليوم. امشِ ببطء واستخدم المنظار والصفير لجذب الأسراب.' },
  challengesDone: { en: 'Challenges', ar: 'التحديات' },
  todayPlus: { en: 'today +50', ar: 'اليوم +٥٠' },
  thTime: { en: 'Time', ar: 'الوقت' },
  thBird: { en: 'Bird', ar: 'الطائر' },
  thRange: { en: 'Range', ar: 'المسافة' },
  thBarrel: { en: 'Choke', ar: 'الخانق' },
  thResult: { en: 'Result', ar: 'النتيجة' },
  thHow: { en: 'How', ar: 'كيف' },
  resDown: { en: 'down', ar: 'سقط' },
  resHit: { en: 'hit', ar: 'أُصيب' },
  resMiss: { en: 'miss', ar: 'خطأ' },
  pellets: { en: '{n} pellets', ar: '{n} حبات' },
  gSize: { en: 'Size', ar: 'الحجم' },
  gFlight: { en: 'Flight', ar: 'الطيران' },
  gNotes: { en: 'Notes', ar: 'ملاحظات' },
  gWhere: { en: 'In the game', ar: 'أين تجده' },
  gSizeVal: { en: '{l} cm long, {w} cm wingspan', ar: 'الطول {l} سم، وامتداد الجناحين {w} سم' },
  gProtected: { en: 'Protected — never shoot. −250 points.', ar: 'طائر محمي — لا تطلق عليه أبدًا. −٢٥٠ نقطة.' },
  gGame: { en: 'Game bird · {p} points', ar: 'طائر صيد · {p} نقطة' },
  gListen: { en: '▶ Listen to the call', ar: '▶ استمع إلى صوته' },
  dogHunting: { en: 'Dog: <b>hunting</b>', ar: 'الكلب: <b>يبحث</b>' },
  dogHeeling: { en: 'Dog: <b>at heel</b>', ar: 'الكلب: <b>إلى جانبك</b>' },
  dogPointing: { en: 'Dog: <b>on point!</b>', ar: 'الكلب: <b>يؤشّر!</b>' },
  dogFetching: { en: 'Dog: <b>fetching</b>', ar: 'الكلب: <b>يحضر الطائر</b>' },
  best: { en: 'Your best day: {n} birds · {s} points', ar: 'أفضل يوم لك: {n} طيور · {s} نقطة' },
  decoysOut: { en: 'Three {name} decoys set out, facing into the wind — keep still and let the flocks come', ar: 'نصبت ثلاثة طُعوم من {name} باتجاه الريح — ابقَ ساكنًا ودع الأسراب تأتي' },
  decoysUp: { en: 'Decoys picked up', ar: 'جمعت الطُّعوم' },
  decoysFar: { en: 'Walk back to your decoys to pick them up', ar: 'عُد إلى الطُّعوم لتجمعها' },
  decoysNone: { en: 'No decoys for the birds of this ground', ar: 'لا طُعوم لطيور هذه الأرض' },
  hintTip: { en: 'Tip', ar: 'نصيحة' },
  hvWeight: { en: 'Weight', ar: 'الوزن' },
  hvRange: { en: 'Range', ar: 'المسافة' },
  hvKill: { en: 'Kill', ar: 'الإصابة' },
  hvClean: { en: 'Clean · {n} pellets', ar: 'نظيفة · {n} حبات' },
  hvCleanNoCount: { en: 'Clean', ar: 'نظيفة' },
  hvWounded: { en: 'Wounded first (score ×0.7)', ar: 'أُصيب أولًا (النقاط ×٠٫٧)' },
  hvScore: { en: 'Score', ar: 'النقاط' },
  hvRecord: { en: 'New trophy lodge record!', ar: 'رقم قياسي جديد في سجل الجوائز!' },
  grams: { en: '{g} g', ar: '{g} غ' },
  medal_none: { en: 'No medal', ar: 'بلا ميدالية' },
  medal_bronze: { en: 'Bronze', ar: 'برونزية' },
  medal_silver: { en: 'Silver', ar: 'فضية' },
  medal_gold: { en: 'Gold', ar: 'ذهبية' },
  medal_diamond: { en: 'Diamond', ar: 'ماسية' },
  level: { en: 'Hunter level {n}', ar: 'مستوى الصياد {n}' },
  xpToNext: { en: '{xp} XP · {next} to the next level', ar: '{xp} نقطة خبرة · {next} للمستوى التالي' },
  levelUp: { en: 'Level up! Hunter level {n}', ar: 'ارتفع مستواك! مستوى الصياد {n}' },
  lodgeEmpty: { en: 'No trophies yet — the heaviest bird of each kind you bag will hang here.', ar: 'لا جوائز بعد — سيُعرض هنا أثقل طائر تصطاده من كل نوع.' },
  stMedals: { en: 'medals', ar: 'ميداليات' },
  stXp: { en: 'XP earned', ar: 'خبرة مكتسبة' },
};

export function t(key, vars = {}) {
  const e = STR[key];
  let s = e ? (isAr() ? e.ar : e.en) : key;
  for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(v);
  return s;
}

// A bird's name in the current language.
export function spName(sp) {
  return isAr() ? sp.ar : sp.en.replace(' (protected)', '');
}

// A hunting ground's name in the current language.
export function huntName(h) {
  return isAr() ? h.ar : h.en;
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
  document.title = t('pageTitle');
  for (const el of root.querySelectorAll('[data-i18n]')) {
    if (el.dataset.en == null) el.dataset.en = el.innerHTML;
    el.innerHTML = ar && AR[el.dataset.i18n] != null ? AR[el.dataset.i18n] : el.dataset.en;
  }
  for (const el of root.querySelectorAll('[data-i18n-ph]')) {
    if (el.dataset.enPh == null) el.dataset.enPh = el.placeholder;
    el.placeholder = ar ? AR_ATTR[el.dataset.i18nPh] || el.dataset.enPh : el.dataset.enPh;
  }
  for (const el of root.querySelectorAll('option')) {
    const set = el.parentElement.dataset.setting;
    const key = el.dataset.i18nOpt || (['quality', 'choke0', 'choke1', 'shotSize'].includes(set) ? `opt.${el.value}` : null);
    if (!key) continue;
    if (el.dataset.en == null) el.dataset.en = el.textContent;
    el.textContent = ar && AR_ATTR[key] ? AR_ATTR[key] : el.dataset.en;
  }
}

export function setLang(lang) {
  setSetting('lang', lang);
  applyI18n();
}
