import * as THREE from 'three';

// Rain streaks in a box that follows the camera. A fixed pool of line
// segments is recycled - nothing is allocated while it runs.

export function createRain(scene, maxCount) {
  const AREA = 36;
  const HEIGHT = 24;
  const positions = new Float32Array(maxCount * 6);
  const speeds = new Float32Array(maxCount);
  for (let i = 0; i < maxCount; i++) {
    const x = (Math.random() - 0.5) * AREA;
    const y = Math.random() * HEIGHT;
    const z = (Math.random() - 0.5) * AREA;
    positions.set([x, y, z, x + 0.05, y + 0.6, z], i * 6);
    speeds[i] = 18 + Math.random() * 8;
  }
  const geo = new THREE.BufferGeometry();
  const attr = new THREE.BufferAttribute(positions, 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', attr);
  const mat = new THREE.LineBasicMaterial({ color: '#c8d8e8', transparent: true, opacity: 0, depthWrite: false });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.visible = false;
  scene.add(lines);
  let active = maxCount;

  return {
    lines,
    setCount(n) {
      active = Math.min(maxCount, n);
      geo.setDrawRange(0, active * 2);
    },
    update(dt, center, intensity) {
      lines.visible = intensity > 0.02;
      if (!lines.visible) return;
      mat.opacity = 0.55 * intensity;
      lines.position.set(center.x, center.y - 6, center.z);
      const n = Math.floor(active * intensity);
      geo.setDrawRange(0, n * 2);
      for (let i = 0; i < n; i++) {
        const o = i * 6;
        const dy = speeds[i] * dt;
        positions[o + 1] -= dy;
        positions[o + 4] -= dy;
        if (positions[o + 1] < 0) {
          const x = (Math.random() - 0.5) * AREA;
          const z = (Math.random() - 0.5) * AREA;
          positions[o] = x;
          positions[o + 1] = HEIGHT;
          positions[o + 2] = z;
          positions[o + 3] = x + 0.05;
          positions[o + 4] = HEIGHT + 0.6;
          positions[o + 5] = z;
        }
      }
      attr.needsUpdate = true;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      scene.remove(lines);
    },
  };
}
