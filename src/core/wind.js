import * as THREE from 'three';

// The day's wind: mostly off the sea from the west, strongest on the open
// highlands and plains, sheltered in the woods. It gusts and eases, drifts
// the shot a little at long range, makes birds flush into it and wilder.

const NAMES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const NAMES_AR = ['شمالية', 'شمالية شرقية', 'شرقية', 'جنوبية شرقية', 'جنوبية', 'جنوبية غربية', 'غربية', 'شمالية غربية'];
const RANGE = { highland: [3.5, 9], plain: [2, 6.5], terraces: [1, 5], forest: [0.6, 3] };

export class Wind {
  constructor(hunt, rnd = Math.random) {
    const [lo, hi] = RANGE[hunt.terrain.kind] || [1, 5];
    this.base = lo + (hi - lo) * rnd();
    // bearing the wind comes FROM, clockwise from north; prevailing westerlies
    this.from = ((270 + (rnd() - 0.5) * 120) * Math.PI) / 180;
    if (rnd() < 0.15) this.from = rnd() * Math.PI * 2; // some days it's from anywhere
    this.speed = this.base;
    this.gust = 0;
    this.gustT = 5;
    this.t = rnd() * 100;
    this.vec = new THREE.Vector3();
    this.update(0);
  }

  update(dt) {
    this.t += dt;
    this.gustT -= dt;
    if (this.gustT <= 0) {
      this.gustT = 6 + Math.random() * 20;
      this.gustTarget = Math.random() < 0.5 ? this.base * (0.3 + Math.random() * 0.6) : 0;
    }
    this.gust += ((this.gustTarget || 0) - this.gust) * Math.min(1, dt * 0.6);
    this.speed = Math.max(0, this.base * (1 + 0.22 * Math.sin(this.t * 0.05) + 0.1 * Math.sin(this.t * 0.17 + 2)) + this.gust);
    const veer = 0.12 * Math.sin(this.t * 0.03);
    const toward = this.from + Math.PI + veer;
    // compass bearing -> world: north is -z, east is +x
    this.vec.set(Math.sin(toward) * this.speed, 0, -Math.cos(toward) * this.speed);
  }

  // 0 calm .. 1 a strong blow
  get strength() {
    return Math.min(1, this.speed / 9);
  }

  get name() {
    const i = Math.round(((this.from / (Math.PI * 2)) * 8 + 8) % 8) % 8;
    return { en: NAMES[i], ar: NAMES_AR[i] };
  }
}
