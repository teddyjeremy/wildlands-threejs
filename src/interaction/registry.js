// Shared interactable registry.
//
// Objects register {id, prompt, radius, getPosition(), canInteract(), onInteract()}.
// Each frame the registry picks the single best target: in range, roughly in
// front of the player, closest wins. The object itself decides what
// happens when you press E.

export class InteractionRegistry {
  constructor() {
    this.items = new Map();
    this.active = null;
  }

  register(item) {
    const entry = { radius: 2.5, enabled: true, canInteract: () => true, ...item };
    this.items.set(entry.id, entry);
    return entry;
  }

  unregister(id) {
    this.items.delete(id);
    if (this.active?.id === id) this.active = null;
  }

  /**
   * @param {{x,y,z}} player
   * @param {number} heading player facing (radians, atan2(x,z) convention)
   */
  update(player, heading) {
    let best = null;
    let bestScore = Infinity;
    const fx = Math.sin(heading);
    const fz = Math.cos(heading);
    for (const it of this.items.values()) {
      if (!it.enabled || !it.canInteract()) continue;
      const p = it.getPosition();
      const dx = p.x - player.x;
      const dz = p.z - player.z;
      const dy = (p.y ?? player.y) - player.y;
      const d = Math.hypot(dx, dz);
      if (d > it.radius || Math.abs(dy) > 3.5) continue;
      // Prefer things in front; behind-you targets only win when very close.
      const facing = d > 0.01 ? (dx * fx + dz * fz) / d : 1;
      if (facing < -0.2 && d > 1.2) continue;
      const score = d * (1.6 - facing * 0.6);
      if (score < bestScore) {
        bestScore = score;
        best = it;
      }
    }
    this.active = best;
    return best;
  }

  trigger() {
    if (!this.active) return null;
    const it = this.active;
    it.onInteract(it);
    return it;
  }
}
