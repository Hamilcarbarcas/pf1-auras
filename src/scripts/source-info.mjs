/**
 * Pass-on values: named formulas on an aura, resolved against the EMITTER and readable on every
 * copy as `@sourceInfo.<name>`. DESIGN.md §14
 *
 * The key is shared with astora-mod's Buff Delivery stamp so one buff's formulas work whichever
 * way it arrived. Nothing here depends on that module: a value already present under the same
 * name wins over ours, and Buff Delivery merges its stamp after this hook runs, so its values
 * win on a clash too.
 */

import { CHILD_FLAG, MODULE_ID } from "./constants.mjs";
import { read } from "./config.mjs";

/** Roll-data key the values are exposed under. */
export const INFO_KEY = "sourceInfo";

/** A row name usable in a roll-data path: letters, digits and underscores. */
export const cleanName = (name) => String(name ?? "").replace(/[^A-Za-z0-9_]/g, "");

/**
 * One value, resolved. A plain number stays a number; a formula with `@` references is
 * evaluated, and kept as its substituted text when it can't be (dice, for instance).
 */
function resolveDatum(formula, rollData) {
  const f = String(formula ?? "").trim();
  if (!f) return null;
  if (!/@/.test(f)) {
    const n = Number(f);
    return Number.isFinite(n) ? n : f;
  }
  const substituted = Roll.replaceFormulaData(f, rollData ?? {}, { missing: 0 });
  try {
    const value = Roll.safeEval(substituted);
    if (Number.isFinite(value)) return value;
  } catch (_) {
    // Not plain arithmetic; the substituted text is still a usable formula.
  }
  return substituted;
}

/**
 * An aura's pass-on rows as `{ name: value }`, resolved against the given roll data.
 *
 * @param {object} cfg - Normalized aura config.
 * @param {object} rollData - The emitter's roll data.
 * @returns {Record<string, number|string>}
 */
export function resolveInfo(cfg, rollData) {
  const out = {};
  for (const row of cfg?.data ?? []) {
    const name = cleanName(row?.name);
    if (!name) continue;
    const value = resolveDatum(row.formula, rollData);
    if (value !== null) out[name] = value;
  }
  return out;
}

/**
 * Expose the values in a buff's own roll data: a child reads what was stamped on it, an emitter
 * resolves its rows against itself, so the same formula works on both.
 */
function onGetRollData(doc, result) {
  if (!(doc instanceof Item) || doc.type !== "buff" || !result) return;
  try {
    let info = doc.flags?.[MODULE_ID]?.[CHILD_FLAG]?.info;
    if (!info) {
      const cfg = read(doc);
      if (cfg?.data?.length) info = resolveInfo(cfg, result);
    }
    if (!info || !Object.keys(info).length) return;
    result[INFO_KEY] = { ...info, ...(result[INFO_KEY] ?? {}) };
  } catch (err) {
    console.error(`${MODULE_ID} | could not expose pass-on values on ${doc.name}:`, err);
  }
}

export function registerHooks() {
  Hooks.on("pf1GetRollData", onGetRollData);
}
