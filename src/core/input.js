// Keyboard + mouse. Held keys are polled; one-shot actions are queued so a
// quick tap between two frames is never lost.

const BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  run: ['ShiftLeft', 'ShiftRight'],
};
const PRESS = {
  KeyE: 'interact',
  Space: 'jump',
  KeyN: 'notebook',
  Tab: 'notebook',
  Escape: 'pause',
  KeyP: 'pause',
  KeyQ: 'season-next',
  Digit1: 'season-1',
  Digit2: 'season-2',
  Digit3: 'season-3',
  Digit4: 'season-4',
  KeyF: 'lantern',
  KeyM: 'map',
  Backquote: 'debug',
  F3: 'debug',
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.pressed = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.enabled = false;
    this.dragging = false;
    this.locked = false;
    this.onLockChange = null;
    this._handlers = [];

    this._on(window, 'keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      // Keep Tab/Space/arrows from scrolling or moving focus while playing.
      if (this.enabled && ['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!e.repeat && PRESS[e.code]) this.pressed.add(PRESS[e.code]);
      this.down.add(e.code);
    });
    this._on(window, 'keyup', (e) => this.down.delete(e.code));
    this._on(window, 'blur', () => this.down.clear());
    this._on(canvas, 'mousedown', (e) => {
      if (!this.enabled) return;
      this.dragging = true;
      this._lastX = e.clientX;
      this._lastY = e.clientY;
      if (!this.locked && e.button === 0) this.requestLock();
    });
    this._on(window, 'mouseup', () => (this.dragging = false));
    this._on(window, 'mousemove', (e) => {
      if (!this.enabled) return;
      if (this.locked) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      } else if (this.dragging) {
        this.mouseDX += e.clientX - this._lastX;
        this.mouseDY += e.clientY - this._lastY;
        this._lastX = e.clientX;
        this._lastY = e.clientY;
      }
    });
    this._on(canvas, 'wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      this.wheel += e.deltaY;
    }, { passive: false });
    this._on(document, 'pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === canvas;
      if (was !== this.locked) this.onLockChange?.(this.locked);
    });
  }

  _on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this._handlers.push([target, type, fn, opts]);
  }

  requestLock() {
    try {
      const p = this.canvas.requestPointerLock?.();
      if (p && p.catch) p.catch(() => {});
    } catch {
      /* pointer lock unavailable (e.g. iframe) - drag-to-look still works */
    }
  }

  releaseLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  axis() {
    const d = (k) => BINDINGS[k].some((c) => this.down.has(c));
    return {
      x: (d('right') ? 1 : 0) - (d('left') ? 1 : 0),
      z: (d('back') ? 1 : 0) - (d('forward') ? 1 : 0),
      run: d('run'),
    };
  }

  consume(action) {
    if (this.pressed.has(action)) {
      this.pressed.delete(action);
      return true;
    }
    return false;
  }

  endFrame() {
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.pressed.clear();
  }

  dispose() {
    for (const [t, type, fn, opts] of this._handlers) t.removeEventListener(type, fn, opts);
    this._handlers = [];
  }
}
