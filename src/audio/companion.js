import { audio } from './audio.js';

// أبو علي, your hunting companion: calls the birds as they come, the way
// Lebanese hunters shout to each other ("فرّي! فرّي!"), and has something to
// say about your shooting. Lines are ElevenLabs voice recordings.

const CALL = {
  quail: 'v_ferri',
  songThrush: 'v_samman',
  fieldfare: 'v_kikhen',
  chaffinch: 'v_salanj',
  woodcock: 'v_shikab',
  turtleDove: 'v_tirghel',
  woodpigeon: 'v_mtawwaq',
};

export class Companion {
  constructor() {
    this.enabled = true;
    this.quiet = 2; // seconds until he may speak again
    this.scanT = 0;
  }

  say(line, { force = false, gap = 5, delay = 0.25, chance = 1 } = {}) {
    if (!this.enabled || !audio.has(line)) return false;
    if (!force && (this.quiet > 0 || Math.random() > chance)) return false;
    audio.play(line, null, { gain: 0.9, delay, pitchVar: 0, priority: 8, bus: 'voice' });
    this.quiet = gap;
    return true;
  }

  // Watch for flocks coming in and call them.
  update(dt, game) {
    this.quiet -= dt;
    this.scanT -= dt;
    if (this.scanT > 0) return;
    this.scanT = 0.4;
    const me = game.player.pos;
    // joining players have no flock groups (only the host simulates them):
    // treat each flying bird as its own "group", one call per species a while
    const groups = game.authority ? game.birds.groups : [...game.birds.birds.values()].filter((b) => b.state === 'flying').map((b) => ({ members: [b], ref: b }));
    this.recent = this.recent || {};
    for (const g of groups) {
      if (g.ref) {
        if (g.ref.announced || game.birds.time - (this.recent[g.ref.spId] || -99) < 8) continue;
        g.announced = false;
      }
      if (g.announced) continue;
      const lead = g.members.find((m) => game.birds.birds.has(m.id) && m.state === 'flying');
      if (!lead || lead.sp.protected) continue;
      const p = lead.renderPos || lead.pos;
      const dx = me.x - p.x;
      const dz = me.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > 110 || d < 15) continue;
      const v = lead.vel;
      const closing = (v.x * dx + v.z * dz) / (d * (Math.hypot(v.x, v.z) || 1));
      if (closing < 0.6) continue;
      g.announced = true;
      if (g.ref) g.ref.announced = true;
      this.recent[lead.spId] = game.birds.time;
      // which side is it coming from, relative to where you face?
      const bearing = Math.atan2(p.x - me.x, -(p.z - me.z));
      let rel = bearing + game.player.yaw;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      if (Math.abs(rel) > 1.2 && Math.abs(rel) < 2.2 && Math.random() < 0.5) this.say(rel > 0 ? 'v_right' : 'v_left', { gap: 4 });
      else this.say(CALL[lead.spId], { gap: 4, chance: 0.85 });
      return;
    }
  }

  onFlush(spId, dist) {
    if (dist < 40) this.say(CALL[spId], { gap: 3, chance: 0.75, delay: 0.15 });
  }

  onShot(entry, double) {
    if (!entry.spId) return;
    if (double) return this.say('v_double', { force: true, gap: 4, delay: 0.6 });
    if (entry.result === 'kill') return this.say('v_nice', { gap: 5, chance: 0.45, delay: 0.7 });
    if (entry.result === 'wound') return this.say('v_wounded', { gap: 5, chance: 0.8, delay: 0.8 });
    if (entry.dist > 46) return this.say('v_far', { gap: 6, chance: 0.6, delay: 0.6 });
    if (entry.side === 'behind') return this.say('v_behind', { gap: 6, chance: 0.4, delay: 0.6 });
    if (entry.side === 'ahead') return this.say('v_ahead', { gap: 6, chance: 0.4, delay: 0.6 });
    this.say('v_miss', { gap: 6, chance: 0.3, delay: 0.6 });
  }

  onStork() {
    this.say('v_stork', { force: true, gap: 4, delay: 0.3 });
  }

  onDogPoint() {
    this.say('v_dog', { gap: 4, delay: 0.4 });
  }

  onUnsafe() {
    this.say('v_unsafe', { force: true, gap: 4, delay: 0.1 });
  }

  onStart(hour) {
    if (hour < 9.5) setTimeout(() => this.say('v_morning', { force: true, gap: 4 }), 2500);
  }

  onDusk() {
    this.say('v_dusk', { force: true, gap: 4 });
  }
}
