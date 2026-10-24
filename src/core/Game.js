import * as THREE from 'three';
import { generateTerrain, configKey } from '../procedural/terrain.js';
import { placeGrass } from '../procedural/placement.js';
import { smoothstep } from '../procedural/math.js';
import { buildTerrainMesh } from '../world/terrainMesh.js';
import { createOcean } from '../world/ocean.js';
import { createSky } from '../world/sky.js';
import { buildProps } from '../world/props.js';
import { CollisionWorld } from '../player/collision.js';
import { Player } from '../player/Player.js';
import { ThirdPersonCamera } from '../player/camera.js';
import { TrailGrid } from '../simulation/trailGrid.js';
import { createGrass } from '../simulation/grass.js';
import { WeatherSim } from '../simulation/weather.js';
import { createWater } from '../simulation/water.js';
import { createRain } from '../simulation/rain.js';
import { Wildlife } from '../simulation/wildlife.js';
import { InteractionRegistry } from '../interaction/registry.js';
import { DISCOVERIES } from '../interaction/discoveries.js';
import { createCollectibles } from '../interaction/collectibles.js';
import { AudioManager } from '../systems/audio.js';
import { SaveStore, DEFAULT_SETTINGS, sanitizeSettings } from '../systems/save.js';
import { getPreset, suggestQuality } from '../systems/quality.js';
import { Diagnostics, createWildlifeOverlay, createPlacementOverlay } from '../systems/diagnostics.js';
import { Input } from './input.js';
import { UI } from '../ui/ui.js';

const STEP = 1 / 60; // fixed simulation step
const MAX_FRAME = 0.1; // cap: a long stall never becomes a giant jump
const DAY_LENGTH = 600; // seconds for a full day/night cycle
const AUTOSAVE = 10;

const REGION_NAMES = {
  cove: 'Starting Cove', village: 'Village', forest: 'Forest', ridge: 'Central Ridge', wetland: 'Wetland',
  lighthouse: 'Lighthouse Point', cave: 'Hidden Hollow', meadow: 'Meadow', beach: 'Shore', sea: 'Shallows',
};

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

export class Game {
  constructor(container, uiRoot) {
    this.container = container;
    const params = new URLSearchParams(location.search);
    this.seed = (params.get('seed') || 'wildlands').slice(0, 40);
    this.debugAllowed = true;
    this.debug = params.has('debug');
    this.mode = 'loading';
    this.time = 0;
    this.timeOfDay = 0.66;
    this.progress = { discovered: new Set(), collected: new Set() };
    this.hintStage = 0;
    this._listeners = [];

    this.ui = new UI(uiRoot, {
      onAction: (a) => this.onAction(a),
      onSetting: (k, v) => this.setSetting(k, v),
    });
  }

  async init() {
    const ui = this.ui;
    ui.loadingStatus('Shaping the island…');
    await nextFrame();
    this.terrain = generateTerrain({ seed: this.seed });
    this.worldKey = configKey(this.terrain.config);
    this.store = new SaveStore();
    const saved = this.store.load(this.worldKey);
    this.saved = saved;
    this.settings = sanitizeSettings(saved?.settings || { ...DEFAULT_SETTINGS, quality: suggestQuality() });
    const qParam = new URLSearchParams(location.search).get('quality');
    if (['low', 'medium', 'high'].includes(qParam)) this.settings.quality = qParam;
    this.quality = getPreset(this.settings.quality);

    // Renderer.
    const renderer = new THREE.WebGLRenderer({ antialias: this.settings.quality !== 'low', powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.info.autoReset = true;
    this.container.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', 'WILDLANDS game view');
    this.renderer = renderer;
    this._on(renderer.domElement, 'webglcontextlost', (e) => {
      e.preventDefault();
      this.ui.fatal('The graphics context was lost. Reload the page to continue.');
    });

    const scene = new THREE.Scene();
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1500);
    this.sky = createSky(scene, this.quality);

    ui.loadingStatus('Raising the ridge…');
    await nextFrame();
    const terrainMesh = buildTerrainMesh(this.terrain, this.seed);
    this.terrainMesh = terrainMesh;
    scene.add(terrainMesh.mesh);
    this.ocean = createOcean(this.terrain, this.quality.oceanSegments);
    scene.add(this.ocean.mesh);

    ui.loadingStatus('Planting the forest…');
    await nextFrame();
    this.collisions = new CollisionWorld(8);
    this.props = buildProps({ scene, terrain: this.terrain, collisions: this.collisions, seed: this.seed, quality: this.quality });

    // Trail memory + grass.
    this.trail = new TrailGrid({ size: this.terrain.grid.size, cellSize: 0.75, surfaceAt: (x, z) => this.terrain.groundTypeAt(x, z) });
    this.trailTexData = new Uint8Array(this.trail.res * this.trail.res);
    this.trailTex = new THREE.DataTexture(this.trailTexData, this.trail.res, this.trail.res, THREE.RedFormat, THREE.UnsignedByteType);
    this.trailTex.magFilter = THREE.LinearFilter;
    this.trailTex.minFilter = THREE.LinearFilter;
    this.trailTex.needsUpdate = true;
    terrainMesh.uniforms.uTrail.value = this.trailTex;
    terrainMesh.uniforms.uTrailSize.value = this.terrain.grid.size;
    const grassPositions = placeGrass(this.terrain, this.terrain.config.vegetationSeed || `${this.seed}:veg`, 26000);
    this.grass = createGrass({ positions: grassPositions, maxCount: this.quality.grassCount, trail: this.trail, scene });

    ui.loadingStatus('Filling the streams…');
    await nextFrame();
    this.weather = new WeatherSim(this.seed);
    this.water = createWater({ scene, terrain: this.terrain, seed: this.seed });
    this.rain = createRain(scene, 2400);
    this.rain.setCount(this.quality.rainCount);
    this.wildlife = new Wildlife({ scene, terrain: this.terrain, collisions: this.collisions, seed: this.seed, count: 4 });
    this.wildlife.setCount(this.quality.maxAnimals);

    // Player, camera, input.
    this.player = new Player({ scene, terrain: this.terrain, collisions: this.collisions });
    const start = this.terrain.layout.start;
    this.player.spawn(start.x, start.z, start.heading);
    this.follow = new ThirdPersonCamera(this.camera, this.terrain);
    this.follow.obstacles = this.props.meshes.filter((m) => !m.isInstancedMesh || /trees/.test(m.name));
    this.follow.obstacles.push(terrainMesh.mesh);
    this.input = new Input(renderer.domElement);
    this.input.onLockChange = (locked) => {
      if (!locked && this.mode === 'play') this.setMode('paused');
    };

    this.audio = new AudioManager(this.settings);
    this.player.onStep = (s) => this.audio.footstep(s);
    this.player.onJump = () => this.audio.jump();
    this.player.onLand = (impact) => {
      if (impact > 4) this.audio.footstep(this.player.surface);
    };

    this.collectibles = createCollectibles(scene, this.terrain);
    this.setupInteractions();

    this.diag = new Diagnostics(renderer);
    this.wildlifeOverlay = createWildlifeOverlay(scene, this.wildlife);
    this.placementOverlay = createPlacementOverlay(scene, this.props.data, this.collectibles.items);
    this.setupDebugButtons();

    this.restore(saved);
    ui.syncSettings(this.settings);
    this.applyQuality();
    this.updateCounter();

    this._on(window, 'resize', () => this.resize());
    this._on(document, 'visibilitychange', () => this.onVisibility());
    this._on(window, 'pagehide', () => this.save());

    // Compile shaders up front so the first frame after Start doesn't hitch.
    this.updateTitleCamera(0);
    this.sky.update(this.timeOfDay, this.camera.position, 0, 0);
    renderer.compile(scene, this.camera);
    this.checkShaders();

    this.clock = new THREE.Clock();
    this.acc = 0;
    this.setMode('title');
    ui.loaded();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
    if (this.debug) this.toggleDebug(true);
    this.exposeHooks();
  }

  _on(target, type, fn, opts) {
    target.addEventListener(type, fn, opts);
    this._listeners.push([target, type, fn, opts]);
  }

  /** If the ocean shader failed to link, swap to the plain fallback material. */
  checkShaders() {
    const gl = this.renderer.getContext();
    const props = this.renderer.properties.get(this.ocean.mesh.material);
    const program = props?.currentProgram?.program;
    if (program && !gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('[ocean] shader failed, using fallback material');
      this.ocean.useFallback();
    }
  }

  // ---------------------------------------------------------------- interactions
  setupInteractions() {
    const reg = new InteractionRegistry();
    this.interactions = reg;
    const d = this.props.data;
    const T = this.terrain;
    const at = (p, y) => ({ x: p.x, y: y ?? T.heightAt(p.x, p.z), z: p.z });
    const spots = {
      'dock-note': { pos: at(d.dockNote, d.dockNote.y), radius: 2.4 },
      'notice-board': { pos: at(d.noticeBoard), radius: 2.8 },
      'old-tree': { pos: at(d.oldTree), radius: 4.2 },
      spring: { pos: at(d.spring), radius: 3.4 },
      lighthouse: { pos: at(d.lighthouseDoor), radius: 3.2 },
      summit: { pos: at(d.summit), radius: 3.2 },
      'cave-relic': { pos: at(d.caveRelic), radius: 2.8 },
    };
    for (const entry of DISCOVERIES) {
      if (entry.id === 'hare-observed') continue;
      const s = spots[entry.id];
      reg.register({
        id: entry.id,
        prompt: entry.prompt,
        radius: s.radius,
        getPosition: () => s.pos,
        onInteract: () => this.discover(entry),
      });
    }
    // Wildlife observation: only while the hare is calm enough to watch.
    const hare = DISCOVERIES.find((e) => e.id === 'hare-observed');
    const tmp = { x: 0, y: 0, z: 0 };
    reg.register({
      id: hare.id,
      prompt: hare.prompt,
      radius: 13,
      getPosition: () => {
        const n = this.wildlife.nearest(this.player.pos.x, this.player.pos.z);
        if (!n) return { x: 1e6, y: 0, z: 1e6 };
        tmp.x = n.animal.pos.x;
        tmp.z = n.animal.pos.z;
        tmp.y = T.heightAt(tmp.x, tmp.z);
        return tmp;
      },
      canInteract: () => {
        const n = this.wildlife.nearest(this.player.pos.x, this.player.pos.z);
        return !!n && n.animal.brain.state !== 'flee' && n.distance > 3;
      },
      onInteract: () => this.discover(hare),
    });
    for (const c of this.collectibles.items) {
      reg.register({
        id: `item:${c.id}`,
        prompt: `Pick up ${c.name}`,
        radius: 1.9,
        getPosition: () => c,
        canInteract: () => !c.collected,
        onInteract: () => this.collect(c),
      });
    }
  }

  discover(entry) {
    this.player.interact();
    const first = !this.progress.discovered.has(entry.id);
    this.progress.discovered.add(entry.id);
    this.ui.card(first ? 'New notebook entry' : entry.region, entry.title, entry.text);
    if (first) {
      this.audio.discover();
      this.updateCounter();
      this.save();
    } else this.audio.ui('open');
  }

  collect(item) {
    this.player.interact();
    this.collectibles.markCollected(item.id);
    this.progress.collected.add(item.id);
    this.audio.chime();
    this.ui.toast('Collected', item.name);
    this.updateCounter();
    if (this.hintStage < 3) this.hintStage = 3;
    this.save();
  }

  updateCounter() {
    const total = DISCOVERIES.length + this.collectibles.items.length;
    this.ui.setCount(this.progress.discovered.size + this.progress.collected.size, total);
  }

  // ---------------------------------------------------------------- persistence
  restore(saved) {
    if (!saved) return;
    for (const id of saved.discovered) if (DISCOVERIES.some((d) => d.id === id)) this.progress.discovered.add(id);
    for (const id of saved.collected) {
      if (this.collectibles.items.some((c) => c.id === id)) {
        this.progress.collected.add(id);
        this.collectibles.markCollected(id);
      }
    }
    if (saved.timeOfDay !== null) this.timeOfDay = saved.timeOfDay;
    if (saved.trail && this.trail.deserialize(saved.trail)) this.grass.refreshAll();
    if (saved.player) {
      this.player.spawn(saved.player.x, saved.player.z, saved.player.heading, saved.player.y);
      this.hintStage = 3;
    }
  }

  save() {
    if (!this.store || this.mode === 'loading') return;
    this.store.save({
      seed: this.seed,
      worldKey: this.worldKey,
      settings: this.settings,
      discovered: [...this.progress.discovered],
      collected: [...this.progress.collected],
      player: { x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z, heading: this.player.heading },
      timeOfDay: this.timeOfDay,
      trail: this.trail.serialize(),
    });
  }

  resetProgress() {
    this.store.clear();
    this.progress.discovered.clear();
    this.progress.collected.clear();
    this.collectibles.reset();
    this.trail.clear();
    this.grass.refreshAll();
    const s = this.terrain.layout.start;
    this.player.spawn(s.x, s.z, s.heading);
    this.trail.lastX = null;
    this.follow.snap();
    this.timeOfDay = 0.66;
    this.hintStage = 0;
    this.updateCounter();
    this.ui.toast('Progress reset', 'The island has forgotten you.');
    this.store.save({ seed: this.seed, worldKey: this.worldKey, settings: this.settings, discovered: [], collected: [], player: null, timeOfDay: this.timeOfDay, trail: null });
  }

  // ---------------------------------------------------------------- settings
  setSetting(key, value) {
    this.settings = sanitizeSettings({ ...this.settings, [key]: value });
    this.audio.applySettings(this.settings);
    this.follow.sensitivity = this.settings.sensitivity;
    this.follow.invertY = this.settings.invertY;
    if (key === 'quality') this.applyQuality();
    this.ui.syncSettings(this.settings);
    this.save();
  }

  applyQuality() {
    this.quality = getPreset(this.settings.quality);
    const q = this.quality;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.renderer.shadowMap.enabled = q.shadows;
    this.sky.setShadows(q);
    this.grass.setCount(q.grassCount);
    this.rain.setCount(q.rainCount);
    this.props.flowerMesh.count = Math.min(this.props.data.flowerCount ?? 900, q.flowers);
    this.wildlife.setCount(q.maxAnimals);
    // Materials need a recompile when shadows toggle.
    this.scene.traverse((o) => {
      if (o.material) o.material.needsUpdate = true;
    });
    this.follow.sensitivity = this.settings.sensitivity;
    this.follow.invertY = this.settings.invertY;
    this.resize();
  }

  // ---------------------------------------------------------------- modes
  async onAction(a) {
    switch (a) {
      case 'start':
        await this.audio.start();
        this.audio.ui('open');
        this.follow.easeFrom(this.camera.position);
        this.setMode('play');
        this.input.requestLock();
        break;
      case 'resume':
        this.audio.ui('close');
        this.setMode('play');
        this.input.requestLock();
        break;
      case 'notebook':
        if (this.mode === 'play') this.setMode('notebook');
        break;
      case 'close-notebook':
        this.audio.ui('close');
        this.setMode('play');
        break;
      case 'reset':
        this.resetProgress();
        break;
      case 'exit':
        this.save();
        this.setMode('title');
        break;
      default:
    }
  }

  setMode(mode) {
    const prev = this.mode;
    this.mode = mode;
    this.ui.showTitle(mode === 'title');
    this.ui.showPause(mode === 'paused');
    this.ui.showNotebook(mode === 'notebook', { ...this.progress, collectibles: this.collectibles.items });
    this.input.enabled = mode === 'play';
    if (mode !== 'play') {
      this.input.releaseLock();
      this.ui.setPrompt('');
    }
    if (mode === 'notebook' && prev === 'play') this.audio.ui('open');
    this.audio.setPaused(mode === 'paused' || mode === 'notebook');
    if (mode === 'play') this.input.down.clear();
    if (mode === 'title' && this.audio.ctx) this.audio.setPaused(false);
    if (prev === 'play' && mode !== 'play') this.save();
  }

  onVisibility() {
    if (document.hidden) {
      if (this.mode === 'play') this.setMode('paused');
      this.audio.setPaused(true);
      this.save();
    } else {
      // Throw away the time spent hidden so nothing jumps.
      this.clock?.getDelta();
      this.acc = 0;
      if (this.mode === 'title') this.audio.setPaused(false);
    }
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  toggleDebug(force) {
    this.debug = force ?? !this.debug;
    this.ui.showDebug(this.debug);
    if (!this.debug) {
      this.terrainMesh.uniforms.uDebugMode.value = 0;
      this.wildlifeOverlay.group.visible = false;
      this.placementOverlay.visible = false;
    }
  }

  setupDebugButtons() {
    const u = this.terrainMesh.uniforms.uDebugMode;
    const mode = (m) => ({ label: ['', 'Trail heat', 'Regions', 'Slope'][m], onClick: () => (u.value = u.value === m ? 0 : m), isOn: () => u.value === m });
    this.debugButtons = [
      mode(1), mode(2), mode(3),
      { label: 'Placement', onClick: () => (this.placementOverlay.visible = !this.placementOverlay.visible), isOn: () => this.placementOverlay.visible },
      { label: 'Wildlife', onClick: () => (this.wildlifeOverlay.group.visible = !this.wildlifeOverlay.group.visible), isOn: () => this.wildlifeOverlay.group.visible },
      { label: 'Clear', onClick: () => this.weather.setState('clear'), isOn: () => this.weather.state === 'clear' },
      { label: 'Cloudy', onClick: () => this.weather.setState('cloudy'), isOn: () => this.weather.state === 'cloudy' },
      { label: 'Rain', onClick: () => this.weather.setState('rain'), isOn: () => this.weather.state === 'rain' },
      { label: 'Auto weather', onClick: () => (this.weather.auto = !this.weather.auto), isOn: () => this.weather.auto },
      { label: '+3h', onClick: () => (this.timeOfDay = (this.timeOfDay + 0.125) % 1) },
      { label: 'Fast regrow', onClick: () => (this.trail.regrowScale = this.trail.regrowScale === 1 ? 8 : 1), isOn: () => this.trail.regrowScale > 1 },
    ];
    this.ui.setDebugButtons(this.debugButtons);
  }

  // ---------------------------------------------------------------- loop
  loop() {
    requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), MAX_FRAME);
    this.diag.frame();
    try {
      this.frame(dt);
    } catch (err) {
      console.error(err);
      if (!this._reportedError) {
        this._reportedError = true;
        this.ui.toast('Something went wrong', err.message);
      }
    }
  }

  frame(dt) {
    const input = this.input;
    if (input.consume('debug') || (this.mode !== 'play' && false)) this.toggleDebug();
    const simulating = this.mode === 'play' || this.mode === 'title';

    if (this.mode === 'play') {
      if (input.consume('pause')) {
        this.setMode('paused');
      } else if (input.consume('notebook')) {
        this.setMode('notebook');
      } else {
        if (input.consume('jump')) this._jumpQueued = true;
        if (input.consume('interact')) this.interactions.trigger();
        this.follow.rotate(input.mouseDX, input.mouseDY);
        if (input.wheel) this.follow.zoom(input.wheel);
        const axis = input.axis();
        this.acc += dt;
        while (this.acc >= STEP) {
          this.acc -= STEP;
          this.player.step(STEP, { ...axis, jump: this._jumpQueued }, this.follow.yaw);
          this._jumpQueued = false;
        }
        this.player.render(this.acc / STEP, dt, this.settings.reducedMotion);
      }
    } else if (this.mode === 'paused' || this.mode === 'notebook') {
      // Allow closing the notebook with its own key.
      if (this.mode === 'notebook' && input.consume('notebook')) this.setMode('play');
    }
    input.endFrame();

    if (simulating) {
      this.time += dt;
      this.timeOfDay = (this.timeOfDay + dt / DAY_LENGTH) % 1;
      this.weather.update(dt);
      this.trail.update(dt);
      if (this.mode === 'play') this.trail.step(this.player.pos.x, this.player.pos.z, { weight: this.player.running ? 1.3 : 1 });
      const events = this.wildlife.update(dt, {
        x: this.player.pos.x,
        z: this.player.pos.z,
        running: this.player.running,
        visible: this.mode === 'play',
      });
      for (const e of events) if (e.state === 'flee') this.audio.animalAlarm(Math.hypot(e.animal.pos.x - this.player.pos.x, e.animal.pos.z - this.player.pos.z));
    }

    this.updateWorldVisuals(dt);

    if (this.mode === 'play') {
      this.follow.update(dt, this.player.rig.root.position);
      const target = this.interactions.update(this.player.pos, this.player.heading);
      this.ui.setPrompt(target ? target.prompt : '');
      this.updateHud();
      this._saveTimer = (this._saveTimer || 0) + dt;
      if (this._saveTimer > AUTOSAVE) {
        this._saveTimer = 0;
        this.save();
      }
    } else if (this.mode === 'title') {
      this.updateTitleCamera(dt);
    }

    if (this.debug) this.updateDebug();
    this.renderer.render(this.scene, this.camera);
  }

  updateTitleCamera(dt) {
    this._titleT = (this._titleT || 0) + dt;
    const a = 2.1 + this._titleT * 0.03;
    const r = 118;
    this.camera.position.set(Math.cos(a) * r, 42, Math.sin(a) * r);
    this.camera.lookAt(0, 4, 0);
  }

  updateWorldVisuals(dt) {
    const p = this.mode === 'title' ? this.camera.position : this.player.pos;
    const w = this.weather;
    const cave = this.props.cave;
    const caveDist = Math.hypot(this.player.pos.x - cave.x, this.player.pos.z - cave.z);
    const interior = this.mode === 'play' ? 1 - smoothstep(cave.radius - 1.5, cave.radius + 1, caveDist) : 0;
    const focus = this.mode === 'title' ? { x: 0, y: 0, z: 0 } : this.player.pos;
    this.sky.update(this.timeOfDay, focus, w.cloud, interior);

    const sky = this.sky;
    const ou = this.ocean.uniforms;
    this.ocean.update(this.time);
    ou.uSunDir.value.copy(sky.sunDir);
    ou.uSunColor.value.copy(sky.uniforms.uSunColor.value);
    ou.uFogColor.value.copy(sky.fogColor);
    ou.uFogNear.value = this.scene.fog.near;
    ou.uFogFar.value = this.scene.fog.far;
    ou.uSkyTint.value.copy(sky.uniforms.uHorizon.value);
    ou.uLight.value = sky.light;
    ou.uWaveScale.value = (1 + w.cloud * 0.6 + w.rain * 0.5) * (this.settings.reducedMotion ? 0.6 : 1);

    this.terrainMesh.uniforms.uWetness.value = w.wetness;
    this.grass.uniforms.uTime.value = this.time;
    this.grass.uniforms.uWind.value = (1 + w.cloud * 0.8 + w.rain) * (this.settings.reducedMotion ? 0.4 : 1);
    this.water.update(this.time, w, sky, this.scene.fog.far);
    this.rain.update(dt, this.camera.position, w.rain);
    this.collectibles.update(this.time);

    // Trail texture + grass instances near the player (throttled).
    this._trailTimer = (this._trailTimer || 0) + dt;
    if (this._trailTimer > 0.1 && this.trail.dirty) {
      this._trailTimer = 0;
      const v = this.trail.values;
      const out = this.trailTexData;
      for (let i = 0; i < v.length; i++) out[i] = v[i] * 255;
      this.trailTex.needsUpdate = true;
      this.trail.dirty = false;
      this.grass.refreshAround(p.x, p.z, 26);
    }

    // Night lights.
    const night = sky.night;
    this.props.lampGlow.color.setRGB(0.45 + night * 0.55, 0.35 + night * 0.48, 0.2 + night * 0.34);
    const b = this.props.beacon;
    b.beam.rotation.y = this.time * 0.6;
    b.beamMat.opacity = 0.03 + night * 0.22 + w.cloud * 0.04;
    b.light.intensity = 5 + night * 40;
    b.lanternMat.color.setRGB(0.8 + night * 0.2, 0.75 + night * 0.2, 0.55 + night * 0.2);
    this.props.cave.light.intensity = 4 + interior * 6;

    // Ambience mix.
    if (this.audio.ctx) {
      const pp = this.player.pos;
      const r = Math.hypot(pp.x, pp.z);
      const region = this.terrain.regionAt(pp.x, pp.z);
      this.audio.updateAmbience({
        coast: this.mode === 'title' ? 0.6 : smoothstep(45, 78, r),
        forest: region === 'forest' ? 1 : 0.15,
        cave: interior,
        lighthouse: 1 - smoothstep(10, 26, Math.hypot(pp.x - this.terrain.layout.lighthouse.x, pp.z - this.terrain.layout.lighthouse.z)),
        rain: w.rain * (1 - interior * 0.6),
        wind: Math.min(1, Math.max(0, pp.y / 22)) + w.cloud * 0.3,
        night: night > 0.6,
      }, dt);
    }
  }

  updateHud() {
    const p = this.player.pos;
    const region = this.terrain.regionAt(p.x, p.z);
    this.ui.setRegion(REGION_NAMES[region] || '');
    const w = this.weather;
    const sky = w.rain > 0.3 ? 'Rain' : w.cloud > 0.45 ? 'Overcast' : 'Clear';
    const hour = Math.floor(this.timeOfDay * 24);
    const tod = hour < 5 || hour >= 21 ? 'Night' : hour < 8 ? 'Dawn' : hour < 17 ? 'Day' : 'Dusk';
    this.ui.setWeather(`${tod} · ${sky}`);

    // Light-touch tutorial, driven by what the player has actually done.
    this._moved = (this._moved || 0) + Math.hypot(p.x - (this._lastHintX ?? p.x), p.z - (this._lastHintZ ?? p.z));
    this._lastHintX = p.x;
    this._lastHintZ = p.z;
    if (this.hintStage === 0) {
      this.ui.setHint(this.ui.isTouch ? 'Drag to look around' : 'WASD to walk · Shift to run · Click the view to look around');
      if (this._moved > 6) this.hintStage = 1;
    } else if (this.hintStage === 1) {
      this.ui.setHint('Something glints on the sand nearby — walk up to it and press E');
    } else if (this.hintStage === 3) {
      this.ui.setHint('Walk through the long grass and look back — the island remembers');
      this._hintTimer = (this._hintTimer || 0) + 1 / 60;
      if (this._hintTimer > 8) this.hintStage = 4;
    } else this.ui.setHint('');
  }

  updateDebug() {
    this._dbgTimer = (this._dbgTimer || 0) + 1;
    if (this._dbgTimer % 10) return;
    this.wildlifeOverlay.update(this.terrain);
    const s = this.diag.stats();
    const p = this.player.pos;
    const w = this.weather.snapshot();
    const f = (v, n = 2) => v.toFixed(n);
    this.ui.setDebugText([
      `fps ${f(s.fps, 0)}  avg ${f(s.avgMs, 1)}ms  worst ${f(s.worstMs, 1)}ms`,
      `draw calls ${s.calls}  tris ${(s.triangles / 1000).toFixed(0)}k`,
      `geometries ${s.geometries}  textures ${s.textures}  programs ${s.programs}`,
      `seed "${this.seed}"  quality ${this.settings.quality}`,
      `pos ${f(p.x, 1)}, ${f(p.y, 1)}, ${f(p.z, 1)}  ${this.terrain.regionAt(p.x, p.z)}/${this.player.surface}`,
      `player ${this.player.state}  grounded ${this.player.grounded}`,
      `weather ${w.state} cloud ${f(w.cloud)} rain ${f(w.rain)}`,
      `runoff ${f(w.runoff)} pools ${f(w.pool)} wet ${f(w.wetness)}`,
      `trail active cells ${this.trail.activeCount}  here ${f(this.trail.valueAt(p.x, p.z))}`,
      `wildlife active ${this.wildlife.activeCount}/${this.wildlife.animals.filter((a) => a.enabled !== false).length} @20Hz`,
      ...this.wildlife.animals.filter((a) => a.enabled !== false).map((a) => `  ${a.id} ${a.brain.state.padEnd(7)} d=${f(Math.hypot(a.pos.x - p.x, a.pos.z - p.z), 1)}`),
      `time of day ${f(this.timeOfDay * 24, 1)}h`,
    ].join('\n'));
    this.ui.refreshDebugButtons(this.debugButtons);
  }

  /** Small read-only hooks used by the browser smoke test and for poking around in devtools. */
  exposeHooks() {
    const game = this;
    window.__WILDLANDS__ = {
      get mode() { return game.mode; },
      state() {
        const p = game.player.pos;
        return {
          mode: game.mode,
          audioStarted: !!game.audio.ctx,
          seed: game.seed,
          player: { x: p.x, y: p.y, z: p.z, state: game.player.state, grounded: game.player.grounded },
          region: game.terrain.regionAt(p.x, p.z),
          trailActive: game.trail.activeCount,
          trailHere: game.trail.valueAt(p.x, p.z),
          weather: game.weather.snapshot(),
          wildlife: game.wildlife.animals.map((a) => a.brain.state),
          discovered: [...game.progress.discovered],
          collected: [...game.progress.collected],
          prompt: game.interactions.active?.prompt || null,
          stats: game.diag.stats(),
        };
      },
      setWeather: (s) => game.weather.setState(s),
      setTime: (t) => (game.timeOfDay = t),
      teleport: (x, z, heading = 0) => {
        game.player.spawn(x, z, heading);
        game.trail.lastX = null;
        game.follow.snap();
      },
      setCamera: (yaw, pitch, dist) => {
        game.follow.yaw = yaw;
        if (pitch !== undefined) game.follow.pitch = pitch;
        if (dist !== undefined) game.follow.targetDistance = game.follow.distance = dist;
        game.follow.snap();
      },
      layout: () => ({ ...game.terrain.layout, data: { ...game.props.data, trees: undefined, rocks: undefined } }),
      debug: (on) => game.toggleDebug(on),
      debugView: (m) => (game.terrainMesh.uniforms.uDebugMode.value = m),
    };
  }

  dispose() {
    for (const [t, type, fn, opts] of this._listeners) t.removeEventListener(type, fn, opts);
    this.input.dispose();
    this.grass.dispose();
    this.rain.dispose();
    this.water.dispose();
    this.wildlife.dispose();
    this.collectibles.dispose();
    this.ocean.dispose();
    this.props.dispose();
    this.terrainMesh.mesh.geometry.dispose();
    this.terrainMesh.mesh.material.dispose();
    this.trailTex.dispose();
    this.audio.dispose();
    this.renderer.dispose();
  }
}
