import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../procedural/math.js';

// Sky dome, sun/hemisphere lights and the day/night cycle.
// timeOfDay: 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset.

const skyVertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww; // always at the far plane
}
`;
const skyFragment = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uStars;
varying vec3 vDir;

float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }

void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.2, 1.0);
  vec3 col = mix(uHorizon, uTop, pow(max(h, 0.0), 0.55));
  // Sun disc and glow.
  float s = max(dot(d, uSunDir), 0.0);
  col += uSunColor * (pow(s, 900.0) * 3.0 + pow(s, 12.0) * 0.25);
  // Sparse stars at night, only above the horizon.
  vec3 cell = floor(d * 220.0);
  float star = step(0.9975, hash(cell)) * smoothstep(0.05, 0.3, d.y);
  col += vec3(star) * uStars;
  gl_FragColor = vec4(col, 1.0);
}
`;

// Key colours by sun elevation (-1..1).
const KEYS = [
  { e: -0.35, top: '#0c1430', horizon: '#22305a', sun: '#2a3550', sunI: 0.0, hemi: 0.32, fog: '#18223a' },
  { e: -0.05, top: '#2b3766', horizon: '#c0707a', sun: '#ff8a5c', sunI: 0.2, hemi: 0.45, fog: '#5a5470' },
  { e: 0.12, top: '#5d8fc4', horizon: '#ffc488', sun: '#ffb070', sunI: 1.4, hemi: 0.75, fog: '#e6c9a8' },
  { e: 0.45, top: '#4b8fd6', horizon: '#bfe0ef', sun: '#fff1d6', sunI: 2.2, hemi: 1.0, fog: '#c7dde6' },
  { e: 1.0, top: '#3f86d6', horizon: '#c9e6f2', sun: '#ffffff', sunI: 2.4, hemi: 1.05, fog: '#cfe3ea' },
];
const grey = new THREE.Color('#8a949c');
const WHITE = new THREE.Color('#ffffff');
const parsed = KEYS.map((k) => ({ ...k, top: new THREE.Color(k.top), horizon: new THREE.Color(k.horizon), sun: new THREE.Color(k.sun), fog: new THREE.Color(k.fog) }));

export function createSky(scene, quality) {
  const uniforms = {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3() },
    uSunColor: { value: new THREE.Color() },
    uStars: { value: 0 },
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(900, 24, 12),
    new THREE.ShaderMaterial({ uniforms, vertexShader: skyVertex, fragmentShader: skyFragment, side: THREE.BackSide, depthWrite: false, fog: false }),
  );
  dome.frustumCulled = false;
  dome.renderOrder = -1;
  scene.add(dome);

  const sun = new THREE.DirectionalLight('#ffe0b0', 2);
  sun.castShadow = quality.shadows;
  if (quality.shadows) {
    sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
    const c = sun.shadow.camera;
    c.left = -40; c.right = 40; c.top = 40; c.bottom = -40; c.near = 1; c.far = 200;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.04;
  }
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight('#bcd8ff', '#6b5a3a', 1);
  scene.add(hemi);
  scene.fog = new THREE.Fog('#c7dde6', 60, quality.fogFar);

  const out = {
    dome,
    sun,
    hemi,
    uniforms,
    sunDir: new THREE.Vector3(),
    elevation: 0,
    night: 0,
    fogColor: new THREE.Color(),
    light: 1,
    /** Update everything for a given time of day; `focus` is where shadows should be centred. */
    update(timeOfDay, focus, cloud = 0, interior = 0) {
      const ang = (timeOfDay - 0.25) * Math.PI * 2;
      const elev = Math.sin(ang);
      this.elevation = elev;
      // Sun arcs from east to west with a southern tilt so shadows read well.
      this.sunDir.set(Math.cos(ang), Math.max(elev, -0.3), 0.45).normalize();
      // Interpolate keyframes.
      let a = parsed[0];
      let b = parsed[parsed.length - 1];
      for (let i = 0; i < parsed.length - 1; i++) {
        if (elev >= parsed[i].e && elev <= parsed[i + 1].e) {
          a = parsed[i];
          b = parsed[i + 1];
          break;
        }
      }
      const t = clamp((elev - a.e) / (b.e - a.e || 1), 0, 1);
      const cloudDim = 1 - cloud * 0.45;
      uniforms.uTop.value.copy(a.top).lerp(b.top, t).lerp(grey, cloud * 0.55 * (elev > 0 ? 1 : 0.3));
      uniforms.uHorizon.value.copy(a.horizon).lerp(b.horizon, t).lerp(grey, cloud * 0.5 * (elev > 0 ? 1 : 0.3));
      uniforms.uSunColor.value.copy(a.sun).lerp(b.sun, t).multiplyScalar(1 - cloud * 0.85);
      uniforms.uSunDir.value.copy(this.sunDir);
      this.night = 1 - smoothstep(-0.15, 0.1, elev);
      uniforms.uStars.value = this.night * (1 - cloud);

      sun.color.copy(a.sun).lerp(b.sun, t);
      sun.intensity = lerp(a.sunI, b.sunI, t) * cloudDim * (1 - interior * 0.85);
      hemi.intensity = lerp(a.hemi, b.hemi, t) * (1 - cloud * 0.2) * (1 - interior * 0.7);
      hemi.color.copy(uniforms.uTop.value).lerp(WHITE, 0.4);
      this.fogColor.copy(a.fog).lerp(b.fog, t).lerp(grey, cloud * 0.45);
      scene.fog.color.copy(this.fogColor);
      scene.fog.near = lerp(60, 30, cloud);
      this.light = clamp(lerp(a.hemi, b.hemi, t) * cloudDim, 0.15, 1.1);

      // Keep the shadow frustum centred on the player.
      if (elev > -0.1) {
        sun.position.set(focus.x + this.sunDir.x * 80, focus.y + Math.max(this.sunDir.y, 0.1) * 80, focus.z + this.sunDir.z * 80);
      } else {
        // Moonlight: a cool, faint light from a fixed direction.
        sun.position.set(focus.x - 40, focus.y + 70, focus.z + 30);
        sun.color.set('#7f95c8');
        sun.intensity = 0.35 * (1 - cloud * 0.6) * (1 - interior * 0.85);
      }
      sun.target.position.set(focus.x, focus.y, focus.z);
      dome.position.copy(focus);
    },
    setShadows(q) {
      sun.castShadow = q.shadows;
      if (q.shadows && sun.shadow.mapSize.x !== q.shadowMapSize) {
        sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
        sun.shadow.map?.dispose();
        sun.shadow.map = null;
      }
      scene.fog.far = q.fogFar;
    },
  };
  return out;
}
