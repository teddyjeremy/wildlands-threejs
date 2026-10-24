import './styles.css';
import { DISCOVERIES, COLLECTIBLE_TEXT } from '../interaction/discoveries.js';

// Semantic HTML overlay: title, HUD, notebook, pause/settings, cards.
// The UI never touches game state directly; it calls the handlers passed in.

const CONTROLS = `
  <dl class="controls-list">
    <dt><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></dt><dd>Move (or arrow keys)</dd>
    <dt><kbd>Shift</kbd></dt><dd>Run</dd>
    <dt><kbd>Space</kbd></dt><dd>Jump</dd>
    <dt><kbd>E</kbd></dt><dd>Interact / pick up</dd>
    <dt>Mouse</dt><dd>Click the world to look around, wheel to zoom</dd>
    <dt><kbd>N</kbd> / <kbd>Tab</kbd></dt><dd>Field notebook</dd>
    <dt><kbd>Esc</kbd></dt><dd>Pause and release the mouse</dd>
  </dl>`;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class UI {
  constructor(root, handlers) {
    this.root = root;
    this.h = handlers;
    this.isTouch = matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0;
    root.innerHTML = `
      <div id="loading" role="status" aria-live="polite"><p>Shaping the island…</p></div>

      <section id="title" class="interactive hidden" aria-labelledby="title-h">
        <h1 id="title-h">WILDLANDS</h1>
        <h2>The Island That Remembers</h2>
        <p class="pitch">A small island that keeps a record of where you've been. Grass bends under your boots and slowly grows back,
        hares watch you from the meadow, and when the rain comes the water finds its own way downhill.</p>
        <div class="title-actions">
          <button class="btn" data-act="start" id="start-btn">Start Exploring</button>
          <button class="btn secondary" data-act="toggle-controls" aria-expanded="false" aria-controls="title-controls">Controls</button>
        </div>
        <div id="title-controls" class="hidden">${CONTROLS}</div>
        <div class="title-options">
          <label><input type="checkbox" data-setting="sound" checked /> Sound</label>
          <label>Quality
            <select data-setting="quality">
              <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
            </select>
          </label>
        </div>
        <p class="touch-note hidden" id="touch-note">WILDLANDS is built for a keyboard and mouse. On a touch screen you can look around the island, but walking needs a keyboard.</p>
      </section>

      <div id="hud" class="hidden">
        <div class="region" aria-live="polite"></div>
        <div class="weather"></div>
        <button class="counter interactive" data-act="notebook" aria-label="Open field notebook">📓 <span class="count">0 / 0</span></button>
        <div class="prompt hidden" aria-live="polite"></div>
        <div class="hint"></div>
        <div class="toasts" aria-live="polite"></div>
      </div>

      <div id="card" class="card hidden" role="status" aria-live="polite"></div>

      <div id="notebook" class="overlay interactive hidden" role="dialog" aria-modal="true" aria-labelledby="nb-h">
        <div class="notebook">
          <button class="btn secondary close" data-act="close-notebook" style="color:#3a2f22;border-color:#3a2f2255">Close</button>
          <h2 id="nb-h">Field Notebook</h2>
          <p class="sub"></p>
          <h4>Observations</h4>
          <ul class="entries"></ul>
          <h4>Collected</h4>
          <ul class="items"></ul>
        </div>
      </div>

      <div id="pause" class="overlay interactive hidden" role="dialog" aria-modal="true" aria-labelledby="pause-h">
        <div class="panel">
          <h2 id="pause-h">Paused</h2>
          <div class="stack">
            <button class="btn" data-act="resume">Resume</button>
          </div>
          <details style="margin-top:1em"><summary>Controls</summary>${CONTROLS}
            <p class="note">The mouse is released while paused. Click the world after resuming to look around again.</p></details>
          <h3>Audio</h3>
          <div class="row"><label for="s-mute">Mute</label><input id="s-mute" type="checkbox" data-setting="muted" /></div>
          <div class="row"><label for="s-master">Master volume</label><input id="s-master" type="range" min="0" max="1" step="0.05" data-setting="masterVolume" /></div>
          <div class="row"><label for="s-amb">Ambience</label><input id="s-amb" type="range" min="0" max="1" step="0.05" data-setting="ambienceVolume" /></div>
          <div class="row"><label for="s-fx">Effects</label><input id="s-fx" type="range" min="0" max="1" step="0.05" data-setting="effectsVolume" /></div>
          <h3>Display &amp; camera</h3>
          <div class="row"><label for="s-q">Quality</label>
            <select id="s-q" data-setting="quality"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></div>
          <div class="row"><label for="s-sens">Mouse sensitivity</label><input id="s-sens" type="range" min="0.3" max="2.5" step="0.1" data-setting="sensitivity" /></div>
          <div class="row"><label for="s-inv">Invert vertical look</label><input id="s-inv" type="checkbox" data-setting="invertY" /></div>
          <div class="row"><label for="s-rm">Reduced motion</label><input id="s-rm" type="checkbox" data-setting="reducedMotion" /></div>
          <div class="stack">
            <button class="btn danger" data-act="reset">Reset progress</button>
            <button class="btn secondary" data-act="exit">Exit to title</button>
          </div>
          <p class="note">Progress saves automatically in this browser.</p>
        </div>
      </div>

      <div id="debug" class="interactive hidden"><pre></pre><div class="btns"></div></div>
    `;
    this.$ = (sel) => root.querySelector(sel);
    this.el = {
      loading: this.$('#loading'),
      title: this.$('#title'),
      hud: this.$('#hud'),
      region: this.$('#hud .region'),
      weather: this.$('#hud .weather'),
      count: this.$('#hud .count'),
      prompt: this.$('#hud .prompt'),
      hint: this.$('#hud .hint'),
      toasts: this.$('#hud .toasts'),
      card: this.$('#card'),
      notebook: this.$('#notebook'),
      pause: this.$('#pause'),
      debug: this.$('#debug'),
      debugPre: this.$('#debug pre'),
      debugBtns: this.$('#debug .btns'),
    };
    if (this.isTouch) this.$('#touch-note').classList.remove('hidden');

    root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'toggle-controls') {
        const box = this.$('#title-controls');
        box.classList.toggle('hidden');
        btn.setAttribute('aria-expanded', String(!box.classList.contains('hidden')));
        return;
      }
      if (act === 'reset' && !confirm('Reset all discoveries, collected items and trails?')) return;
      this.h.onAction?.(act);
    });
    root.addEventListener('input', (e) => {
      const t = e.target;
      const key = t.dataset?.setting;
      if (!key) return;
      let value = t.type === 'checkbox' ? t.checked : t.type === 'range' ? Number(t.value) : t.value;
      if (key === 'sound') this.h.onSetting?.('muted', !value);
      else this.h.onSetting?.(key, value);
    });
    // Close overlays with Escape when focused inside them.
    this.el.notebook.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'n' || e.key === 'N' || e.key === 'Tab') {
        e.preventDefault();
        e.stopPropagation();
        this.h.onAction?.('close-notebook');
      }
    });
    this.el.pause.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.h.onAction?.('resume');
      }
    });
  }

  loaded() {
    this.el.loading.classList.add('fade');
    setTimeout(() => this.el.loading.classList.add('hidden'), 700);
  }

  loadingStatus(text) {
    this.el.loading.querySelector('p').textContent = text;
  }

  fatal(message) {
    this.el.loading.classList.remove('hidden', 'fade');
    this.el.loading.innerHTML = `<p class="err">${esc(message)}</p>`;
  }

  syncSettings(s) {
    for (const input of this.root.querySelectorAll('[data-setting]')) {
      const k = input.dataset.setting;
      if (k === 'sound') input.checked = !s.muted;
      else if (input.type === 'checkbox') input.checked = !!s[k];
      else input.value = s[k];
    }
    document.body.classList.toggle('reduced-motion', s.reducedMotion);
  }

  showTitle(show) {
    this.el.title.classList.remove('hidden');
    this.el.title.classList.toggle('fade', !show);
    if (show) {
      this.el.title.classList.remove('hidden');
      setTimeout(() => this.$('#start-btn').focus(), 50);
    } else setTimeout(() => this.el.title.classList.add('hidden'), 800);
    this.el.hud.classList.toggle('hidden', show);
  }

  setRegion(name) {
    if (this._region === name) return;
    this._region = name;
    this.el.region.textContent = name;
  }

  setWeather(text) {
    if (this._weather !== text) this.el.weather.textContent = this._weather = text;
  }

  setCount(found, total) {
    this.el.count.textContent = `${found} / ${total}`;
  }

  setPrompt(text) {
    if (this._prompt === text) return;
    this._prompt = text;
    this.el.prompt.classList.toggle('hidden', !text);
    if (text) this.el.prompt.innerHTML = `<kbd>E</kbd>${esc(text)}`;
  }

  setHint(text) {
    this.el.hint.textContent = text || '';
    this.el.hint.style.opacity = text ? 1 : 0;
  }

  toast(kicker, text) {
    const div = document.createElement('div');
    div.className = 'toast';
    div.innerHTML = `<strong>${esc(kicker)}</strong>${esc(text)}`;
    this.el.toasts.appendChild(div);
    setTimeout(() => div.remove(), 4200);
    while (this.el.toasts.children.length > 3) this.el.toasts.firstChild.remove();
  }

  card(kicker, title, text) {
    const c = this.el.card;
    c.innerHTML = `<div class="kicker">${esc(kicker)}</div><h3>${esc(title)}</h3><p>${esc(text)}</p>`;
    c.classList.remove('hidden');
    clearTimeout(this._cardTimer);
    this._cardTimer = setTimeout(() => c.classList.add('hidden'), 7000);
  }

  hideCard() {
    this.el.card.classList.add('hidden');
  }

  showNotebook(show, progress) {
    this.el.notebook.classList.toggle('hidden', !show);
    if (!show) return;
    const { discovered, collected, collectibles } = progress;
    const total = DISCOVERIES.length + collectibles.length;
    const found = discovered.size + collected.size;
    this.$('#notebook .sub').textContent = `${found} of ${total} entries recorded. Entries persist in this browser.`;
    this.$('#notebook .entries').innerHTML = DISCOVERIES.map((d) => {
      const ok = discovered.has(d.id);
      return `<li class="${ok ? '' : 'locked'}"><span class="where">${esc(d.region)}</span><h3>${ok ? esc(d.title) : 'Not yet recorded'}</h3><p>${ok ? esc(d.text) : 'Somewhere on the island…'}</p></li>`;
    }).join('');
    this.$('#notebook .items').innerHTML = collectibles.map((c) => {
      const ok = collected.has(c.id);
      return `<li class="${ok ? '' : 'locked'}"><span class="where">Trinket</span><h3>${ok ? esc(c.name) : '???'}</h3><p>${ok ? esc(COLLECTIBLE_TEXT[c.id] || '') : 'Not found yet.'}</p></li>`;
    }).join('');
    this.$('#notebook .close').focus();
  }

  showPause(show) {
    this.el.pause.classList.toggle('hidden', !show);
    if (show) setTimeout(() => this.$('#pause [data-act=resume]').focus(), 30);
  }

  showDebug(show) {
    this.el.debug.classList.toggle('hidden', !show);
  }

  setDebugButtons(buttons) {
    this.el.debugBtns.innerHTML = '';
    for (const b of buttons) {
      const el = document.createElement('button');
      el.textContent = b.label;
      el.addEventListener('click', () => {
        b.onClick();
        this.refreshDebugButtons(buttons);
      });
      b.el = el;
      this.el.debugBtns.appendChild(el);
    }
    this.refreshDebugButtons(buttons);
  }

  refreshDebugButtons(buttons) {
    for (const b of buttons) b.el?.classList.toggle('on', !!b.isOn?.());
  }

  setDebugText(text) {
    this.el.debugPre.textContent = text;
  }
}
