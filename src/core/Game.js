import * as THREE from 'three';
import { configKey } from '../procedural/terrain.js';
import { placeGrass } from '../procedural/placement.js';
import { smoothstep } from '../procedural/math.js';
import { buildTerrainMesh } from '../world/terrainMesh.js';
import { createOcean } from '../world/ocean.js';
import { createSky } from '../world/sky.js';
import { buildProps } from '../world/props.js';
import { buildCrossing } from '../world/crossing.js';
import { CollisionWorld } from '../player/collision.js';
import { Player } from '../player/Player.js';
import { ThirdPersonCamera } from '../player/camera.js';
import { TrailGrid } from '../simulation/trailGrid.js';
import { createGrass } from '../simulation/grass.js';
import { WeatherSim } from '../simulation/weather.js';
import { createWater } from '../simulation/water.js';
import { createRain } from '../simulation/rain.js';
import { Wildlife } from '../simulation/wildlife.js';
import { SeasonField, FIELD_SEASONS } from '../simulation/seasonField.js';
import { PuzzleSet } from '../simulation/puzzles.js';
import { createParticles } from '../simulation/particles.js';
import { InteractionRegistry } from '../interaction/registry.js';
import { DISCOVERIES } from '../interaction/discoveries.js';
import { createCollectibles } from '../interaction/collectibles.js';
import { AudioManager } from '../systems/audio.js';
import { SaveStore, DEFAULT_SETTINGS, sanitizeSettings } from '../systems/save.js';
import { getPreset, suggestQuality } from '../systems/quality.js';
import { Diagnostics, createWildlifeOverlay, createPlacementOverlay } from '../systems/diagnostics.js';
import { LEVELS, SEASON_INFO } from '../levels/levels.js';
import { planLevel } from '../levels/levelWorld.js';
import { Progression } from '../levels/progress.js';
import { updateSeasonUniforms, seasonUniforms } from '../shaders/season.js';
import { installHeightFog } from '../shaders/fog.js';
import { PostStack } from './post.js';
import { Input } from './input.js';
import { UI } from '../ui/ui.js';

const STEP = 1 / 60; // fixed simulation step
const MAX_FRAME = 0.1; // cap: a long stall never becomes a giant jump
const DAY_LENGTH = 600; // seconds for a full day/night cycle
const AUTOSAVE = 10;

const REGION_NAMES = {
  cove: 'Starting Cove', village: 'Village', forest: 'Forest', ridge: 'Central Ridge', wetland: 'Wetland',
  lighthouse: 'Lighthouse Point', cave: 'Hidden Hollow', meadow: 'Meadow', beach: 'Shore', sea: 'Shallows', shrine: 'Shrine Islet',
};

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export class Game {
  constructor(container, uiRoot) {
    this.container = container;
    const params = new URLSearchParams(location.search);
    this.params = params;
    this.debugAllowed = true;
    this.debug = params.has('debug');
    this.mode = 'loading';
    this.time = 0;
    this.timeOfDay = 0.66;
    this.progress = { discovered: new Set(), collected: new Set() };
    this.hintStage = 0;
    this._listeners = [];
    this.field = new SeasonField({ radius: 8.5 });
    this.preferredSeason = null;

    this.ui = new UI(uiRoot, {
      onAction: (a, arg) => this.onAction(a, arg),
      onSetting: (k, v) => this.setSetting(k, v),
    });
  }

  async init() {
    const ui = this.ui;
    installHeightFog();
    ui.loadingStatus('Charting the archipelago…');
    await nextFrame();
    this.store = new SaveStore();
    const peek = this.store.load('');
    this.progression = new Progression(peek?.progression || null);
    this.levelData = peek?.levels || {};
    let level = peek?.level ?? 0;
    const lp = Number(this.params.get('level'));
    if (Number.isInteger(lp) && lp >= 1 && lp <= LEVELS.length) level = lp - 1;
    if (!this.progression.isUnlocked(level) && !this.params.has('level')) level = 0;
    this.settings = sanitizeSettings(peek?.settings || { ...DEFAULT_SETTINGS, quality: suggestQuality() });
    const qParam = this.params.get('quality');
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
    renderer.info.autoReset = false; // the post stack renders several passes; reset once per frame
    this.container.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', 'WILDLANDS game view');
    this.renderer = renderer;
    this._on(renderer.domElement, 'webglcontextlost', (e) => {
      e.preventDefault();
      this.ui.fatal('The graphics context was lost. Reload the page to continue.');
    });
    this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1500);
    this.input = new Input(renderer.domElement);
    this.input.onLockChange = (locked) => {
      if (!locked && this.mode === 'play') this.setMode('paused');
    };
    this.audio = new AudioManager(this.settings);
    this.diag = new Diagnostics(renderer);

    await this.buildWorld(level, true);
    this.post = new PostStack(renderer, this.scene, this.camera);
    ui.syncSettings(this.settings);
    this.applyQuality();

    this._on(window, 'resize', () => this.resize());
    this._on(document, 'visibilitychange', () => this.onVisibility());
    this._on(window, 'pagehide', () => this.save());

    this.updateTitleCamera(0);
    this.sky.update(this.timeOfDay, this.camera.position, 0, 0);
    renderer.compile(this.scene, this.camera);
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

  // ---------------------------------------------------------------- world
  /** Build everything that belongs to one island. Renderer, input, audio and UI persist. */
  async buildWorld(index, first = false) {
    const ui = this.ui;
    const step = async (text) => {
      if (first) ui.loadingStatus(text);
      await nextFrame();
    };
    this.levelIndex = index;
    this.level = LEVELS[index];
    await step(`Shaping ${this.level.name}…`);
    const plan = planLevel(index);
    this.plan = plan;
    this.terrain = plan.terrain;
    this.seed = this.level.seed;
    this.worldKey = configKey(this.terrain.config);
    const saved = this.store.load(this.worldKey);
    const sameLevel = saved && saved.level === index;

    const scene = new THREE.Scene();
    this.scene = scene;
    this.sky = createSky(scene, this.quality);

    await step('Raising the ridge…');
    this.terrainMesh = buildTerrainMesh(this.terrain, this.seed);
    scene.add(this.terrainMesh.mesh);
    this.ocean = createOcean(this.terrain, this.quality.oceanSegments);
    scene.add(this.ocean.mesh);

    await step('Planting the forest…');
    this.collisions = new CollisionWorld(8);
    this.props = buildProps({ scene, terrain: this.terrain, collisions: this.collisions, seed: this.seed, quality: this.quality });

    this.trail = new TrailGrid({ size: this.terrain.grid.size, cellSize: 0.75, surfaceAt: (x, z) => this.terrain.groundTypeAt(x, z) });
    this.trailTexData = new Uint8Array(this.trail.res * this.trail.res);
    this.trailTex = new THREE.DataTexture(this.trailTexData, this.trail.res, this.trail.res, THREE.RedFormat, THREE.UnsignedByteType);
    this.trailTex.magFilter = THREE.LinearFilter;
    this.trailTex.minFilter = THREE.LinearFilter;
    this.trailTex.needsUpdate = true;
    this.terrainMesh.uniforms.uTrail.value = this.trailTex;
    this.terrainMesh.uniforms.uTrailSize.value = this.terrain.grid.size;
    const grassPositions = placeGrass(this.terrain, this.terrain.config.vegetationSeed || `${this.seed}:veg`, 48000);
    this.grass = createGrass({ positions: grassPositions, maxCount: this.quality.grassCount, trail: this.trail, scene });

    await step('Filling the streams…');
    this.weather = new WeatherSim(this.seed);
    this.water = createWater({ scene, terrain: this.terrain, seed: this.seed });
    this.rain = createRain(scene, 2400);
    this.rain.setCount(this.quality.rainCount);
    this.wildlife = new Wildlife({ scene, terrain: this.terrain, collisions: this.collisions, seed: this.seed, count: 4 });
    this.wildlife.setCount(this.quality.maxAnimals);
    this.particles = createParticles(scene, 1600);
    this.particles.setLimit(this.quality.particles);

    await step('Waking the old stones…');
    this.puzzles = new PuzzleSet(plan.segments, this.progression.puzzles[index] || []);
    this.crossing = buildCrossing({
      scene,
      collisions: this.collisions,
      terrain: this.terrain,
      plan,
      puzzles: this.puzzles,
      props: this.props,
      time: () => this.time,
      trailFactory: (o) => new TrailGrid({ size: this.terrain.grid.size, budget: 3000, ...o }),
    });
    this.crossing.shrine.awake = this.progression.completed.has(index);
    if (this.crossing.ember) this.crossing.ember.taken = this.progression.embers.has(index);
    if (this.crossing.lantern) this.crossing.lantern.taken = this.progression.lantern;
    // Jumping straight to a later island still hands you the lantern.
    if (index > 0) this.progression.lantern = true;

    // Player, camera.
    this.player = new Player({ scene, terrain: this.terrain, collisions: this.collisions });
    this.player.extraSurface = this.crossing.ice ? (x, z) => this.crossing.ice.surfaceAt(x, z) : null;
    this.player.rig.lantern.visible = this.progression.lantern;
    const start = this.terrain.layout.start;
    this.player.spawn(start.x, start.z, start.heading);
    this.safePos = { x: start.x, z: start.z, heading: start.heading };
    this.follow = new ThirdPersonCamera(this.camera, this.terrain);
    this.follow.obstacles = this.props.meshes.filter((m) => !m.isInstancedMesh || /trees/.test(m.name));
    this.follow.obstacles.push(this.terrainMesh.mesh);
    this.follow.sensitivity = this.settings.sensitivity;
    this.follow.invertY = this.settings.invertY;
    this.player.onStep = (s) => this.audio.footstep(s);
    this.player.onJump = () => this.audio.jump();
    this.player.onLand = (impact) => {
      if (impact > 4) this.audio.footstep(this.player.surface);
    };

    this.collectibles = createCollectibles(scene, this.terrain);
    this.progress = { discovered: new Set(), collected: new Set() };
    this.setupInteractions();

    this.wildlifeOverlay = createWildlifeOverlay(scene, this.wildlife);
    this.placementOverlay = createPlacementOverlay(scene, this.props.data, this.collectibles.items);
    this.setupDebugButtons();

    this.restore(sameLevel ? saved : null);
    this.updateCounter();
    this.field.select(null);
    this.field.intensity = 0;
    this.field.radius = 0;
    this.post?.setScene(scene, this.camera);
    if (!first) {
      this.applyQuality();
      this.renderer.compile(scene, this.camera);
    }
  }

  disposeWorld() {
    const scene = this.scene;
    this.grass.dispose();
    this.rain.dispose();
    this.water.dispose();
    this.wildlife.dispose();
    this.collectibles.dispose();
    this.crossing.dispose();
    this.particles.dispose();
    this.ocean.dispose();
    this.props.dispose();
    this.trailTex.dispose();
    // Anything left over (terrain, sky, player rig, overlays).
    scene.traverse((o) => {
      o.geometry?.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const m of mats) m.dispose();
    });
    this.sky.sun.shadow.map?.dispose();
    scene.clear();
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
    // Season pieces first so they win ties with notebook spots nearby.
    const c = this.crossing;
    if (c.lantern) {
      reg.register({
        id: 'lantern',
        prompt: 'Pick up the lantern',
        radius: 2.2,
        getPosition: () => c.lantern.pos,
        canInteract: () => !c.lantern.taken,
        onInteract: () => this.takeLantern(),
      });
    }
    if (c.ember) {
      const info = SEASON_INFO[this.level.season];
      reg.register({
        id: 'ember',
        prompt: `Take the ${info.label} ember`,
        radius: 2.4,
        getPosition: () => c.ember.pos,
        canInteract: () => !c.ember.taken,
        onInteract: () => this.takeEmber(),
      });
    }
    reg.register({
      id: 'shrine',
      prompt: 'Awaken the shrine',
      radius: 3.8,
      getPosition: () => c.shrine.pos,
      canInteract: () => !c.shrine.awake,
      onInteract: () => this.awakenShrine(),
    });
    reg.register({
      id: 'boat',
      prompt: 'Sail to another island',
      radius: 3.4,
      getPosition: () => ({ x: c.boat.home.x - 1.6, y: this.props.data.dockEnd.y, z: c.boat.home.z }),
      canInteract: () => c.boat.visible,
      onInteract: () => this.setMode('map'),
    });

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
        return !!n && n.animal.brain.state !== 'flee' && n.distance > 2;
      },
      onInteract: () => this.discover(hare),
    });
    for (const item of this.collectibles.items) {
      reg.register({
        id: `item:${item.id}`,
        prompt: `Pick up ${item.name}`,
        radius: 1.9,
        getPosition: () => item,
        canInteract: () => !item.collected,
        onInteract: () => this.collect(item),
      });
    }
  }

  takeLantern() {
    this.player.interact();
    this.crossing.lantern.taken = true;
    this.progression.lantern = true;
    this.player.rig.lantern.visible = true;
    this.audio.discover();
    this.ui.card('Found', 'The Seasonkeeper\'s lantern', 'The glass is cold and empty. Somewhere on this island an ember still remembers spring - the old violet tree in the forest, maybe.');
    this.save();
  }

  takeEmber() {
    const info = SEASON_INFO[this.level.season];
    this.player.interact();
    this.crossing.ember.taken = true;
    this.progression.findEmber(this.levelIndex);
    if (!this.progression.lantern) {
      this.progression.lantern = true;
      this.player.rig.lantern.visible = true;
    }
    this.selectSeason(this.level.season);
    this.audio.discover();
    this.ui.card(`${info.label} ember`, `The lantern burns ${info.label.toLowerCase()}`, `Its light ${info.verb}. Press ${info.key} (or Q to cycle) to choose a season and F to dim it.`);
    this.save();
  }

  awakenShrine() {
    const L = this.level;
    if (L.season && !this.progression.embers.has(this.levelIndex)) {
      this.ui.card('Dormant', `Shrine of ${L.name}`, `The stones are cold. It wants the ${SEASON_INFO[L.season].label.toLowerCase()} ember - ${L.emberHint.toLowerCase()}.`);
      this.audio.ui('close');
      return;
    }
    this.player.interact();
    this.crossing.shrine.awake = true;
    this.progression.complete(this.levelIndex);
    this.crossing.boat.visible = true;
    this.audio.discover();
    const next = LEVELS[this.levelIndex + 1];
    if (next) this.ui.card('Shrine awakened', `${L.name} remembers`, `Far across the water a light wakes on ${next.name}. A boat is waiting at the dock - press E there, or M for the map.`);
    else this.ui.card('The last shrine', 'Stormpeak remembers', 'Four seasons turn together and the long summer finally breaks. Every island is awake. You can still sail between them - the map is on M.');
    this.save();
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
    this.save();
  }

  updateCounter() {
    const total = DISCOVERIES.length + this.collectibles.items.length;
    this.ui.setCount(this.progress.discovered.size + this.progress.collected.size, total);
  }

  // ---------------------------------------------------------------- seasons
  availableSeasons() {
    return this.progression.lantern ? this.progression.seasons(this.levelIndex) : [];
  }

  selectSeason(season) {
    const avail = this.availableSeasons();
    if (season && !avail.includes(season)) {
      if (!this.progression.lantern) this.ui.toast('No lantern', 'There is nothing to light yet.');
      else this.ui.toast('Not yet', `You haven't found the ${SEASON_INFO[season].label.toLowerCase()} ember.`);
      return false;
    }
    if (season === this.field.season && this.field.lit) return true;
    this.field.select(season);
    this.preferredSeason = season || this.preferredSeason;
    if (season) this.audio.ui('open');
    return true;
  }

  cycleSeason() {
    const avail = this.availableSeasons();
    if (!avail.length) return this.selectSeason('spring');
    const cur = this.field.lit ? avail.indexOf(this.field.season) : -1;
    return this.selectSeason(avail[(cur + 1) % avail.length]);
  }

  toggleLantern() {
    if (this.field.lit) {
      this.field.select(null);
      this.audio.ui('close');
    } else {
      const avail = this.availableSeasons();
      const pick = avail.includes(this.preferredSeason) ? this.preferredSeason : avail[avail.length - 1];
      if (pick) this.selectSeason(pick);
      else this.selectSeason('spring');
    }
  }

  // ---------------------------------------------------------------- persistence
  restore(saved) {
    const per = this.levelData[this.levelIndex];
    if (per) {
      for (const id of per.discovered) if (DISCOVERIES.some((d) => d.id === id)) this.progress.discovered.add(id);
      for (const id of per.collected) {
        if (this.collectibles.items.some((c) => c.id === id)) {
          this.progress.collected.add(id);
          this.collectibles.markCollected(id);
        }
      }
    }
    this.crossing.boat.visible = this.progression.completed.has(this.levelIndex) || this.progression.unlocked.size > 1;
    if (!saved) return;
    if (saved.timeOfDay !== null) this.timeOfDay = saved.timeOfDay;
    if (saved.trail && this.trail.deserialize(saved.trail)) this.grass.refreshAll();
    if (saved.player && saved.player.y > -0.5) {
      this.player.spawn(saved.player.x, saved.player.z, saved.player.heading, saved.player.y);
      this.safePos = { x: saved.player.x, z: saved.player.z, heading: saved.player.heading };
      this.hintStage = 3;
    }
  }

  snapshotLevel() {
    this.levelData[this.levelIndex] = { discovered: [...this.progress.discovered], collected: [...this.progress.collected] };
    this.progression.setPuzzles(this.levelIndex, this.puzzles.solvedIds());
  }

  save() {
    if (!this.store || this.mode === 'loading' || this.mode === 'travel') return;
    this.snapshotLevel();
    const p = this.player.onIce ? { x: this.safePos.x, y: this.terrain.heightAt(this.safePos.x, this.safePos.z), z: this.safePos.z, heading: this.player.heading } : { x: this.player.pos.x, y: this.player.pos.y, z: this.player.pos.z, heading: this.player.heading };
    this.store.save({
      seed: this.seed,
      worldKey: this.worldKey,
      settings: this.settings,
      level: this.levelIndex,
      progression: this.progression.toJSON(),
      levels: this.levelData,
      discovered: [...this.progress.discovered],
      collected: [...this.progress.collected],
      player: p,
      timeOfDay: this.timeOfDay,
      trail: this.trail.serialize(),
    });
  }

  async resetProgress() {
    this.store.clear();
    this.progression = new Progression();
    this.levelData = {};
    this.field.select(null);
    this.ui.toast('Progress reset', 'The archipelago has forgotten you.');
    await this.travel(0, { instant: true });
    this.hintStage = 0;
    this.timeOfDay = 0.66;
    this.store.save({ seed: this.seed, worldKey: this.worldKey, settings: this.settings, level: 0, progression: this.progression.toJSON(), levels: {}, discovered: [], collected: [], player: null, timeOfDay: this.timeOfDay, trail: null });
  }

  // ---------------------------------------------------------------- travel
  /** Sail to another island: boat leaves, world is rebuilt behind a fade, boat arrives. */
  async travel(index, { instant = false } = {}) {
    if (this._travelling) return;
    this._travelling = true;
    const L = LEVELS[index];
    const prevMode = this.mode;
    if (!instant) {
      this.save();
      this.setMode('travel');
      this.cinematic = { kind: 'depart', t: 0, dur: 2.6 };
      this.crossing.boat.visible = true;
      this.crossing.boat.sailing = true;
      this.player.rig.root.visible = false;
      await wait(1400);
      this.ui.fade(true, `Sailing to ${L.name}…`);
      await wait(1100);
    } else {
      this.mode = 'travel';
    }
    this.cinematic = null;
    this.disposeWorld();
    await this.buildWorld(index);
    this.save();
    if (!instant) {
      this.cinematic = { kind: 'arrive', t: 0, dur: 3.2 };
      this.crossing.boat.visible = true;
      this.crossing.boat.sailing = true;
      this.player.rig.root.visible = false;
      this.updateCinematic(0);
      await wait(250);
      this.ui.fade(false);
      await wait(3000);
      this.cinematic = null;
      this.crossing.boat.sailing = false;
      this.player.rig.root.visible = true;
      const de = this.props.data.dockEnd;
      this.player.spawn(de.x - 0.6, de.z - 1, Math.PI);
      this.trail.lastX = null;
      this.follow.yaw = 0; // camera behind the player, looking up the dock at the island
      this.follow.snap();
      this._travelling = false;
      this.setMode('play');
      this.ui.card(this.level.season ? `Island ${index + 1} · ${SEASON_INFO[this.level.season].label}` : `Island ${index + 1} · All seasons`, this.level.name, this.level.intro);
      this.input.requestLock();
    } else {
      this._travelling = false;
      this.mode = prevMode === 'travel' ? 'play' : prevMode;
      this.setMode(this.mode === 'loading' ? 'title' : this.mode);
      this.follow.snap();
    }
  }

  updateCinematic(dt) {
    const c = this.cinematic;
    if (!c) return;
    c.t += dt;
    const b = this.crossing.boat;
    const h = b.home;
    const k = Math.min(1, c.t / c.dur);
    const ease = k * k * (3 - 2 * k);
    // The dock runs towards +z, out to sea.
    const off = c.kind === 'depart' ? ease * 34 : (1 - ease) * 34;
    b.group.position.set(h.x + Math.sin(off * 0.05) * 3, Math.sin(this.time * 1.4) * 0.12, h.z + off);
    b.group.rotation.set(Math.sin(this.time * 1.1) * 0.05, 0, Math.sin(this.time * 0.9) * 0.06);
    const bp = b.group.position;
    this.camera.position.set(bp.x - 14, 7 + ease * 3, bp.z - 12 + (c.kind === 'depart' ? -ease * 6 : ease * 2));
    this.camera.lookAt(bp.x, 1.5, bp.z + 2);
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
    this.particles.setLimit(q.particles);
    this.props.flowerMesh.count = Math.min(this.props.data.flowerCount ?? 900, q.flowers);
    this.wildlife.setCount(q.maxAnimals);
    this.player.rig.light.castShadow = false;
    this.post?.configure(q);
    this.scene.traverse((o) => {
      if (o.material) o.material.needsUpdate = true;
    });
    this.follow.sensitivity = this.settings.sensitivity;
    this.follow.invertY = this.settings.invertY;
    this.resize();
  }

  // ---------------------------------------------------------------- modes
  async onAction(a, arg) {
    switch (a) {
      case 'start':
        await this.audio.start();
        this.audio.ui('open');
        this.follow.easeFrom(this.camera.position);
        this.setMode('play');
        this.input.requestLock();
        if (!this._introShown) {
          this._introShown = true;
          this.ui.card(this.level.season ? `Island ${this.levelIndex + 1} · ${SEASON_INFO[this.level.season].label}` : `Island ${this.levelIndex + 1}`, this.level.name, this.level.intro);
        }
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
      case 'close-map':
        this.audio.ui('close');
        this.setMode('play');
        break;
      case 'sail':
        if (this.progression.isUnlocked(arg) && arg !== this.levelIndex) this.travel(arg);
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
    this.ui.showMap(mode === 'map', this.mapLevels());
    this.input.enabled = mode === 'play';
    if (mode === 'map') this.ui.hideCard();
    if (mode !== 'play') {
      this.input.releaseLock();
      this.ui.setPrompt('');
    }
    if ((mode === 'notebook' || mode === 'map') && prev === 'play') this.audio.ui('open');
    this.audio.setPaused(mode === 'paused' || mode === 'notebook' || mode === 'map');
    if (mode === 'play') this.input.down.clear();
    if (mode === 'title' && this.audio.ctx) this.audio.setPaused(false);
    if (prev === 'play' && mode !== 'play') this.save();
  }

  mapLevels() {
    if (!this.progression) return [];
    return LEVELS.map((l, i) => ({
      index: i,
      name: l.name,
      season: l.season ? SEASON_INFO[l.season].label : null,
      color: l.season ? SEASON_INFO[l.season].color : '#ffffff',
      unlocked: this.progression.isUnlocked(i),
      completed: this.progression.completed.has(i),
      current: i === this.levelIndex,
    }));
  }

  onVisibility() {
    if (document.hidden) {
      if (this.mode === 'play') this.setMode('paused');
      this.audio.setPaused(true);
      this.save();
    } else {
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
    this.post?.setSize(w, h, this.renderer.getPixelRatio());
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
      { label: 'Rain', onClick: () => this.weather.setState('rain'), isOn: () => this.weather.state === 'rain' },
      { label: 'Auto weather', onClick: () => (this.weather.auto = !this.weather.auto), isOn: () => this.weather.auto },
      { label: '+3h', onClick: () => (this.timeOfDay = (this.timeOfDay + 0.125) % 1) },
      { label: 'All seasons', onClick: () => this.grantAll() },
    ];
    this.ui.setDebugButtons(this.debugButtons);
  }

  grantAll() {
    this.progression.lantern = true;
    this.player.rig.lantern.visible = true;
    for (let i = 0; i < LEVELS.length; i++) {
      this.progression.unlocked.add(i);
      if (LEVELS[i].season) this.progression.findEmber(i);
    }
  }

  // ---------------------------------------------------------------- loop
  loop() {
    requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), MAX_FRAME);
    this.diag.frame();
    this.renderer.info.reset();
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
    if (this._travelling && !this.cinematic) {
      // World is being rebuilt; keep the last frame on screen.
      this.input.endFrame();
      return;
    }
    const input = this.input;
    if (input.consume('debug')) this.toggleDebug();
    const simulating = this.mode === 'play' || this.mode === 'title' || this.mode === 'travel';

    if (this.mode === 'play') {
      if (input.consume('pause')) {
        this.setMode('paused');
      } else if (input.consume('notebook')) {
        this.setMode('notebook');
      } else if (input.consume('map')) {
        this.setMode('map');
      } else {
        if (input.consume('jump')) this._jumpQueued = true;
        if (input.consume('interact')) this.interactions.trigger();
        if (input.consume('season-next')) this.cycleSeason();
        if (input.consume('lantern')) this.toggleLantern();
        for (let i = 0; i < 4; i++) if (input.consume(`season-${i + 1}`)) this.selectSeason(FIELD_SEASONS[i]);
        this.follow.rotate(input.mouseDX, input.mouseDY);
        if (input.wheel) this.follow.zoom(input.wheel);
        const axis = input.axis();
        this.acc += dt;
        while (this.acc >= STEP) {
          this.acc -= STEP;
          this.player.step(STEP, { ...axis, jump: this._jumpQueued }, this.follow.yaw);
          this._jumpQueued = false;
          this.trackSafety();
        }
        this.player.render(this.acc / STEP, dt, this.settings.reducedMotion);
      }
    } else if (this.mode === 'notebook') {
      if (input.consume('notebook')) this.setMode('play');
    } else if (this.mode === 'map') {
      if (input.consume('map')) this.setMode('play');
    }
    input.endFrame();

    if (simulating) {
      this.time += dt;
      this.timeOfDay = (this.timeOfDay + dt / DAY_LENGTH) % 1;
      this.updateSeason(dt);
      this.weather.update(dt);
      this.trail.update(dt);
      if (this.mode === 'play') this.trail.step(this.player.pos.x, this.player.pos.z, { weight: this.player.running ? 1.3 : 1 });
      const lure = this.field.season === 'spring' && this.field.intensity > 0.5;
      const events = this.wildlife.update(dt, {
        x: this.player.pos.x,
        z: this.player.pos.z,
        running: this.player.running,
        visible: this.mode === 'play',
        lure,
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
    } else if (this.mode === 'travel') {
      this.updateCinematic(dt);
    }

    if (this.debug) this.updateDebug();
    this.post.render(this.scene, this.camera, dt);
  }

  /** Remember the last solid footing; fished out of the sea back to it. */
  trackSafety() {
    const p = this.player;
    if (p.grounded && !p.onIce && (p.onDeck || this.terrain.heightAt(p.pos.x, p.pos.z) > 0.15)) {
      this.safePos.x = p.pos.x;
      this.safePos.z = p.pos.z;
      this.safePos.heading = p.heading;
    }
    if (p.pos.y < -1.3) {
      p.spawn(this.safePos.x, this.safePos.z, this.safePos.heading);
      this.trail.lastX = null;
      this.follow.snap();
      this.audio.footstep('water');
      this.ui.toast('Brr', 'The water is far too cold to swim. Back to dry land.');
    }
  }

  updateSeason(dt) {
    const f = this.field;
    const p = this.player.pos;
    const head = this.player.heading;
    // The field is centred a little ahead of the player, where the lantern swings.
    f.setPosition(p.x + Math.sin(head) * 0.6, p.y + 1, p.z + Math.cos(head) * 0.6);
    f.update(dt);
    updateSeasonUniforms(f, this.time, this.player.rig.root.position);
    const solved = this.puzzles.update(dt, f);
    for (const el of solved) {
      this.audio.discover();
      const msg = { vine: ['Spring', 'The vines knot themselves into a bridge.'], hedge: ['Autumn', 'The thornwall sheds its leaves and falls slack.'], drawbridge: ['Storm', 'The windmill groans awake and the drawbridge comes down.'] }[el.type];
      this.ui.toast(msg[0], msg[1]);
      this.save();
    }
    this.crossing.update(dt, this.time, f);
    // Storm calls rain over the island; the v1 runoff fills the channels.
    const storm = f.season === 'storm' && f.intensity > 0.6;
    if (storm && this.weather.state !== 'rain') {
      this.weather.setState('rain');
      this._stormRain = true;
    } else if (!storm && this._stormRain && this.weather.state === 'rain') {
      this.weather.setState('cloudy');
      this._stormRain = false;
    }
  }

  updateTitleCamera(dt) {
    this._titleT = (this._titleT || 0) + dt;
    const a = 2.1 + this._titleT * 0.03;
    const r = 128;
    this.camera.position.set(Math.cos(a) * r, 46, Math.sin(a) * r);
    this.camera.lookAt(0, 4, 0);
  }

  updateWorldVisuals(dt) {
    const p = this.mode === 'title' ? this.camera.position : this.player.pos;
    const w = this.weather;
    const f = this.field;
    const cave = this.props.cave;
    const caveDist = Math.hypot(this.player.pos.x - cave.x, this.player.pos.z - cave.z);
    const interior = this.mode === 'play' ? 1 - smoothstep(cave.radius - 1.5, cave.radius + 1, caveDist) : 0;
    const focus = this.mode === 'title' ? { x: 0, y: 0, z: 0 } : this.mode === 'travel' ? this.crossing.boat.group.position : this.player.pos;
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
    const stormW = f.season === 'storm' ? f.intensity : 0;
    ou.uWaveScale.value = (1 + w.cloud * 0.6 + w.rain * 0.5 + stormW * 0.8) * (this.settings.reducedMotion ? 0.6 : 1);
    ou.uPlayer.value.set(this.player.pos.x, this.player.pos.y, this.player.pos.z);
    const wading = this.mode === 'play' && this.player.pos.y < 0.15 && !this.player.onIce && !this.player.onDeck;
    ou.uRipple.value += ((wading ? (this.player.state === 'idle' ? 0.4 : 1) : 0) - ou.uRipple.value) * Math.min(1, dt * 3);
    if (this.crossing.ice) {
      this.crossing.ice.uniforms.uSunDir.value.copy(sky.sunDir);
      this.crossing.ice.uniforms.uLight.value = sky.light;
    }

    this.terrainMesh.uniforms.uWetness.value = w.wetness;
    const wind = (1 + w.cloud * 0.8 + w.rain + stormW * 1.5) * (this.settings.reducedMotion ? 0.4 : 1);
    this.grass.uniforms.uTime.value = this.time;
    this.grass.uniforms.uWind.value = wind;
    seasonUniforms.uWindAmt.value = wind;
    this.water.update(this.time, w, sky, this.scene.fog.far);
    this.rain.update(dt, this.camera.position, w.rain);
    this.collectibles.update(this.time);
    this.crossing.boat.update(this.time, ou.uWaveScale.value);

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

    // Lantern glow follows the chosen season.
    const night = sky.night;
    const rig = this.player.rig;
    if (rig.lantern.visible) {
      const col = f.season ? SEASON_INFO[f.season].color : '#ffcf80';
      rig.light.color.set(col);
      rig.glassMat.color.set(col);
      const flick = 0.9 + Math.sin(this.time * 13) * 0.05 + Math.sin(this.time * 7.3) * 0.05;
      rig.light.intensity = (f.lit ? 2 + f.intensity * 4 : 0.6) * (1 + night * 1.5) * flick;
      rig.glassMat.opacity = 0.5 + f.intensity * 0.45;
      rig.flame.scale.setScalar(0.6 + f.intensity * 0.6);
    } else rig.light.intensity = 0;

    // Particles: fireflies at night and in the forest, season effects round the lantern.
    const region = this.terrain.regionAt(p.x, p.z);
    this.particles.update({
      dt,
      time: this.time,
      focus: p,
      field: this.mode === 'play' ? f : null,
      night,
      forest: region === 'forest',
      heightAt: (x, z) => this.terrain.heightAt(x, z),
      wind: { x: 0.6 * wind, z: 0.2 * wind },
      pixelScale: window.innerHeight * this.renderer.getPixelRatio() * 0.9,
    });
    for (const part of this.crossing.parts) {
      if (part.emitter) {
        const e = part.emitter();
        if (e.active && Math.random() < dt * 8) this.particles.burst?.('leaf', e.x, e.z);
      }
    }

    // Grade: a hint of the season's colour on screen while the lantern works.
    if (this.post) {
      const g = this.post.uniforms;
      const tint = f.season ? new THREE.Color(SEASON_INFO[f.season].color) : null;
      if (tint) g.uTint.value.lerp(tint, Math.min(1, dt * 3));
      g.uTintAmt.value += ((f.intensity * 0.12) - g.uTintAmt.value) * Math.min(1, dt * 3);
      g.uVignette.value = 0.3 + interior * 0.25 + stormW * 0.15;
      g.uSaturation.value = 1.08 - stormW * 0.25 + (f.season === 'spring' ? f.intensity * 0.08 : 0);
      this.post.bloom.strength = 0.32 + night * 0.35;
    }

    this.props.lampGlow.color.setRGB(0.45 + night * 0.55, 0.35 + night * 0.48, 0.2 + night * 0.34);
    const b = this.props.beacon;
    b.beam.rotation.y = this.time * 0.6;
    b.beamMat.opacity = 0.03 + night * 0.22 + w.cloud * 0.04;
    b.light.intensity = 5 + night * 40;
    b.lanternMat.color.setRGB(0.8 + night * 0.2, 0.75 + night * 0.2, 0.55 + night * 0.2);
    this.props.cave.light.intensity = 4 + interior * 6;

    if (this.audio.ctx) {
      const pp = this.player.pos;
      const r = Math.hypot(pp.x, pp.z);
      this.audio.updateAmbience({
        coast: this.mode === 'title' ? 0.6 : smoothstep(45, 78, r),
        forest: region === 'forest' ? 1 : 0.15,
        cave: interior,
        lighthouse: 1 - smoothstep(10, 26, Math.hypot(pp.x - this.terrain.layout.lighthouse.x, pp.z - this.terrain.layout.lighthouse.z)),
        rain: w.rain * (1 - interior * 0.6),
        wind: Math.min(1, Math.max(0, pp.y / 22)) + w.cloud * 0.3 + stormW * 0.5,
        night: night > 0.6,
      }, dt);
    }
  }

  updateHud() {
    const p = this.player.pos;
    const region = this.terrain.regionAt(p.x, p.z);
    this.ui.setRegion(`${this.level.name} · ${REGION_NAMES[region] || ''}`);
    const w = this.weather;
    const sky = w.rain > 0.3 ? 'Rain' : w.cloud > 0.45 ? 'Overcast' : 'Clear';
    const hour = Math.floor(this.timeOfDay * 24);
    const tod = hour < 5 || hour >= 21 ? 'Night' : hour < 8 ? 'Dawn' : hour < 17 ? 'Day' : 'Dusk';
    this.ui.setWeather(`${tod} · ${sky}`);

    if (Math.hypot(p.x - this.plan.shrine.x, p.z - this.plan.shrine.z) < 7) this.progression.reachedShrine.add(this.levelIndex);
    this.ui.setObjectives(`Island ${this.levelIndex + 1} · ${this.level.name}`, this.progression.objectives(this.levelIndex));
    const avail = this.availableSeasons();
    this.ui.setSeasons(
      FIELD_SEASONS.map((s) => ({ id: s, label: SEASON_INFO[s].label, color: SEASON_INFO[s].color, key: SEASON_INFO[s].key, available: avail.includes(s) })),
      this.field.season,
      this.field.lit,
    );

    this._moved = (this._moved || 0) + Math.hypot(p.x - (this._lastHintX ?? p.x), p.z - (this._lastHintZ ?? p.z));
    this._lastHintX = p.x;
    this._lastHintZ = p.z;
    if (this.hintStage === 0) {
      this.ui.setHint(this.ui.isTouch ? 'Drag to look around' : 'WASD to walk · Shift to run · Click the view to look around');
      if (this._moved > 6) this.hintStage = 1;
    } else if (this.hintStage === 1) {
      if (!this.progression.lantern) this.ui.setHint('Something glints at the end of the dock');
      else if (avail.length && !this.field.lit) this.ui.setHint('Press Q to light the lantern');
      else {
        this.ui.setHint('');
        this.hintStage = 3;
      }
    } else this.ui.setHint('');
  }

  updateDebug() {
    this._dbgTimer = (this._dbgTimer || 0) + 1;
    if (this._dbgTimer % 10) return;
    this.wildlifeOverlay.update(this.terrain);
    const s = this.diag.stats();
    const p = this.player.pos;
    const w = this.weather.snapshot();
    const fs = this.field.snapshot();
    const f = (v, n = 2) => v.toFixed(n);
    this.ui.setDebugText([
      `fps ${f(s.fps, 0)}  avg ${f(s.avgMs, 1)}ms  worst ${f(s.worstMs, 1)}ms`,
      `draw calls ${s.calls}  tris ${(s.triangles / 1000).toFixed(0)}k`,
      `geometries ${s.geometries}  textures ${s.textures}  programs ${s.programs}`,
      `island ${this.levelIndex + 1} "${this.level.name}"  quality ${this.settings.quality}`,
      `pos ${f(p.x, 1)}, ${f(p.y, 1)}, ${f(p.z, 1)}  ${this.terrain.regionAt(p.x, p.z)}/${this.player.surface}`,
      `player ${this.player.state}  grounded ${this.player.grounded}  ice ${this.player.onIce}`,
      `season ${fs.season || '-'} lit ${fs.lit} amt ${f(fs.intensity)} r ${f(fs.radius, 1)}`,
      ...this.puzzles.elements.map((e) => `  ${e.type.padEnd(10)} ${e.solved ? 'solved' : f(e.progress)} act ${f(e.activity)}`),
      `weather ${w.state} cloud ${f(w.cloud)} rain ${f(w.rain)}`,
      `trail active ${this.trail.activeCount}  frost active ${this.crossing.ice?.frost.activeCount ?? 0}`,
      `particles ${this.particles.count}`,
      `wildlife active ${this.wildlife.activeCount}`,
      ...this.wildlife.animals.filter((a) => a.enabled !== false).map((a) => `  ${a.id} ${a.brain.state.padEnd(7)}${a.brain.lured ? ' lured' : ''} d=${f(Math.hypot(a.pos.x - p.x, a.pos.z - p.z), 1)}`),
      `time of day ${f(this.timeOfDay * 24, 1)}h`,
    ].join('\n'));
    this.ui.refreshDebugButtons(this.debugButtons);
  }

  /** Small hooks used by the browser smoke test and for poking around in devtools. */
  exposeHooks() {
    const game = this;
    window.__WILDLANDS__ = {
      get mode() { return game.mode; },
      state() {
        const p = game.player.pos;
        return {
          mode: game.mode,
          level: game.levelIndex,
          levelName: game.level.name,
          audioStarted: !!game.audio.ctx,
          seed: game.seed,
          player: { x: p.x, y: p.y, z: p.z, state: game.player.state, grounded: game.player.grounded, onIce: game.player.onIce, onDeck: game.player.onDeck },
          region: game.terrain.regionAt(p.x, p.z),
          trailActive: game.trail.activeCount,
          trailHere: game.trail.valueAt(p.x, p.z),
          weather: game.weather.snapshot(),
          wildlife: game.wildlife.animals.map((a) => a.brain.state),
          lured: game.wildlife.animals.filter((a) => a.brain.lured).length,
          discovered: [...game.progress.discovered],
          collected: [...game.progress.collected],
          prompt: game.interactions.active?.prompt || null,
          field: game.field.snapshot(),
          seasons: game.availableSeasons(),
          puzzles: game.puzzles.elements.map((e) => ({ id: e.id, type: e.type, solved: e.solved, progress: e.progress })),
          frostHere: game.crossing.ice ? game.crossing.ice.frost.valueAt(p.x, p.z) : 0,
          objectives: game.progression.objectives(game.levelIndex),
          progression: game.progression.toJSON(),
          shrineAwake: game.crossing.shrine.awake,
          boatVisible: game.crossing.boat.visible,
          particles: game.particles.count,
          travelling: !!game._travelling,
          stats: game.diag.stats(),
        };
      },
      plan: () => ({
        segments: game.plan.segments.map((s) => ({ id: s.id, type: s.type, a: s.a, b: s.b, anchor: game.puzzles.get(s.id).anchor })),
        shrine: game.plan.shrine,
        nodes: game.plan.nodes,
        ember: game.crossing.ember?.pos || null,
        lantern: game.crossing.lantern?.pos || null,
        dockEnd: game.props.data.dockEnd,
        boat: game.crossing.boat.home,
      }),
      setWeather: (s) => game.weather.setState(s),
      setTime: (t) => (game.timeOfDay = t),
      setSeason: (s) => game.selectSeason(s),
      grantAll: () => game.grantAll(),
      frostProbe: (x, z) => {
        const f = game.crossing.ice?.frost;
        if (!f) return null;
        const idx = f.index(x, z);
        return { v: f.valueAt(x, z), surface: idx >= 0 ? f.surfaceOf(idx) : null, active: f.activeCount, field: [game.field.x, game.field.z, game.field.season, game.field.intensity] };
      },
      travel: (i) => game.travel(i),
      openMap: () => game.setMode('map'),
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
    this.disposeWorld();
    this.post.dispose();
    this.audio.dispose();
    this.renderer.dispose();
  }
}
