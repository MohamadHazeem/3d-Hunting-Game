import { SPECIES, GAME_SPECIES } from '../config/species.js';
import { Random } from '../core/rng.js';
import { t, num, isAr, spName } from '../core/i18n.js';
import { portraitOf } from './guide.js';

// The harvest: every bird has its own weight, and the heaviest of their
// kind earn a trophy medal, as in theHunter: Call of the Wild. A card shows
// each bird you bag; the best of each species hangs in your trophy lodge,
// and every harvest earns XP towards your hunter level.

// mean and spread of body weight in grams (real ranges for each species)
export const WEIGHTS = {
  quail: [100, 12],
  woodcock: [320, 35],
  songThrush: [72, 7],
  fieldfare: [105, 10],
  chaffinch: [23, 2.2],
  turtleDove: [140, 15],
  woodpigeon: [500, 50],
};
const MEDALS = ['none', 'bronze', 'silver', 'gold', 'diamond'];
const MEDAL_MULT = { none: 1, bronze: 1.2, silver: 1.5, gold: 2, diamond: 3 };
const MEDAL_COLOR = { none: '#8a8170', bronze: '#c98a4b', silver: '#c9ccd1', gold: '#e8b83c', diamond: '#86dcff' };

// The same bird always weighs the same, on every player's machine.
export function birdWeight(spId, birdId, seed) {
  const [mean, sd] = WEIGHTS[spId] || [100, 10];
  const r = new Random((birdId * 7919 + seed * 31) | 0);
  const z = Math.max(-2.5, Math.min(2.8, r.gauss() * 1.05));
  return Math.round(mean + z * sd);
}

export function medalFor(spId, grams) {
  const [mean, sd] = WEIGHTS[spId] || [100, 10];
  const z = (grams - mean) / sd;
  return z >= 2.2 ? 'diamond' : z >= 1.5 ? 'gold' : z >= 0.8 ? 'silver' : z >= 0 ? 'bronze' : 'none';
}

export function harvestScore(spId, medal, wounded) {
  return Math.round(SPECIES[spId].points * MEDAL_MULT[medal] * (wounded ? 0.7 : 1));
}

// ------------------------------------------------ lodge & level

function loadLodge() {
  try {
    return JSON.parse(localStorage.getItem('lbh.lodge') || '{"best":{},"xp":0}');
  } catch {
    return { best: {}, xp: 0 };
  }
}

function saveLodge(l) {
  try {
    localStorage.setItem('lbh.lodge', JSON.stringify(l));
  } catch {}
}

export function levelOf(xp) {
  // each level needs a little more than the last: 100, 250, 450, 700…
  let lvl = 1;
  let need = 100;
  let left = xp;
  while (left >= need) {
    left -= need;
    lvl++;
    need += 50;
  }
  return { lvl, into: left, need };
}

// Record a harvest; returns { newBest, levelUp, level }.
export function recordHarvest(h, huntId) {
  const l = loadLodge();
  const before = levelOf(l.xp).lvl;
  l.xp += h.score;
  const prev = l.best[h.spId];
  const newBest = !prev || h.weight > prev.weight;
  if (newBest) l.best[h.spId] = { weight: h.weight, medal: h.medal, hunt: huntId, date: new Date().toISOString().slice(0, 10) };
  saveLodge(l);
  const level = levelOf(l.xp);
  return { newBest, levelUp: level.lvl > before, level };
}

export function lodgeHtml() {
  const l = loadLodge();
  const lv = levelOf(l.xp);
  const rows = GAME_SPECIES.filter((s) => l.best[s])
    .map((s) => {
      const b = l.best[s];
      return `<div class="trophy"><span class="medal" style="background:${MEDAL_COLOR[b.medal]}"></span><b>${spName(SPECIES[s])}</b><span>${t('grams', { g: num(b.weight) })} · ${t('medal_' + b.medal)}</span></div>`;
    })
    .join('');
  return `<div class="level">${t('level', { n: num(lv.lvl) })} <span class="dim">${t('xpToNext', { xp: num(l.xp), next: num(lv.need - lv.into) })}</span>
    <div class="xpbar"><i style="width:${Math.round((lv.into / lv.need) * 100)}%"></i></div></div>
    ${rows || `<p class="dim">${t('lodgeEmpty')}</p>`}`;
}

// ------------------------------------------------ the harvest card

export class HarvestCard {
  constructor() {
    this.el = document.createElement('div');
    this.el.id = 'harvest';
    document.getElementById('hud').append(this.el);
    this.timer = 0;
  }

  show(h) {
    const sp = SPECIES[h.spId];
    const img = portraitOf(h.spId);
    const kill = h.wounded ? t('hvWounded') : h.pellets ? t('hvClean', { n: num(h.pellets) }) : t('hvCleanNoCount');
    this.el.innerHTML = `
      ${img ? `<img src="${img}" alt="">` : ''}
      <div class="hv-name">${spName(sp)}</div>
      <div class="hv-medal" style="color:${MEDAL_COLOR[h.medal]}"><span class="medal" style="background:${MEDAL_COLOR[h.medal]}"></span>${t('medal_' + h.medal)}</div>
      <div class="hv-row"><span>${t('hvWeight')}</span><b>${t('grams', { g: num(h.weight) })}</b></div>
      ${h.dist ? `<div class="hv-row"><span>${t('hvRange')}</span><b>${num(h.dist.toFixed(0))} ${isAr() ? 'م' : 'm'}</b></div>` : ''}
      <div class="hv-row"><span>${t('hvKill')}</span><b>${kill}</b></div>
      <div class="hv-row"><span>${t('hvScore')}</span><b class="gold">+${num(h.score)}</b></div>
      ${h.newBest ? `<div class="hv-best">${t('hvRecord')}</div>` : ''}
      ${h.levelUp ? `<div class="hv-best">${t('levelUp', { n: num(h.level.lvl) })}</div>` : ''}`;
    this.el.classList.remove('on');
    void this.el.offsetWidth;
    this.el.classList.add('on');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.el.classList.remove('on'), 6500);
  }
}

export { MEDALS, MEDAL_COLOR };
