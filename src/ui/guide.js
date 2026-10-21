import * as THREE from 'three';
import { SPECIES, SPECIES_LIST } from '../config/species.js';
import { HUNTS } from '../config/hunts.js';
import { createBirdMesh, poseWings } from '../birds/birdModel.js';
import { audio } from '../audio/audio.js';
import { t, num, isAr, spName, huntName } from '../core/i18n.js';

// The bird guide: every bird in the game with a portrait rendered from its
// in-game model, how it flies, where and when you meet it, and its call.

const FLIGHT = {
  whirr: 'Explodes off the ground on very fast, whirring wingbeats, flies low and straight, then glides back down into cover.',
  zigzag: 'Gets up late and close, twisting and jinking between the trunks before it settles to a direct flight.',
  direct: 'Strong, direct flight with steady wingbeats and short glides. Passes along flight lines at first light.',
  bounding: 'Bounding flight: a few quick flaps, then wings closed, rising and dipping like a wave.',
  soar: 'Soars on broad wings in wide circles, hardly flapping. Travels in huge flocks on migration.',
};
const FLIGHT_AR = {
  whirr: 'ينطلق من الأرض بخفقات أجنحة سريعة جدًا مدوّية، ويطير منخفضًا ومستقيمًا، ثم ينزلق هابطًا إلى الغطاء النباتي.',
  zigzag: 'ينطلق متأخرًا ومن مسافة قريبة، ويتلوّى ويراوغ بين الجذوع قبل أن يستقيم طيرانه.',
  direct: 'طيران قوي ومستقيم بخفقات منتظمة وانزلاقات قصيرة، ويعبر خطوط الطيران مع أول الضوء.',
  bounding: 'طيران متموّج: بضع خفقات سريعة ثم يضمّ جناحيه، فيرتفع وينخفض كالموج.',
  soar: 'يحلّق على أجنحة عريضة في دوائر واسعة بالكاد يخفقها، ويهاجر في أسراب ضخمة.',
};
const CALL_NAME = { quail: 'quail', tsip: 'tsip', chack: 'chack', pink: 'pink', woodcock: 'woodcock' };

let portraits = null;

function renderPortraits() {
  const W = 360;
  const H = 220;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  const out = {};
  for (const id of SPECIES_LIST) {
    const sp = SPECIES[id];
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xfff1dc, 0x5b4a33, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(2, 3, 2);
    scene.add(sun);
    const m = createBirdMesh(id);
    poseWings(m, 'glide', 0, 1, 0);
    scene.add(m.root);
    // seen from above and to the side, wings spread, so the back and wing
    // pattern show the way you'd see a bird crossing below you on a slope
    m.root.rotation.set(0.12, Math.PI, 0.1, 'YXZ');
    m.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(m.root);
    const c = box.getCenter(new THREE.Vector3());
    const span = box.getSize(new THREE.Vector3());
    const cam = new THREE.PerspectiveCamera(30, W / H, 0.01, 50);
    // fit the bird with a margin, viewed from above and behind
    const fitW = span.x / (2 * Math.tan((15 * Math.PI) / 180) * (W / H));
    const fitH = span.z / (2 * Math.tan((15 * Math.PI) / 180));
    const dist = Math.max(fitW, fitH) * 1.35 + span.y;
    cam.position.set(c.x, c.y + dist * 0.85, c.z + dist * 0.55);
    cam.lookAt(c);
    renderer.render(scene, cam);
    out[id] = renderer.domElement.toDataURL('image/png');
  }
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}

// One bird's portrait (rendered once, then cached), for the harvest card.
export function portraitOf(id) {
  if (!portraits) {
    try {
      portraits = renderPortraits();
    } catch {
      portraits = {};
    }
  }
  return portraits[id] || null;
}

export function openGuide(el) {
  if (!portraits) {
    try {
      portraits = renderPortraits();
    } catch {
      portraits = {};
    }
  }
  const cards = SPECIES_LIST.map((id) => {
    const sp = SPECIES[id];
    const ar = isAr();
    const where = HUNTS.filter((h) => h.species[id]).map((h) => `${huntName(h)} (${ar ? h.monthAr : h.month})`).join(' · ');
    const call = sp.call !== 'none' ? `<button class="listen" data-call="${CALL_NAME[sp.call] || sp.call}">${t('gListen')}</button>` : '';
    return `<div class="g-card${sp.protected ? ' prot' : ''}">
      ${portraits[id] ? `<img src="${portraits[id]}" alt="${sp.en}">` : ''}
      <div class="g-name"><span class="g-ar">${spName(sp)}</span> <i>${sp.latin}</i></div>
      ${sp.protected ? `<div class="g-law">${t('gProtected')}</div>` : `<div class="g-law ok">${t('gGame', { p: num(sp.points) })}</div>`}
      <div class="g-row"><span>${t('gSize')}</span>${t('gSizeVal', { l: num(Math.round(sp.length * 100)), w: num(Math.round(sp.wingspan * 100)) })}</div>
      <div class="g-row"><span>${t('gFlight')}</span>${(ar ? FLIGHT_AR : FLIGHT)[sp.flight.style] || ''}</div>
      <div class="g-row"><span>${t('gNotes')}</span>${ar ? sp.noteAr : sp.note}</div>
      <div class="g-row"><span>${t('gWhere')}</span>${where || '—'}</div>
      ${call}
    </div>`;
  }).join('');
  el.querySelector('.guide-cards').innerHTML = cards;
  for (const b of el.querySelectorAll('.listen')) {
    b.onclick = async () => {
      await audio.init();
      audio.resume();
      audio.play(b.dataset.call, null, { gain: 0.8, priority: 9 });
    };
  }
  el.classList.remove('hidden');
}
