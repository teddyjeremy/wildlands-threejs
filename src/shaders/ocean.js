// Stylised ocean.
//
// Vertex stage (world space): three directional sine waves displace the
// plane vertically. We also return the analytic normal of that sum so the
// fragment stage can do a cheap sun highlight without derivatives.
//
// Fragment stage: colour is driven by how close the seabed is to the
// surface. That comes from uShore, a texture baked from the terrain height
// grid (1 = at the waterline, 0 = deep water), sampled with world XZ.
// Near shore we fade to turquoise, add a moving foam band and let a bit of
// the sand show through via alpha.
//
// Uniforms: uTime (seconds, drives the waves), uSunDir (world, normalised),
// uSunColor, uDeep/uShallow (colours), uShore + uShoreSize (texture and the
// world size it covers), fog colour and range (we do fog ourselves because
// this is a raw ShaderMaterial).

export const oceanVertex = /* glsl */ `
uniform float uTime;
uniform float uWaveScale;
varying vec3 vWorld;
varying vec3 vNormalW;

// Each wave: direction (xy), wavelength, amplitude.
vec3 wave(vec2 p, vec2 dir, float len, float amp, float speed, inout vec3 n) {
  float k = 6.28318 / len;
  float f = k * dot(dir, p) - speed * uTime;
  float h = amp * sin(f);
  float d = amp * k * cos(f);
  n.x -= dir.x * d;
  n.z -= dir.y * d;
  return vec3(0.0, h, 0.0);
}

void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vec3 n = vec3(0.0, 1.0, 0.0);
  vec3 offs = vec3(0.0);
  offs += wave(world.xz, normalize(vec2(1.0, 0.3)), 18.0, 0.22 * uWaveScale, 1.1, n);
  offs += wave(world.xz, normalize(vec2(-0.4, 1.0)), 9.0, 0.12 * uWaveScale, 1.7, n);
  offs += wave(world.xz, normalize(vec2(0.7, -0.8)), 4.5, 0.05 * uWaveScale, 2.6, n);
  world.xyz += offs;
  vWorld = world.xyz;
  vNormalW = normalize(n);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const oceanFragment = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSkyTint;
uniform sampler2D uShore;
uniform float uShoreSize;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uLight;
uniform vec3 uPlayer;
uniform float uRipple;
varying vec3 vWorld;
varying vec3 vNormalW;

void main() {
  vec2 uv = (vWorld.xz + 0.5 * uShoreSize) / uShoreSize;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  float shore = texture2D(uShore, clamp(uv, 0.0, 1.0)).r * inside;

  vec3 col = mix(uDeep, uShallow, pow(shore, 1.6));
  // Sky reflection rises at grazing angles (cheap Fresnel).
  vec3 viewDir = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(viewDir, vNormalW), 0.0), 3.0);
  col = mix(col, uSkyTint, fres * 0.45);
  col *= uLight;

  // Sun glint.
  vec3 h = normalize(viewDir + uSunDir);
  float spec = pow(max(dot(vNormalW, h), 0.0), 120.0) * step(0.0, uSunDir.y);
  col += uSunColor * spec * 0.9;

  // Foam: a band that breathes in and out right at the waterline.
  float band = smoothstep(0.86, 0.97, shore + 0.04 * sin(uTime * 1.3 + vWorld.x * 0.4 + vWorld.z * 0.3));
  float streak = 0.5 + 0.5 * sin(vWorld.x * 2.1 + uTime * 0.8) * sin(vWorld.z * 1.7 - uTime * 0.6);
  col = mix(col, vec3(0.95, 0.97, 0.95) * max(uLight, 0.25), band * (0.55 + 0.45 * streak));

  // Ripples spreading from the player's legs while wading.
  float pd = distance(vWorld.xz, uPlayer.xz);
  float ripple = sin(pd * 5.5 - uTime * 5.0) * exp(-pd * 0.5) * uRipple;
  col += vec3(0.9, 0.95, 1.0) * max(ripple, 0.0) * 0.22 * max(uLight, 0.3);
  // Depth: a hint of caustic shimmer in the shallows.
  float caustic = pow(abs(sin(vWorld.x * 1.3 + uTime) * sin(vWorld.z * 1.1 - uTime * 0.8)), 6.0);
  col += vec3(0.5, 0.7, 0.6) * caustic * smoothstep(0.55, 0.9, shore) * 0.12 * uLight;

  float alpha = mix(0.96, 0.62, smoothstep(0.75, 1.0, shore));
  alpha = max(alpha, band * 0.9);

  float dist = length(vWorld - cameraPosition);
  float fog = smoothstep(uFogNear, uFogFar, dist);
  gl_FragColor = vec4(mix(col, uFogColor, fog), alpha);
}
`;
