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
    <dt><kbd>Q</kbd> / <kbd>1</kbd>–<kbd>4</kbd></dt><dd>Change the lantern's season</dd>
    <dt><kbd>F</kbd></dt><dd>Dim / relight the lantern</dd>
    <dt><kbd>M</kbd></dt><dd>Archipelago map</dd>
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
        <h2>Seasonkeeper</h2>
        <p class="pitch">Five islands, each stuck in the same long summer. Carry the old lantern and the world around you changes
        season: spring grows bridges of vine, winter freezes the lagoon, autumn strips the thorns bare and storm wakes the windmills.
        Wake each island's shrine to find your way to the peak.</p>
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
        <div class="objectives" aria-live="polite"><h4></h4><ul></ul></div>
        <div class="seasons" aria-label="Lantern seasons"></div>
      </div>

      <div id="map" class="overlay interactive hidden" role="dialog" aria-modal="true" aria-labelledby="map-h">
        <div class="map-panel">
          <h2 id="map-h">The Archipelago</h2>
          <p class="sub">Choose an island to sail to.</p>
          <svg viewBox="0 0 600 300" class="map-svg" aria-hidden="true"></svg>
          <div class="map-list"></div>
          <button class="btn secondary" data-act="close-map">Close</button>
        </div>
      </div>
      <div id="fade" class="hidden"><div class="fade-text"></div></div>

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
      objectives: this.$('#hud .objectives'),
      seasons: this.$('#hud .seasons'),
      map: this.$('#map'),
      fade: this.$('#fade'),
      debugPre: this.$('#debug pre'),
      debugBtns: this.$('#debug .btns'),
    };
    if (this.isTouch) this.$('#touch-note').classList.remove('hidden');

    root.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act.startsWith('sail:')) {
        this.h.onAction?.('sail', Number(act.slice(5)));
        return;
      }
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
    this.el.map.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        e.stopPropagation();
        this.h.onAction?.('close-map');
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

  setObjectives(title, list) {
    const key = title + JSON.stringify(list);
    if (key === this._obj) return;
    this._obj = key;
    this.el.objectives.querySelector('h4').textContent = title;
    this.el.objectives.querySelector('ul').innerHTML = list
      .map((o) => `<li class="${o.done ? 'done' : ''}" data-id="${esc(o.id)}"><span class="tick">${o.done ? '✔' : '○'}</span>${esc(o.text)}</li>`)
      .join('');
  }

  /** seasons: [{id,label,color,key,available}], active id or null. */
  setSeasons(seasons, active, lit) {
    const key = JSON.stringify([seasons.map((s) => s.id + s.available), active, lit]);
    if (key === this._seasonsKey) return;
    this._seasonsKey = key;
    this.el.seasons.classList.toggle('hidden', !seasons.some((s) => s.available));
    this.el.seasons.innerHTML = seasons
      .map((s) => `<div class="season ${s.available ? '' : 'locked'} ${s.id === active && lit ? 'on' : ''}" style="--c:${s.color}" data-season="${s.id}" title="${esc(s.label)}"><kbd>${s.key}</kbd><span>${s.available ? esc(s.label) : '?'}</span></div>`)
      .join('');
  }

  /** levels: [{index,name,season,color,unlocked,completed,current}] */
  showMap(show, levels = []) {
    this.el.map.classList.toggle('hidden', !show);
    if (!show) return;
    const svg = this.$('#map .map-svg');
    const pts = [[80, 210], [190, 110], [300, 200], [410, 100], [520, 170]];
    let out = `<defs><radialGradient id="sea" cx="50%" cy="50%" r="70%"><stop offset="0" stop-color="#2c6d8c"/><stop offset="1" stop-color="#173c55"/></radialGradient></defs>
      <rect x="0" y="0" width="600" height="300" rx="18" fill="url(#sea)"/>`;
    for (let i = 0; i < pts.length - 1; i++) {
      const open = levels[i + 1]?.unlocked;
      out += `<path d="M${pts[i][0]},${pts[i][1]} Q${(pts[i][0] + pts[i + 1][0]) / 2},${Math.min(pts[i][1], pts[i + 1][1]) - 40} ${pts[i + 1][0]},${pts[i + 1][1]}" stroke="${open ? '#f3e2b5' : '#ffffff33'}" stroke-width="3" stroke-dasharray="8 7" fill="none"/>`;
    }
    levels.forEach((l, i) => {
      const [x, y] = pts[i];
      const r = l.current ? 34 : 28;
      out += `<g class="isle ${l.unlocked ? 'open' : 'closed'}">
        <ellipse cx="${x}" cy="${y + 6}" rx="${r + 10}" ry="${r * 0.55 + 6}" fill="#4fd0c455"/>
        <path d="M${x - r},${y + 4} Q${x - r * 0.6},${y - r * 0.9} ${x},${y - r} Q${x + r * 0.7},${y - r * 0.8} ${x + r},${y + 4} Q${x},${y + r * 0.5} ${x - r},${y + 4}Z" fill="${l.unlocked ? '#7aa84e' : '#4a5a55'}" stroke="#e3cf9b" stroke-width="3"/>
        <circle cx="${x}" cy="${y - r * 0.35}" r="7" fill="${l.completed ? l.color : '#00000055'}" stroke="${l.color}" stroke-width="2"/>
        <text x="${x}" y="${y + r * 0.75 + 22}" text-anchor="middle" fill="#f3e9d2" font-size="15" font-family="Georgia, serif">${esc(l.name)}</text>
      </g>`;
    });
    svg.innerHTML = out;
    this.$('#map .map-list').innerHTML = levels
      .map((l) => `<button class="btn ${l.current ? 'secondary' : ''}" data-act="sail:${l.index}" ${l.unlocked && !l.current ? '' : 'disabled'} data-level="${l.index}">
        ${esc(l.name)}<small>${l.completed ? 'Shrine awake' : l.unlocked ? (l.season ? `Teaches ${esc(l.season)}` : 'All four seasons') : 'Locked'}${l.current ? ' · you are here' : ''}</small></button>`)
      .join('');
    setTimeout(() => this.$('#map .map-list button:not([disabled])')?.focus(), 30);
  }

  /** Full-screen fade used for the boat crossing. */
  fade(on, text = '') {
    const f = this.el.fade;
    f.querySelector('.fade-text').textContent = text;
    if (on) {
      f.classList.remove('hidden');
      requestAnimationFrame(() => f.classList.add('on'));
    } else {
      f.classList.remove('on');
      setTimeout(() => f.classList.add('hidden'), 900);
    }
  }

  banner(kicker, title) {
    this.card(kicker, title, '');
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
