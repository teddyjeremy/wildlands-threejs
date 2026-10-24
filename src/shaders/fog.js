import * as THREE from 'three';

// Height fog for every built-in material. Three's distance fog is kept and
// a low mist layer is added on top: thick near sea level, gone by about
// 10 m up, and only noticeable at a distance. Patching the shared chunks
// means every Lambert/Standard material picks it up without per-material code.

let installed = false;

export function installHeightFog() {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = `#ifdef USE_FOG
varying float vFogDepth;
varying float vFogHeight;
#endif`;
  C.fog_vertex = `#ifdef USE_FOG
vFogDepth = - mvPosition.z;
vFogHeight = (inverse(viewMatrix) * mvPosition).y;
#endif`;
  C.fog_pars_fragment = C.fog_pars_fragment.replace('varying float vFogDepth;', 'varying float vFogDepth;\nvarying float vFogHeight;');
  C.fog_fragment = `#ifdef USE_FOG
#ifdef FOG_EXP2
float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
#else
float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
float mistReach = fogFar * 0.55;
float mist = (1.0 - exp(-vFogDepth / mistReach * 1.6)) * exp(-max(vFogHeight - 0.5, 0.0) * 0.28) * 0.55;
fogFactor = clamp(max(fogFactor, mist), 0.0, 1.0);
#endif
gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif`;
}
