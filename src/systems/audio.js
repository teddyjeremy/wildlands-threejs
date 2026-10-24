// All sound in the game is synthesised at runtime with the Web Audio API -
// there are no audio files to license. See AUDIO_CREDITS.md.
//
// Layout of the graph:
//   beds (wind, sea, rain, forest, cave) -> ambienceGain -\
//   one-shots (steps, chimes, calls, ui) -> effectsGain  --> master -> out
//
// The context is only created on the first user gesture (Start button).

const STEP_PROFILES = {
  grass: { freq: 1800, q: 0.7, dur: 0.09, gain: 0.22 },
  sand: { freq: 900, q: 0.5, dur: 0.12, gain: 0.2 },
  rock: { freq: 2600, q: 2.5, dur: 0.05, gain: 0.25 },
  path: { freq: 1300, q: 1.0, dur: 0.07, gain: 0.2 },
  wood: { freq: 420, q: 4, dur: 0.08, gain: 0.35 },
  water: { freq: 700, q: 0.8, dur: 0.16, gain: 0.25 },
};

export class AudioManager {
  constructor(settings) {
    this.ctx = null;
    this.settings = settings;
    this.beds = {};
    this.paused = false;
    this._birdTimer = 3;
  }

  /** Must be called from a user gesture handler. */
  async start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);
    this.ambience = ctx.createGain();
    this.effects = ctx.createGain();
    this.ambience.connect(this.master);
    this.effects.connect(this.master);
    this.noise = this._makeNoiseBuffer(4);
    this.brown = this._makeNoiseBuffer(4, true);

    this.beds.wind = this._bed(this.brown, 'bandpass', 380, 0.6);
    this.beds.sea = this._bed(this.brown, 'lowpass', 520, 0.5);
    this.beds.rain = this._bed(this.noise, 'highpass', 1400, 0.3);
    this.beds.forest = this._bed(this.noise, 'bandpass', 5200, 3);
    this.beds.cave = this._bed(this.brown, 'lowpass', 160, 1);
    // Slow swell on the sea bed so it reads as waves rather than hiss.
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.12;
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain).connect(this.beds.sea.filter.frequency);
    lfo.start();

    if (ctx.state === 'suspended') await ctx.resume();
    this.applySettings(this.settings);
    // Fade in rather than popping on.
    this.master.gain.setTargetAtTime(this._masterLevel(), ctx.currentTime, 1.2);
  }

  _makeNoiseBuffer(seconds, brown = false) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    // Crossfade the ends so the loop point is inaudible.
    const fade = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) {
      const t = i / fade;
      d[len - fade + i] = d[len - fade + i] * (1 - t) + d[i] * t;
    }
    return buf;
  }

  _bed(buffer, type, freq, q) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.ambience);
    src.start(0, Math.random() * buffer.duration);
    return { src, filter, gain };
  }

  _masterLevel() {
    if (this.settings.muted || this.paused) return 0;
    return this.settings.masterVolume * 0.9;
  }

  applySettings(settings) {
    this.settings = settings;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this._masterLevel(), t, 0.15);
    this.ambience.gain.setTargetAtTime(settings.ambienceVolume, t, 0.15);
    this.effects.gain.setTargetAtTime(settings.effectsVolume, t, 0.15);
  }

  /** Duck everything while paused or when the tab is hidden. */
  setPaused(paused) {
    this.paused = paused;
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(this._masterLevel(), this.ctx.currentTime, paused ? 0.08 : 0.6);
  }

  /**
   * Called every frame with the listener's surroundings.
   * mix: {coast, forest, cave, lighthouse, rain, wind}
   */
  updateAmbience(mix, dt) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const set = (bed, v) => bed.gain.gain.setTargetAtTime(v, t, 0.8);
    set(this.beds.wind, 0.12 + mix.wind * 0.25 + mix.lighthouse * 0.25);
    set(this.beds.sea, 0.05 + mix.coast * 0.55);
    set(this.beds.rain, mix.rain * 0.4);
    set(this.beds.forest, mix.forest * 0.02 * (1 - mix.rain));
    set(this.beds.cave, mix.cave * 0.5);
    // Occasional bird calls, never during rain or in the cave.
    this._birdTimer -= dt;
    if (this._birdTimer <= 0) {
      this._birdTimer = 4 + Math.random() * 9;
      if (mix.rain < 0.3 && mix.cave < 0.5 && !mix.night) this.birdCall(0.5 + mix.forest * 0.5);
    }
    if (mix.cave > 0.6 && Math.random() < dt * 0.4) this.drip();
  }

  _env(gainNode, peak, attack, decay) {
    const t = this.ctx.currentTime;
    gainNode.gain.setValueAtTime(0.0001, t);
    gainNode.gain.exponentialRampToValueAtTime(peak, t + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  _noiseHit(profile, rate = 1) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = profile.freq * (0.85 + Math.random() * 0.3);
    f.Q.value = profile.q;
    const g = ctx.createGain();
    src.connect(f).connect(g).connect(this.effects);
    this._env(g, profile.gain, 0.005, profile.dur);
    src.start(0, Math.random() * 3);
    src.stop(ctx.currentTime + profile.dur + 0.05);
  }

  footstep(surface) {
    if (!this.ctx || this.paused) return;
    this._noiseHit(STEP_PROFILES[surface] || STEP_PROFILES.grass);
  }

  _tone(freq, dur, type = 'sine', gain = 0.2, when = 0, slideTo = null) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    const t = ctx.currentTime + when;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.effects);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  chime() {
    if (!this.ctx) return;
    this._tone(880, 0.5, 'triangle', 0.14);
    this._tone(1318.5, 0.7, 'triangle', 0.1, 0.09);
    this._tone(1760, 0.9, 'sine', 0.05, 0.18);
  }

  discover() {
    if (!this.ctx) return;
    this._tone(523.25, 0.6, 'sine', 0.12);
    this._tone(659.25, 0.6, 'sine', 0.1, 0.12);
    this._tone(783.99, 0.9, 'sine', 0.1, 0.24);
  }

  ui(kind = 'click') {
    if (!this.ctx) return;
    if (kind === 'open') this._tone(600, 0.12, 'triangle', 0.08, 0, 900);
    else if (kind === 'close') this._tone(900, 0.12, 'triangle', 0.08, 0, 600);
    else this._tone(700, 0.06, 'square', 0.03);
  }

  jump() {
    if (!this.ctx) return;
    this._noiseHit({ freq: 600, q: 0.6, dur: 0.12, gain: 0.12 });
  }

  birdCall(level = 1) {
    if (!this.ctx) return;
    const base = 2200 + Math.random() * 1600;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) this._tone(base, 0.09, 'sine', 0.025 * level, i * 0.14, base * (1.3 + Math.random() * 0.3));
  }

  /** Small rustle + squeak when an animal bolts. */
  animalAlarm(distance) {
    if (!this.ctx) return;
    const v = Math.max(0, 1 - distance / 30);
    if (v <= 0) return;
    this._noiseHit({ freq: 3000, q: 0.8, dur: 0.25, gain: 0.15 * v });
    this._tone(1900, 0.08, 'sine', 0.05 * v, 0.02, 2600);
  }

  drip() {
    if (!this.ctx) return;
    this._tone(1400 + Math.random() * 600, 0.12, 'sine', 0.05, 0, 600);
  }

  dispose() {
    if (this.ctx) this.ctx.close();
    this.ctx = null;
  }
}
