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
      if (!this.locked) return;
      this.buttons.add(e.button);
      this.justClicked.add(e.button);
    });
    addEventListener('mouseup', (e) => this.buttons.delete(e.button));
    addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
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
