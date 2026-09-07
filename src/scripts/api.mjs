/**
 * Public API — game.pf1Auras
 *
 * Until the sheet section lands (Phase 4) this is the only way to author an aura, so
 * `configure` is the primary surface rather than a convenience.
 */

import * as complete from "./apply-complete.mjs";
import * as config from "./config.mjs";
import * as geometry from "./geometry.mjs";
import * as membership from "./membership.mjs";
import * as scheduler from "./scheduler.mjs";
import { MODULE_ID } from "./constants.mjs";

/** Resolve an item from a document, uuid, or actor+name pair. */
function asItem(target) {
  if (target instanceof Item) return target;
  if (typeof target === "string") {
    const doc = fromUuidSync(target);
    if (doc instanceof Item) return doc;
  }
  throw new Error(`${MODULE_ID} | expected an Item or an item uuid, got: ${target}`);
}

export const api = {
  /**
   * Set aura config on a buff. Partial — only the fields given are changed.
   *
   *   game.pf1Auras.configure(item, { enabled: true, radius: "30", recipients: ["ally"] });
   *   game.pf1Auras.configure("Actor.abc.Item.def", { radius: "10 + @classes.paladin.level" });
   *
   * Fields: enabled, radius, recipients (["ally"|"enemy"|"neutral"] or "all"), includeSelf,
   * whileInactive, whileUnconscious, ignoreElevation.
   */
  configure: (target, partial) => config.write(asItem(target), partial),

  /** Remove all aura config from a buff. */
  clear: (target) => config.clear(asItem(target)),

  /** Current stored config for a buff, merged over defaults. Null when it has none. */
  read: (target) => config.read(asItem(target)),

  /** Recompute now and tell both lanes. */
  refresh: () => scheduler.flushNow("api"),

  /** Last computed membership: actorUuid -> Set(emitterUuid). */
  membership: () => membership.membership(),

  /** Last gathered emitters: emitterUuid -> record. */
  emitters: () => membership.emitterMap(),

  /** Distance between two tokens, by this module's reckoning. Accepts Tokens or TokenDocuments. */
  distance: (a, b, opts) => geometry.distance(a.document ?? a, b.document ?? b, opts),

  /**
   * Delete every child buff this module has placed. Scene actors by default.
   *   await game.pf1Auras.purge()                 // this scene
   *   await game.pf1Auras.purge({ world: true })  // every actor in the world
   * They come back on the next flush if the aura still reaches them; this is for clearing
   * a bad state, not for switching an aura off.
   */
  purge: (opts) => complete.purge(opts),

  /**
   * Readable dump of the current state — who is emitting what, and who is standing in it.
   *   game.pf1Auras.debug()
   */
  debug() {
    scheduler.flushNow("debug");
    const emitters = membership.emitterMap();
    const map = membership.membership();

    console.error(`${MODULE_ID} | ${emitters.size} emitter(s) on ${canvas.scene?.name ?? "no scene"}`);
    for (const e of emitters.values()) {
      console.error(`  ${e.actor.name} :: ${e.item.name} — ${e.radius} ft, ${e.cfg.recipients.join("+")}`);
    }

    console.error(`${MODULE_ID} | ${map.size} actor(s) receiving`);
    for (const [actorUuid, set] of map) {
      const actor = fromUuidSync(actorUuid);
      const names = [...set].map((u) => emitters.get(u)?.item.name ?? u);
      console.error(`  ${actor?.name ?? actorUuid}: ${names.join(", ")}`);
    }

    return { emitters, membership: map };
  },
};
