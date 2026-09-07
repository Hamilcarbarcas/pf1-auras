/**
 * Reading and writing the aura config on a buff. DESIGN.md §9
 *
 * Until the sheet section exists (Phase 4) this is the only way to author an aura,
 * so it is the surface the console API wraps.
 */

import { AURA_FLAG, CHILD_FLAG, DEFAULT_AURA, MODULE_ID, RELATIONS } from "./constants.mjs";

/** Coerce a stored or partial config into a complete, valid one. */
export function normalize(partial = {}, base = DEFAULT_AURA) {
  const cfg = { ...DEFAULT_AURA, ...base, ...partial };

  cfg.enabled = !!cfg.enabled;
  cfg.radius = String(cfg.radius ?? "").trim();
  cfg.includeSelf = !!cfg.includeSelf;
  cfg.whileInactive = !!cfg.whileInactive;
  cfg.whileUnconscious = !!cfg.whileUnconscious;
  cfg.ignoreElevation = !!cfg.ignoreElevation;
  delete cfg.mode; // dropped with Fast mode; see DESIGN.md §4.3

  // A single relation string is accepted for convenience; "all" means every relation.
  let rel = cfg.recipients;
  if (rel === "all") rel = [...RELATIONS];
  else if (typeof rel === "string") rel = [rel];
  cfg.recipients = Array.isArray(rel) ? [...new Set(rel.filter((r) => RELATIONS.includes(r)))] : ["ally"];

  return cfg;
}

/** Stored aura config for an item, merged over defaults. Null when the item carries none. */
export function read(item) {
  const raw = item?.flags?.[MODULE_ID]?.[AURA_FLAG];
  if (!raw || typeof raw !== "object") return null;
  return normalize(raw);
}

/** True when the item is an aura that should currently be considered for emission. */
export function isEmitter(item) {
  const cfg = read(item);
  return !!cfg?.enabled && !!cfg.radius;
}

/** True when the item is a Complete-mode child placed by this module. */
export function isChild(item) {
  return !!item?.flags?.[MODULE_ID]?.[CHILD_FLAG]?.source;
}

/** Merge a partial config onto an item's aura and persist it. */
export async function write(item, partial = {}) {
  if (!(item instanceof Item)) throw new Error(`${MODULE_ID} | configure: target must be an Item.`);
  if (item.type !== "buff") throw new Error(`${MODULE_ID} | configure: auras live on buff items.`);
  const cfg = normalize(partial, read(item) ?? DEFAULT_AURA);
  await item.update({ [`flags.${MODULE_ID}.${AURA_FLAG}`]: cfg });
  return cfg;
}

/** Remove all aura config from an item. */
export async function clear(item) {
  if (!(item instanceof Item)) throw new Error(`${MODULE_ID} | clear: target must be an Item.`);
  return item.update({ [`flags.${MODULE_ID}.-=${AURA_FLAG}`]: null });
}
