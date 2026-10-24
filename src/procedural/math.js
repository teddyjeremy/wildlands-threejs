export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Distance from point to segment, plus the 0..1 parameter along it. */
export function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const len2 = dx * dx + dz * dz || 1e-9;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / len2, 0, 1);
  const x = ax + dx * t - px;
  const z = az + dz * t - pz;
  return { d: Math.sqrt(x * x + z * z), t };
}

/** Distance to a polyline [[x,z],...] and the arc-length fraction of the closest point. */
export function distToPolyline(px, pz, pts) {
  let best = Infinity;
  let bestT = 0;
  let acc = 0;
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const r = distToSegment(px, pz, a[0], a[1], b[0], b[1]);
    if (r.d < best) {
      best = r.d;
      bestT = (acc + r.t * seg) / (total || 1);
    }
    acc += seg;
  }
  return { d: best, t: bestT };
}
