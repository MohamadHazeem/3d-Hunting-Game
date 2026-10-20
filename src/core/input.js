// Keyboard + mouse with pointer lock.
export class Input {
  constructor(el) {
    this.el = el;
    this.keys = new Set();
    this.justPressed = new Set();
    this.buttons = new Set();
    this.justClicked = new Set();
    this.mouse = { dx: 0, dy: 0 };
    this.locked = false;
    this.typing = false;
    addEventListener('keydown', (e) => {
      if (this.typing) return;
      if (!this.keys.has(e.code)) this.justPressed.add(e.code);
      this.keys.add(e.code);
      if (['Space', 'Tab', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.buttons.clear();
    });
    el.addEventListener('mousedown', (e) => {
      if (!this.engaged) return;
      this.buttons.add(e.button);
      this.justClicked.add(e.button);
    });
    addEventListener('mouseup', (e) => this.buttons.delete(e.button));
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.padActive = false;
      // ignore the occasional giant spike some browsers emit on lock
      if (Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400) return;
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === el;
      if (!this.locked) this.buttons.clear();
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  // Gamepads (PlayStation / Xbox layout): left stick walks, right stick
  // looks, R2 fires, L2 mounts the gun. Polled once a frame and folded into
  // the same keys and mouse movement the keyboard uses.
  pollGamepad(dt) {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = [...pads].find((p) => p && p.connected);
    const prev = this.padKeys || new Set();
    const now = new Set();
    this.padButtons = this.padButtons || new Set();
    if (!gp) {
      for (const k of prev) this.keys.delete(k);
      this.padKeys = now;
      return;
    }
    const dead = (v) => (Math.abs(v) < 0.18 ? 0 : (v - Math.sign(v) * 0.18) / 0.82);
    const lx = dead(gp.axes[0] || 0);
    const ly = dead(gp.axes[1] || 0);
    const rx = dead(gp.axes[2] || 0);
    const ry = dead(gp.axes[3] || 0);
    const pressed = (i) => !!(gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.4));
    const anyInput = lx || ly || rx || ry || gp.buttons.some((b) => b.pressed);
    if (anyInput && !this.padActive && !pressed(9)) this.padActive = true;
    if (lx < -0.3) now.add('KeyA');
    if (lx > 0.3) now.add('KeyD');
    if (ly < -0.3) now.add('KeyW');
    if (ly > 0.3) now.add('KeyS');
    const map = { 0: 'Space', 1: 'KeyC', 2: 'KeyR', 3: 'KeyE', 4: 'KeyB', 5: 'KeyQ', 8: 'Tab', 10: 'ShiftLeft', 12: 'KeyF', 13: 'KeyM' };
    for (const [i, code] of Object.entries(map)) if (pressed(+i)) now.add(code);
    for (const k of now) {
      if (!prev.has(k)) this.justPressed.add(k);
      this.keys.add(k);
    }
    for (const k of prev) if (!now.has(k)) this.keys.delete(k);
    this.padKeys = now;
    // look: curved response so small moves are fine and full tilt turns fast
    const look = 900 * dt;
    this.mouse.dx += Math.sign(rx) * rx * rx * look;
    this.mouse.dy += Math.sign(ry) * ry * ry * look * 0.75;
    for (const [i, b] of [[7, 0], [6, 2]]) {
      const down = pressed(i);
      if (down && !this.padButtons.has(b)) {
        this.buttons.add(b);
        this.justClicked.add(b);
        this.padButtons.add(b);
      } else if (!down && this.padButtons.has(b)) {
        this.buttons.delete(b);
        this.padButtons.delete(b);
      }
    }
    // Options / Start pauses, and starts again
    if (pressed(9) && !this.startHeld) {
      this.padActive = !this.padActive;
      if (this.onLockChange) this.onLockChange(this.engaged);
    }
    this.startHeld = pressed(9);
  }

  // playing: mouse captured, or a gamepad in use
  get engaged() {
    return this.locked || !!this.padActive;
  }

  lock() {
    try {
      const p = this.el.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => this.el.requestPointerLock());
    } catch {
      this.el.requestPointerLock();
    }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code) {
    return this.keys.has(code);
  }

  pressed(code) {
    return this.justPressed.has(code);
  }

  mouseDown(b) {
    return this.buttons.has(b);
  }

  clicked(b) {
    return this.justClicked.has(b);
  }

  endFrame() {
    this.justPressed.clear();
    this.justClicked.clear();
  }
}
