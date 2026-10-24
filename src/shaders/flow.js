// Runoff / stream ribbons.
//
// Geometry: a strip following a drainage polyline. uv.x runs across the
// strip (0..1), uv.y is distance along it in world units, so scrolling
// uv.y with time moves highlights downhill at a constant speed.
// uFlow (0..1) is the amount of water: it widens the visible core and
// raises the opacity. With uFlow = 0 the channel is invisible.

export const flowVertex = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

export const flowFragment = /* glsl */ `
uniform float uTime;
uniform float uFlow;
uniform float uSpeed;
uniform vec3 uColor;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uLight;
varying vec2 vUv;
varying vec3 vWorld;

void main() {
  float across = abs(vUv.x - 0.5) * 2.0;           // 0 centre, 1 edge
  float width = mix(0.15, 1.0, uFlow);
  float core = 1.0 - smoothstep(width * 0.6, width, across);
  // Highlights travelling downhill: two out-of-phase bands along the strip.
  float t = vUv.y * 0.9 - uTime * uSpeed;
  float ripples = 0.5 + 0.5 * sin(t * 6.2831 + across * 3.0);
  float glints = smoothstep(0.75, 1.0, sin(t * 2.7 + vUv.x * 9.0) * 0.5 + 0.5);
  vec3 col = uColor * uLight + vec3(0.8, 0.9, 1.0) * (ripples * 0.12 + glints * 0.35) * max(uLight, 0.3);
  float alpha = core * uFlow * (0.65 + 0.25 * ripples);
  float fog = smoothstep(uFogNear, uFogFar, length(vWorld - cameraPosition));
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(mix(col, uFogColor, fog), alpha);
}
`;
