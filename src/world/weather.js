import { clamp, smoothstep } from '../core/rng.js';

// The day's weather. Each hunting ground has the weather its month really
// brings (an October morning on the Koura coast is clear, hazy, foggy in the
// valleys or showery; a December afternoon in the Chouf is grey, drizzly or
// misty), one kind is picked for the day, and the day then moves: dawn fog
// burns off, showers come and go over a few minutes, cloud builds and clears.
//
// Everything else reads plain 0..1 numbers from here: cloud, rain, snow, fog,
// wetness (the ground: it lags the rain and dries slowly) and haze (0.25 is
// the ground's usual haze). The host decides; other players follow its
// netState().

// cloud, haze: where the day sits. build: cloud that grows over the mountains
// after midday. fog: dawn fog that clears by `clearBy`, or mist that lingers
// (`base`) and thickens towards dusk. rain: steady rain that waxes and wanes.
// showers: passing cells of rain (or snow), seconds between and during them.
// wet: how wet the ground already is at the start of the hunt.
const KINDS = {
  clear: { en: 'Clear skies', ar: 'سماء صافية', cloud: 0.12, haze: 0.2, build: 0.22 },
  hazy: { en: 'Hazy and mild', ar: 'جو معتدل مع ضباب خفيف', cloud: 0.22, haze: 0.62, build: 0.1 },
  morningFog: { en: 'Morning fog in the valleys', ar: 'ضباب الصباح في الأودية', cloud: 0.3, haze: 0.4, build: 0.15, fog: { peak: 0.9, clearBy: 9.5 }, wet: 0.3 },
  showers: { en: 'Passing showers', ar: 'زخّات مطر عابرة', cloud: 0.45, haze: 0.15, showers: { gap: [140, 420], dur: [80, 210], peak: [0.35, 0.95], first: [25, 160] }, wet: 0.35 },
  hotHaze: { en: 'Hot and hazy, dust in the air', ar: 'حرّ وغبار في الجو', cloud: 0.04, haze: 0.95 },
  groundFog: { en: 'Dawn ground fog over the fields', ar: 'ضباب الفجر فوق الحقول', cloud: 0.08, haze: 0.45, fog: { peak: 0.75, clearBy: 8.9, ground: true }, wet: 0.25 },
  overcast: { en: 'Grey and overcast', ar: 'سماء رمادية ملبّدة بالغيوم', cloud: 0.9, haze: 0.35 },
  drizzle: { en: 'Drizzle under low cloud', ar: 'رذاذ تحت غيوم منخفضة', cloud: 0.96, haze: 0.4, fog: { base: 0.22 }, rain: { base: 0.2, vary: 0.1 }, wet: 0.65 },
  rain: { en: 'Steady winter rain', ar: 'مطر شتوي متواصل', cloud: 1, haze: 0.35, fog: { base: 0.08 }, rain: { base: 0.62, vary: 0.25 }, wet: 0.85 },
  mist: { en: 'Mist drifting through the woods', ar: 'ضباب يتسلّل بين الأشجار', cloud: 0.85, haze: 0.4, fog: { base: 0.42, dusk: 0.33, duskAt: [14.9, 16.7] }, wet: 0.45 },
  coldClear: { en: 'Cold and crystal clear', ar: 'صحو وبرد قارس', cloud: 0.08, haze: 0.02, build: 0.12 },
  snowShowers: { en: 'Snow showers on the heights', ar: 'زخّات ثلج على المرتفعات', cloud: 0.72, haze: 0.2, showers: { snow: true, gap: [120, 330], dur: [100, 260], peak: [0.4, 1], first: [15, 120] }, flurry: 0.12, wet: 0.2 },
};

// How often each kind of day comes round in each hunting ground's month.
const DAYS = {
  koura: { clear: 0.38, hazy: 0.2, morningFog: 0.24, showers: 0.18 }, // October on the coast
  bekaa: { clear: 0.5, hotHaze: 0.3, groundFog: 0.2 }, // September on the plain
  chouf: { overcast: 0.3, drizzle: 0.25, rain: 0.2, mist: 0.25 }, // December in the hills
  akkar: { coldClear: 0.4, overcast: 0.25, snowShowers: 0.35 }, // January up high
  free: { clear: 0.26, hazy: 0.1, morningFog: 0.2, showers: 0.2, overcast: 0.14, drizzle: 0.1 }, // November, a bit of everything
};
const BY_MONTH = { September: 'bekaa', October: 'koura', November: 'free', December: 'chouf', January: 'akkar' };

const NAMES = Object.keys(KINDS);
const rand = ([a, b]) => a + (b - a) * Math.random();

export class Weather {
  // net: a netState() from the host to follow instead of choosing
  constructor(hunt, net = null) {
    this.hunt = hunt;
    this.t = 0;
    this.ph = [Math.random() * 6.3, Math.random() * 6.3, Math.random() * 6.3];
    this.cloud = 0;
    this.rain = 0;
    this.snow = 0;
    this.fog = 0;
    this.haze = 0.25;
    this.wetness = 0;
    this.hour = hunt.startHour;
    this.remote = !!(net && KINDS[net.k]);
    if (this.remote) {
      this.applyNet(net, true);
      return;
    }
    let kind = null;
    // on the dev server, ?weather=<kind> forces a kind of day
    if (import.meta.env.DEV) kind = new URLSearchParams(location.search).get('weather');
    this.setKind(KINDS[kind] ? kind : pickKind(hunt));
  }

  // Start a kind of day (host only), with the weather already set in.
  setKind(kind) {
    this.kind = kind;
    this.def = KINDS[kind];
    const S = this.def.showers;
    this.cell = null;
    this.gap = S ? rand(S.first) : 0;
    this.cellCloud = 0;
    this.wetness = this.def.wet || 0;
    this.update(0, this.hour);
    this.cloud = this.cloudTarget;
  }

  get en() {
    return this.def.en;
  }

  get ar() {
    return this.def.ar;
  }

  // what today can bring (so the renderer can get ready for it)
  get canRain() {
    const D = this.def;
    return !!(D.rain || (D.showers && !D.showers.snow));
  }

  get canSnow() {
    const D = this.def;
    return !!(D.flurry || (D.showers && D.showers.snow));
  }

  // 1 when today's fog is a shallow layer lying on the ground (the sky and
  // the hilltops stay clear above it), 0 when it fills the air
  get lowFog() {
    return this.def.fog && this.def.fog.ground ? 1 : 0;
  }

  // rain or snow, whichever is falling
  get precip() {
    return Math.max(this.rain, this.snow);
  }

  update(dt, hour) {
    this.t += dt;
    this.hour = hour;
    if (this.remote) {
      // ease towards what the host last sent
      const T = this.target;
      const k = Math.min(1, dt / 2);
      for (const key of ['cloud', 'rain', 'snow', 'fog', 'haze', 'wetness']) this[key] += (T[key] - this[key]) * k;
      return;
    }
    const D = this.def;
    const t = this.t;
    // the cloud deck wanders over minutes
    const drift = 0.5 * Math.sin(t / 410 + this.ph[0]) + 0.5 * Math.sin(t / 157 + this.ph[1]);
    const slow = 0.5 * Math.sin(t / 97 + this.ph[2]) + 0.5 * Math.sin(t / 41 + this.ph[0] * 2);
    let cloud = D.cloud + 0.08 * drift + (D.build || 0) * smoothstep(11, 14.5, hour);
    let rain = 0;
    let snow = 0;
    let fog = 0;

    if (D.rain) rain = D.rain.base + D.rain.vary * slow;
    if (D.showers) {
      const cell = this.updateShowers(dt);
      if (D.showers.snow) snow = cell;
      else rain = cell;
      // a shower comes in under its own cloud, and the sky opens up again slowly after it
      cloud += (0.97 - cloud) * this.cellCloud;
    }
    if (D.flurry) snow = Math.max(snow, D.flurry * (0.5 + 0.5 * drift) * smoothstep(0.55, 0.8, cloud));

    const F = D.fog;
    if (F) {
      // dawn fog burns off as the sun gets up, from the hilltops down
      if (F.peak) fog = F.peak * (1 - smoothstep(F.clearBy - 2.2, F.clearBy, hour));
      // mist in the woods lingers all day and thickens as the air cools at dusk
      if (F.base) fog = F.base + (F.dusk || 0) * (F.duskAt ? smoothstep(F.duskAt[0], F.duskAt[1], hour) : 0);
      fog *= 0.88 + 0.12 * slow;
      // valley fog hangs under its own grey lid until it lifts; ground fog
      // lies under a clear sky
      if (!F.ground) cloud = Math.max(cloud, 0.75 * fog);
    }

    this.cloudTarget = clamp(cloud, 0, 1);
    this.cloud += (this.cloudTarget - this.cloud) * Math.min(1, dt / 20);
    this.rain = clamp(rain, 0, 1);
    this.snow = clamp(snow, 0, 1);
    this.fog = clamp(fog, 0, 1);
    // rain washes the dust out of the air; a hot plain gets hazier through the morning
    this.haze = clamp(D.haze * (1 - 0.4 * this.wetness) * (D === KINDS.hotHaze ? 0.75 + 0.25 * smoothstep(9, 13, hour) : 1), 0, 1);

    // The ground soaks up rain within a minute or two, but takes many minutes
    // to dry, fastest in sunshine. Dew and melting flakes wet it a little.
    const soak = Math.max(smoothstep(0, 0.4, this.rain), 0.35 * this.snow, 0.3 * this.fog);
    if (soak > this.wetness) this.wetness += (soak - this.wetness) * Math.min(1, dt / 70);
    else {
      const sun = (1 - this.cloud) * smoothstep(7, 10, hour) * (1 - smoothstep(15, 17.5, hour));
      this.wetness = Math.max(soak, this.wetness - (dt / 1500) * (0.4 + 2.6 * sun));
    }
  }

  // Passing showers: a dry spell, cloud building in the last minute or two,
  // then a cell that starts quickly, is heaviest early on and tails off.
  updateShowers(dt) {
    const S = this.def.showers;
    let out = 0;
    let lid = 0;
    if (!this.cell) {
      this.gap -= dt;
      lid = 1 - smoothstep(0, 110, this.gap);
      if (this.gap <= 0) this.cell = { t: 0, dur: rand(S.dur), peak: rand(S.peak) };
    } else {
      const c = this.cell;
      c.t += dt;
      const k = c.t / c.dur;
      if (k >= 1) {
        this.cell = null;
        this.gap = rand(S.gap);
      } else {
        const flicker = 0.82 + 0.18 * Math.sin(c.t * 0.23) * Math.sin(c.t * 0.081 + 1);
        out = c.peak * smoothstep(0, 0.14, k) * (1 - smoothstep(0.5, 1, k)) * flicker;
        lid = 1;
      }
    }
    // the cloud closes in over a minute, and takes a few minutes to break up
    this.cellCloud += (lid - this.cellCloud) * Math.min(1, dt / (lid > this.cellCloud ? 35 : 90));
    return out;
  }

  // ------------------------------------------------ network

  netState() {
    const r = (v) => Math.round(v * 1000) / 1000;
    return { k: this.kind, c: r(this.cloud), r: r(this.rain), s: r(this.snow), f: r(this.fog), h: r(this.haze), w: r(this.wetness) };
  }

  applyNet(s, snap = false) {
    if (!s || !KINDS[s.k]) return;
    this.kind = s.k;
    this.def = KINDS[s.k];
    this.target = { cloud: s.c, rain: s.r, snow: s.s, fog: s.f, haze: s.h, wetness: s.w };
    if (snap) Object.assign(this, this.target);
  }
}

function pickKind(hunt) {
  const table = DAYS[hunt.id] || DAYS[BY_MONTH[hunt.month]] || DAYS.free;
  const total = Object.values(table).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (const [kind, w] of Object.entries(table)) {
    r -= w;
    if (r <= 0) return kind;
  }
  return NAMES[0];
}

export const WEATHER_KINDS = NAMES;
