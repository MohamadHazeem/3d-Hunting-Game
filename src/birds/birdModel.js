import * as THREE from 'three';
import { Random } from '../core/rng.js';
import { SPECIES } from '../config/species.js';

// Procedural bird models built in "unit length" (bill-to-tail = 1) and scaled
// to the real species size. Bodies get a painted plumage texture; wings are
// two-segment (arm + hand) so they can flap, glide and fold.

const cache = new Map();

// How birds in the field read against sky and ground (shared by every field
// bird's shader): x = how much of the haze/mist they shrug off, y = how dark
// they go against the sky (a bird overhead is a backlit silhouette), z = a
// faint rim of light round the edge that lifts them off foliage and stubble.
export const birdLook = { value: new THREE.Vector3(0.6, 1, 1) };

function fieldLook(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uBirdLook = birdLook;
    sh.fragmentShader = sh.fragmentShader
      .replace('void main() {', 'uniform vec3 uBirdLook;\nvoid main() {')
      .replace(
        '#include <fog_fragment>',
        /* glsl */ `vec3 lbhPreFog = gl_FragColor.rgb;
#include <fog_fragment>
        gl_FragColor.rgb = mix( gl_FragColor.rgb, lbhPreFog, uBirdLook.x );
        {
          // camera-to-fragment ray in world space (the view matrix is rigid)
          vec3 lbhRay = normalize( ( vec4( - vViewPosition, 0.0 ) * viewMatrix ).xyz );
          float lbhSky = smoothstep( 0.03, 0.3, lbhRay.y ) * uBirdLook.y;
          gl_FragColor.rgb *= 1.0 - 0.55 * lbhSky;
          float lbhRim = pow( 1.0 - abs( dot( normal, normalize( vViewPosition ) ) ), 3.0 );
          gl_FragColor.rgb += lbhRim * 0.12 * uBirdLook.z * ( 1.0 - lbhSky ) * vec3( 1.0, 0.94, 0.82 );
        }`
      );
  };
  mat.customProgramCacheKey = () => 'lbhFieldBird';
}

function plumageTexture(sp) {
  const W = 256;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const col = sp.colors;
  const r = new Random(sp.id.length * 97 + 11);
  // v = 1 top (back), v = 0 bottom (belly). Canvas y = 0 is top.
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, col.back);
  g.addColorStop(0.42, col.back);
  g.addColorStop(0.55, col.breast);
  g.addColorStop(1, col.belly);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // throat/breast colour wraps higher at the front (u ≈ 0.25)
  const fg = ctx.createRadialGradient(W * 0.25, H * 0.55, 4, W * 0.25, H * 0.55, W * 0.22);
  fg.addColorStop(0, col.breast);
  fg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = fg;
  ctx.fillRect(0, 0, W, H);

  const marks = col.marks;
  const P = sp.pattern;
  if (P === 'streaked' || P === 'marbled') {
    // quail / woodcock cryptic barring & streaks over the back, flanks
    const n = P === 'marbled' ? 520 : 320;
    for (let i = 0; i < n; i++) {
      const x = r.float(0, W);
      const y = r.float(0, H * (P === 'marbled' ? 0.95 : 0.7));
      ctx.fillStyle = r.chance(0.6) ? marks : r.chance(0.5) ? col.belly : col.wing;
      ctx.globalAlpha = r.float(0.35, 0.85);
      ctx.fillRect(x, y, r.float(2, 7), r.float(1, 2.5));
    }
    if (P === 'marbled') {
      // the woodcock's bold dark crown bars
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = marks;
      for (let i = 0; i < 4; i++) ctx.fillRect(W * 0.18, 4 + i * 9, W * 0.14, 4);
    }
  } else if (P === 'spotted' || P === 'chevron') {
    for (let i = 0; i < 260; i++) {
      const x = r.float(0, W);
      const y = r.float(H * 0.52, H * 0.92);
      const front = 1 - Math.min(1, Math.abs(x / W - 0.25) * 3.5);
      if (r.next() > 0.25 + front) continue;
      ctx.fillStyle = marks;
      ctx.globalAlpha = r.float(0.55, 0.95);
      ctx.beginPath();
      if (P === 'spotted') ctx.ellipse(x, y, r.float(1.5, 2.8), r.float(2, 3.5), 0, 0, Math.PI * 2);
      else {
        ctx.moveTo(x - 3, y - 2);
        ctx.lineTo(x, y + 2);
        ctx.lineTo(x + 3, y - 2);
        ctx.lineTo(x, y);
      }
      ctx.fill();
    }
    if (P === 'chevron') {
      // fieldfare: grey head & rump band
      ctx.globalAlpha = 1;
      ctx.fillStyle = col.head;
      ctx.fillRect(0, 0, W, 10);
    }
  } else if (P === 'turtle') {
    // turtle dove: rufous feathers with black centres on the back, and the
    // black-and-white striped patch on the side of the neck
    for (let i = 0; i < 160; i++) {
      const x = r.float(W * 0.35, W);
      const y = r.float(0, H * 0.42);
      ctx.fillStyle = '#c47f3e';
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.ellipse(x, y, 5, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = marks;
      ctx.beginPath();
      ctx.ellipse(x, y, 2.6, 1.8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? '#f2f0ea' : '#1c1a18';
      ctx.fillRect(W * 0.12, H * 0.3 + i * 3, W * 0.08, 3);
    }
  } else if (P === 'pigeon') {
    // woodpigeon: the white neck patch with a green-purple sheen around it
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = '#5d8a6e';
    ctx.fillRect(W * 0.08, H * 0.22, W * 0.16, H * 0.16);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#f4f4f2';
    ctx.fillRect(W * 0.12, H * 0.3, W * 0.07, H * 0.06);
  } else if (P === 'wingbars') {
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#6f8a5a'; // chaffinch olive-green rump
    ctx.fillRect(W * 0.55, 0, W * 0.3, H * 0.2);
  }
  ctx.globalAlpha = 1;
  // feather texture noise
  for (let i = 0; i < 1400; i++) {
    ctx.fillStyle = r.chance(0.5) ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)';
    ctx.fillRect(r.float(0, W), r.float(0, H), r.float(2, 5), 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function wingTexture(sp) {
  const W = 256;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  const col = sp.colors;
  const r = new Random(sp.id.length * 13 + 5);
  // u: 0 shoulder -> 1 tip, v: 0 trailing -> 1 leading edge (canvas y inverted)
  ctx.fillStyle = col.wing;
  ctx.fillRect(0, 0, W, H);
  const tipG = ctx.createLinearGradient(W * 0.45, 0, W, 0);
  tipG.addColorStop(0, 'rgba(0,0,0,0)');
  tipG.addColorStop(0.35, col.wingTip);
  tipG.addColorStop(1, col.wingTip);
  ctx.fillStyle = tipG;
  ctx.fillRect(0, H * 0.25, W, H * 0.75);
  if (sp.id === 'stork') {
    ctx.fillStyle = col.wingTip;
    ctx.fillRect(0, H * 0.45, W, H * 0.55); // black flight feathers
  }
  if (sp.pattern === 'pigeon') {
    // the bold white band across the wing that flashes in flight
    ctx.fillStyle = '#f4f4f2';
    ctx.fillRect(W * 0.32, H * 0.55, W * 0.14, H * 0.45);
  }
  if (sp.pattern === 'turtle') {
    // rufous coverts with dark centres
    for (let i = 0; i < 70; i++) {
      const x = r.float(0, W * 0.5);
      const y = r.float(H * 0.45, H);
      ctx.fillStyle = '#c47f3e';
      ctx.fillRect(x, y, 7, 5);
      ctx.fillStyle = '#2a201a';
      ctx.fillRect(x + 2, y + 1.5, 3, 2);
    }
  }
  if (sp.pattern === 'wingbars') {
    ctx.fillStyle = '#f4f2ea';
    ctx.fillRect(0, H * 0.18, W * 0.55, H * 0.1);
    ctx.fillRect(0, H * 0.42, W * 0.7, H * 0.08);
  }
  if (sp.pattern === 'streaked' || sp.pattern === 'marbled') {
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = r.chance(0.6) ? col.marks : col.belly;
      ctx.globalAlpha = r.float(0.3, 0.7);
      ctx.fillRect(r.float(0, W * 0.8), r.float(0, H * 0.7), r.float(2, 6), r.float(1, 3));
    }
    ctx.globalAlpha = 1;
  }
  // feather separations along the trailing edge
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 22; i++) {
    const x = (i / 22) * W;
    ctx.beginPath();
    ctx.moveTo(x, H);
    ctx.lineTo(x + 10, H * 0.45);
    ctx.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function wingShape(span, chord, isHand, sp) {
  // Built in the XZ plane: +x outward, +z forward (leading edge).
  const s = new THREE.Shape();
  if (!isHand) {
    s.moveTo(0, chord * 0.5);
    s.lineTo(span, chord * 0.45);
    s.lineTo(span, -chord * 0.45);
    s.lineTo(0, -chord * 0.55);
  } else {
    const pointed = sp.flight.style === 'whirr' || sp.flight.style === 'zigzag' ? 0.7 : 0.55;
    s.moveTo(0, chord * 0.45);
    s.quadraticCurveTo(span * 0.6, chord * 0.42, span, chord * (0.12 - pointed * 0.1));
    if (sp.id === 'stork') {
      // splayed "fingers"
      for (let i = 0; i < 5; i++) {
        const t = i / 5;
        s.lineTo(span * (0.98 - t * 0.12), -chord * (0.05 + t * 0.08));
        s.lineTo(span * (0.92 - t * 0.12), -chord * (0.1 + t * 0.08));
      }
    }
    s.quadraticCurveTo(span * 0.5, -chord * 0.5, 0, -chord * 0.45);
  }
  const geo = new THREE.ShapeGeometry(s, 6);
  geo.rotateX(Math.PI / 2); // shape XY -> XZ plane, leading edge towards +z
  // UVs: u along span, v across chord
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;
  const offset = isHand ? 0.5 : 0;
  for (let i = 0; i < pos.count; i++) {
    uv.setXY(i, offset + (pos.getX(i) / span) * 0.5, pos.getZ(i) / chord + 0.5);
  }
  geo.computeVertexNormals();
  return geo;
}

function build(speciesId, field) {
  const sp = SPECIES[speciesId];
  const b = sp.body;
  const col = sp.colors;
  const bodyMat = new THREE.MeshStandardMaterial({ map: plumageTexture(sp), roughness: 0.92 });
  const wingMat = new THREE.MeshStandardMaterial({ map: wingTexture(sp), roughness: 0.9, side: THREE.DoubleSide });
  const headMat = new THREE.MeshStandardMaterial({ color: col.head, roughness: 0.9 });
  const billMat = new THREE.MeshStandardMaterial({ color: col.bill, roughness: 0.6 });
  const tailMat = new THREE.MeshStandardMaterial({ color: col.tail, roughness: 0.9, side: THREE.DoubleSide });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.2 });

  const bodyLen = 0.5;
  const bodyGeo = new THREE.SphereGeometry(0.5, 16, 12);
  bodyGeo.scale(b.w * bodyLen, b.h * bodyLen, bodyLen);

  const headR = b.neck > 0.2 ? 0.05 : 0.068 + b.w * 0.03;
  const headGeo = new THREE.SphereGeometry(headR, 12, 10);
  const billGeo = new THREE.ConeGeometry(headR * (b.bill > 0.12 ? 0.22 : 0.4), b.bill, 6);
  billGeo.rotateX(Math.PI / 2);
  billGeo.translate(0, 0, b.bill / 2);
  const eyeGeo = new THREE.SphereGeometry(headR * 0.18, 6, 5);

  const tailGeo = new THREE.BufferGeometry();
  const tl = b.tail;
  const tw = b.tail * (sp.flight.style === 'whirr' ? 0.5 : 0.4);
  tailGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -tw, 0, -tl, tw, 0, -tl], 3));
  tailGeo.computeVertexNormals();

  const spanRatio = sp.wingspan / sp.length;
  const halfSpan = spanRatio / 2 - b.w * bodyLen * 0.4;
  const chord = sp.id === 'stork' ? 0.32 : 0.3;
  const armGeo = wingShape(halfSpan * 0.45, chord, false, sp);
  const handGeo = wingShape(halfSpan * 0.55, chord * 0.95, true, sp);
  // mirroring flips the triangle winding, so the normals must be rebuilt or
  // the left wing is lit from the wrong side (dark from above)
  const armGeoL = armGeo.clone().scale(-1, 1, 1);
  const handGeoL = handGeo.clone().scale(-1, 1, 1);
  armGeoL.computeVertexNormals();
  handGeoL.computeVertexNormals();

  const legLen = 0.16;
  const legGeo = new THREE.CylinderGeometry(0.011, 0.008, legLen, 4);
  legGeo.translate(0, -legLen / 2, 0);
  const legMat = new THREE.MeshStandardMaterial({ color: sp.legColor || '#a08070', roughness: 0.7 });
  if (field) for (const m of [bodyMat, wingMat, headMat, billMat, tailMat, eyeMat, legMat]) fieldLook(m);

  return {
    sp, bodyMat, wingMat, headMat, billMat, tailMat, eyeMat, legMat,
    bodyGeo, headGeo, billGeo, eyeGeo, tailGeo, armGeo, handGeo, armGeoL, handGeoL, legGeo,
    halfSpan, headR, bodyLen,
  };
}

// opts.scale: size multiplier on top of the real size (the "Bird size"
// setting); opts.field: birds out in the hunting ground get the readable look.
export function createBirdMesh(speciesId, opts = {}) {
  const key = opts.field ? speciesId + '|field' : speciesId;
  if (!cache.has(key)) cache.set(key, build(speciesId, !!opts.field));
  const K = cache.get(key);
  const sp = K.sp;
  const b = sp.body;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const torso = new THREE.Mesh(K.bodyGeo, K.bodyMat);
  body.add(torso);

  const head = new THREE.Group();
  const headZ = K.bodyLen * 0.4 + K.headR * 0.4 + b.neck * 0.75;
  head.position.set(0, K.bodyLen * b.h * 0.28, headZ);
  head.add(new THREE.Mesh(K.headGeo, K.headMat));
  const bill = new THREE.Mesh(K.billGeo, K.billMat);
  bill.position.set(0, -K.headR * 0.15, K.headR * 0.85);
  bill.rotation.x = b.bill > 0.12 ? 0.25 : 0.05;
  head.add(bill);
  for (const sx of [-1, 1]) {
    const eye = new THREE.Mesh(K.eyeGeo, K.eyeMat);
    eye.position.set(sx * K.headR * 0.78, K.headR * 0.25, K.headR * 0.35);
    head.add(eye);
  }
  body.add(head);
  if (b.neck > 0.2) {
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, b.neck, 6), K.bodyMat);
    neck.rotation.x = Math.PI / 2;
    neck.position.set(0, K.bodyLen * b.h * 0.15, K.bodyLen * 0.45 + b.neck * 0.25);
    body.add(neck);
  }
  if (b.legs > 0) {
    const legMat = K.billMat;
    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, b.legs, 4), legMat);
      leg.rotation.x = Math.PI / 2;
      leg.position.set(sx * 0.03, -0.03, -K.bodyLen * 0.4 - b.legs / 2);
      body.add(leg);
    }
  }
  const tail = new THREE.Mesh(K.tailGeo, K.tailMat);
  tail.position.set(0, K.bodyLen * b.h * 0.1, -K.bodyLen * 0.42);
  body.add(tail);

  // Small birds tuck their legs in flight; they show when perched, running,
  // or dangling from a wounded bird.
  const legs = [];
  if (!(b.legs > 0)) {
    for (const sx of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(sx * K.bodyLen * b.w * 0.12, -K.bodyLen * b.h * 0.18, -0.02);
      hip.add(new THREE.Mesh(K.legGeo, K.legMat));
      hip.visible = false;
      body.add(hip);
      legs.push(hip);
    }
  }

  // wings: shoulder pivot -> arm mesh, wrist pivot -> hand mesh
  const wings = [];
  for (const side of [1, -1]) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * K.bodyLen * b.w * 0.32, K.bodyLen * b.h * 0.22, K.bodyLen * 0.1);
    const arm = new THREE.Mesh(side > 0 ? K.armGeo : K.armGeoL, K.wingMat);
    shoulder.add(arm);
    const wrist = new THREE.Group();
    wrist.position.set(side * K.halfSpan * 0.45, 0, 0);
    const hand = new THREE.Mesh(side > 0 ? K.handGeo : K.handGeoL, K.wingMat);
    wrist.add(hand);
    shoulder.add(wrist);
    body.add(shoulder);
    wings.push({ shoulder, wrist, side });
  }

  root.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = false;
    }
  });
  root.scale.setScalar(sp.length * (opts.scale || 1));
  return { root, body, head, tail, wings, legs };
}

// Wing poses. phase in radians; mode: 'flap' | 'climb' | 'glide' | 'flare' |
// 'fold' | 'limp' | 'perch' (and 'peck' / 'preen' / 'run', which fold the wings)
const FOLDED = new Set(['fold', 'perch', 'peck', 'preen', 'run']);

export function poseWings(model, mode, phase, amp = 1, t = 0) {
  for (const w of model.wings) {
    const s = w.side;
    // a folded wing tucks its feathers in: much narrower chord
    const folded = FOLDED.has(mode);
    w.shoulder.scale.set(1, 1, folded ? 0.42 : 1);
    if (mode === 'flap' || mode === 'climb') {
      // 'climb' is the hard, full stroke of a take-off or a towering bird
      const k = mode === 'climb' ? 1.25 : 1;
      const a = Math.sin(phase);
      w.shoulder.rotation.set(0, -s * Math.max(0, -a) * 0.2 * k, s * (a * 0.95 * k + (k - 1) * 0.4) * amp);
      w.wrist.rotation.set(0, 0, s * Math.sin(phase - 0.7) * 0.55 * amp * k);
    } else if (mode === 'flare') {
      // landing: wings raised, spread wide and swept forward, braking with quick shallow beats
      w.shoulder.rotation.set(0, -s * 0.35, s * (0.55 + Math.sin(phase) * 0.28));
      w.wrist.rotation.set(0, 0, -s * (0.25 + Math.sin(phase - 0.6) * 0.15));
    } else if (mode === 'glide') {
      w.shoulder.rotation.set(0, 0, s * 0.08);
      w.wrist.rotation.set(0, 0, -s * 0.05);
    } else if (mode === 'limp') {
      w.shoulder.rotation.set(0, s * 0.5, s * (Math.sin(t * 9 + s) * 0.6 - 0.2));
      w.wrist.rotation.set(0, 0, s * (0.9 + Math.sin(t * 7) * 0.4));
    } else {
      // folded: wing raised to vertical then swung back along the flank,
      // hand folded back over the arm
      w.shoulder.rotation.set(-Math.PI / 2 * 0.94, 0, s * Math.PI / 2 * 0.9);
      w.wrist.rotation.set(0, s * (Math.PI - 0.15), 0);
    }
  }
  // the tail fans out to brake when landing
  model.tail.scale.x = mode === 'flare' ? 1.8 : mode === 'glide' ? 1.2 : 1;
}

// Leg poses for small birds: 'tuck' (in flight) | 'stand' | 'run' | 'dangle' (wounded)
export function poseLegs(model, mode, t = 0) {
  const L = model.legs;
  if (!L.length) return;
  for (let i = 0; i < 2; i++) {
    const leg = L[i];
    leg.visible = mode !== 'tuck' && !(mode === 'dangle' && i === 1);
    if (!leg.visible) continue;
    if (mode === 'run') leg.rotation.set(Math.sin(t * 22 + i * Math.PI) * 0.75, 0, 0);
    else if (mode === 'dangle') leg.rotation.set(0.6 + Math.sin(t * 5) * 0.35, 0, Math.sin(t * 3.3) * 0.25);
    else leg.rotation.set(0.12, 0, 0);
  }
}

export function featherColor(speciesId) {
  const c = SPECIES[speciesId].colors;
  return [new THREE.Color(c.back), new THREE.Color(c.breast), new THREE.Color(c.wing)];
}
