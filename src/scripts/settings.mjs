/**
 * World settings and their cache.
 *
 * game.settings.get is a linear scan of every Setting document, so nothing here is read
 * from the sweep directly — values are cached and invalidated on updateSetting. DESIGN.md §6.6
 */

import { MODULE_ID } from "./constants.mjs";

const DEFINITIONS = {
  // Emitter viability. Consciousness is read from conditions; this is the fallback for a
  // world where nothing sets them. DESIGN.md §10.2
  hpFallback: { type: Boolean, default: false },

  // Flush timings (DESIGN.md §6.3, §6.7). Milliseconds.
  quietWindow: { type: Number, default: 200, range: { min: 0, max: 2000, step: 50 } },
  settleCeiling: { type: Number, default: 5000, range: { min: 1000, max: 30000, step: 500 } },
  fastDebounce: { type: Number, default: 100, range: { min: 0, max: 1000, step: 25 } },
};

const cache = new Map();

export function register() {
  for (const [key, def] of Object.entries(DEFINITIONS)) {
    game.settings.register(MODULE_ID, key, {
      name: `PF1AURAS.Settings.${key}.Name`,
      hint: `PF1AURAS.Settings.${key}.Hint`,
      scope: "world",
      config: true,
      ...def,
      onChange: () => cache.delete(key),
    });
  }

  // onChange does not fire for a change made by another client, so drop the whole
  // cache on any setting update this module owns.
  Hooks.on("updateSetting", (setting) => {
    const [scope, key] = String(setting?.key ?? "").split(".");
    if (scope === MODULE_ID) cache.delete(key);
  });
}

/** Cached world setting. */
export function get(key) {
  if (!cache.has(key)) cache.set(key, game.settings.get(MODULE_ID, key));
  return cache.get(key);
}
