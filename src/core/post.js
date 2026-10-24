import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// Post stack: scene -> (bloom) -> grade + vignette -> output (tone map + sRGB).
// On the low preset everything except the output pass is skipped and we
// render straight to the canvas.

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uVignette: { value: 0.32 },
    uSaturation: { value: 1.08 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uTintAmt: { value: 0 },
    uLift: { value: 0.0 },
  },
  vertexShader: /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uVignette;
uniform float uSaturation;
uniform vec3 uTint;
uniform float uTintAmt;
uniform float uLift;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(tDiffuse, vUv);
  float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
  c.rgb = mix(vec3(l), c.rgb, uSaturation);
  // Gentle split tone: warm highlights, cool shadows.
  c.rgb += (vec3(0.03, 0.015, -0.02) * smoothstep(0.4, 1.2, l) + vec3(-0.015, 0.0, 0.025) * (1.0 - smoothstep(0.0, 0.4, l)));
  c.rgb = mix(c.rgb, c.rgb * uTint, uTintAmt);
  c.rgb += uLift;
  vec2 d = vUv - 0.5;
  c.rgb *= 1.0 - uVignette * smoothstep(0.25, 0.85, dot(d, d) * 2.2);
  gl_FragColor = c;
}`,
};

export class PostStack {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.enabled = false;
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.55, 0.82);
    this.grade = new ShaderPass(GradeShader);
    this.output = new OutputPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.grade);
    this.composer.addPass(this.output);
  }

  setScene(scene, camera) {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
  }

  configure(quality) {
    this.enabled = quality.bloom !== false;
    this.bloom.enabled = !!quality.bloom;
  }

  setSize(w, h, pixelRatio) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
    // Bloom at half res is plenty and much cheaper.
    this.bloom.setSize(Math.ceil((w * pixelRatio) / 2), Math.ceil((h * pixelRatio) / 2));
  }

  get uniforms() {
    return this.grade.uniforms;
  }

  render(scene, camera, dt) {
    if (!this.enabled) {
      this.renderer.render(scene, camera);
      return;
    }
    this.composer.render(dt);
  }

  dispose() {
    this.composer.dispose();
    this.bloom.dispose();
  }
}
