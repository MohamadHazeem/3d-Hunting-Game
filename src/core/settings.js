// Player settings, kept in localStorage. UI elements with data-setting="key"
// are bound automatically (range -> number, checkbox -> boolean, select -> string).

const DEFAULTS = {
  lang: typeof navigator !== 'undefined' && /^ar/i.test(navigator.language || '') ? 'ar' : 'en',
  name: '',
  quality: 'auto',
  sens: 1,
  adsSens: 0.85,
  invertY: false,
  fov: 72,
  showFps: false,
  crosshair: true,
  hitMarker: true,
  shotFeedback: true,
  markers: true,
  dog: true,
  companion: true,
  choke0: 'IC',
  choke1: 'F',
  shotSize: '8',
};

function read(k, d) {
  try {
    const v = localStorage.getItem('lbh.' + k);
    if (v == null) return d;
    if (typeof d === 'number') return Number.isFinite(parseFloat(v)) ? parseFloat(v) : d;
    if (typeof d === 'boolean') return v === 'true';
    return v;
  } catch {
    return d;
  }
}

export const settings = {};
for (const [k, d] of Object.entries(DEFAULTS)) settings[k] = read(k, d);

const listeners = new Set();

export function setSetting(k, v) {
  settings[k] = v;
  try {
    localStorage.setItem('lbh.' + k, String(v));
  } catch {}
  for (const fn of listeners) fn(k, v);
}

export function onSettingChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function bindSettings(root) {
  for (const el of root.querySelectorAll('[data-setting]')) {
    const k = el.dataset.setting;
    const out = el.parentElement.querySelector('output');
    const show = () => {
      if (out) out.textContent = el.dataset.unit === '°' ? `${el.value}°` : el.type === 'range' ? `${Math.round(el.value * 100)}%` : '';
    };
    if (el.type === 'checkbox') el.checked = !!settings[k];
    else el.value = settings[k];
    show();
    el.addEventListener(el.type === 'range' ? 'input' : 'change', () => {
      const v = el.type === 'checkbox' ? el.checked : el.type === 'range' ? parseFloat(el.value) : el.value;
      setSetting(k, v);
      show();
    });
  }
}
