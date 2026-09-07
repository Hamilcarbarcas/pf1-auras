export const MODULE_ID = "pf1-auras";

/** Aura config on an emitting buff: flags[MODULE_ID][AURA_FLAG]. See DESIGN.md §9. */
export const AURA_FLAG = "aura";

/** Marker on a Complete-mode child item: flags[MODULE_ID][CHILD_FLAG]. See DESIGN.md §9. */
export const CHILD_FLAG = "child";

/** Relations an aura can be shared with, resolved relative to the emitter. DESIGN.md §6A.2 */
export const RELATIONS = Object.freeze(["ally", "enemy", "neutral"]);

export const DEFAULT_AURA = Object.freeze({
  enabled: false,
  radius: "",
  recipients: Object.freeze(["ally"]),
  includeSelf: false,
  whileInactive: false,
  whileUnconscious: false,
  ignoreElevation: false,
});
