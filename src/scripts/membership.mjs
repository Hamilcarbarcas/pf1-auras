/**
 * Who is standing in whose aura. DESIGN.md §6
 *
 * A full sweep of the viewed scene, deliberately not incremental (DESIGN.md §6.1): the
 * per-pair cost is a handful of integer operations, so a rescan is cheaper than the
 * bookkeeping needed to avoid one — and it cannot leave a stale membership behind.
 *
 * Membership is keyed by ACTOR, because changes apply to an actor; range is tested per
 * TOKEN, and an actor counts as in range when any of its tokens is.
 */

import { read } from "./config.mjs";
import * as geometry from "./geometry.mjs";
import * as settings from "./settings.mjs";

const SECRET = CONST.TOKEN_DISPOSITIONS.SECRET;

/** Last computed membership: actorUuid -> Set(emitterUuid). */
let current = new Map();

/** Emitter records from the last sweep: emitterUuid -> record. */
let emitters = new Map();

export const membership = () => current;
export const emitterMap = () => emitters;

/**
 * Does an emitter share with a target, given the emitter's chosen relations?
 * The two cases plain arithmetic gets wrong — a neutral emitter and a secret token —
 * are decided here rather than left to fall out. DESIGN.md §6A.2
 */
function relationMatches(emitterDisp, targetDisp, recipients) {
  // Hidden things never quietly join someone else's aura.
  if (targetDisp === SECRET) return emitterDisp === SECRET && recipients.includes("ally");
  if (recipients.includes("neutral") && targetDisp === 0) return true;

  if (emitterDisp === SECRET) return false;

  if (emitterDisp === 0) {
    if (recipients.includes("ally") && targetDisp === 0) return true;
    if (recipients.includes("enemy") && targetDisp !== 0) return true;
    return false;
  }

  if (recipients.includes("ally") && targetDisp === emitterDisp) return true;
  if (recipients.includes("enemy") && targetDisp === -emitterDisp) return true;
  return false;
}

/**
 * Can this actor emit at all right now?
 *
 * Consciousness is a condition, not an HP sum. Aura Share recomputed it as
 * "HP above a threshold, unless the actor owns the Diehard feat", which got three things
 * wrong: Diehard is a CHOICE the player makes rather than a state ownership implies, a
 * character past -Con is dead no matter what feat they hold, and nothing that knocks you
 * out at full HP (sleep, a coup de grace) is visible to HP arithmetic at all.
 *
 * `unconscious` already answers all of it, and answers it for every consciousness source
 * at once - Diehard, Ferocity, Last Stand, Honorable Stand and the rest.
 *
 * `dying` is deliberately NOT checked: a Diehard character still fighting is dying and
 * conscious, and blocking on it would reintroduce the bug this replaces.
 */
function emitterViable(actor, cfg) {
  if (cfg.whileUnconscious) return true;

  const statuses = actor.statuses;
  if (statuses?.has("dead") || statuses?.has("unconscious")) return false;

  // Vanilla PF1 sets neither condition from HP - that needs condition automation in the
  // world. This is the degraded path for a world without it. DESIGN.md §10.2
  if (settings.get("hpFallback")) {
    // 0 HP is `disabled`: conscious, and still emitting.
    return (actor.system?.attributes?.hp?.value ?? 0) >= 0;
  }

  return true;
}

/**
 * Every actor with a token on the scene, and its tokens.
 * @returns {Map<string, {actor: Actor, tokens: TokenDocument[]}>} keyed by actor uuid
 */
function gatherActors(scene) {
  const out = new Map();
  for (const token of scene.tokens) {
    const actor = token.actor;
    if (!actor) continue;
    const entry = out.get(actor.uuid);
    if (entry) entry.tokens.push(token);
    else out.set(actor.uuid, { actor, tokens: [token] });
  }
  return out;
}

/**
 * Emitting auras on the scene, with their radius already resolved.
 * Roll data is built once per actor and the radius once per emitter — never per pair.
 */
function gatherEmitters(actors) {
  const found = new Map();

  for (const { actor, tokens } of actors.values()) {
    let rollData = null;

    for (const item of actor.itemTypes.buff) {
      const cfg = read(item);
      if (!cfg?.enabled || !cfg.radius) continue;
      if (!item.system.active && !cfg.whileInactive) continue;
      if (!emitterViable(actor, cfg)) continue;

      rollData ??= actor.getRollData();
      const roll = pf1.dice.RollPF.safeRollSync(cfg.radius, rollData, "pf1-auras");
      if (roll.err || !(roll.total > 0)) continue;

      found.set(item.uuid, { uuid: item.uuid, item, actor, tokens, radius: roll.total, cfg });
    }
  }

  return found;
}

/** Is any token of `target` within `emitter`'s radius, and of a shared relation? */
function reaches(emitter, target) {
  for (const et of emitter.tokens) {
    for (const tt of target.tokens) {
      if (!relationMatches(et.disposition, tt.disposition, emitter.cfg.recipients)) continue;
      if (geometry.inRange(et, tt, emitter.radius, { ignoreElevation: emitter.cfg.ignoreElevation })) return true;
    }
  }
  return false;
}

/**
 * Recompute membership for the viewed scene.
 *
 * No diff is returned: each applier diffs against ITS OWN applied state, because what a
 * lane has actually put on an actor can lag behind what was last computed. That is what
 * makes a walk through an aura and out again cost nothing. DESIGN.md §6.4
 *
 * @returns {{membership: Map, emitters: Map}}
 */
export function recompute() {
  const scene = canvas.scene;
  const next = new Map();

  if (scene && canvas.ready && geometry.gridSupported()) {
    const actors = gatherActors(scene);
    emitters = gatherEmitters(actors);

    for (const emitter of emitters.values()) {
      for (const [actorUuid, target] of actors) {
        if (actorUuid === emitter.actor.uuid && !emitter.cfg.includeSelf) continue;
        if (!reaches(emitter, target)) continue;
        let set = next.get(actorUuid);
        if (!set) next.set(actorUuid, (set = new Set()));
        set.add(emitter.uuid);
      }
    }
  } else {
    emitters = new Map();
  }

  current = next;
  return { membership: next, emitters };
}

/** Per-actor added/removed emitter sets between two membership maps. */
export function diff(before, after) {
  const added = new Map();
  const removed = new Map();

  for (const [actorUuid, now] of after) {
    const was = before.get(actorUuid);
    const gained = was ? [...now].filter((u) => !was.has(u)) : [...now];
    if (gained.length) added.set(actorUuid, new Set(gained));
  }

  for (const [actorUuid, was] of before) {
    const now = after.get(actorUuid);
    const lost = now ? [...was].filter((u) => !now.has(u)) : [...was];
    if (lost.length) removed.set(actorUuid, new Set(lost));
  }

  return { added, removed };
}

/** Forget everything. Used on scene change. */
export function reset() {
  current = new Map();
  emitters = new Map();
  geometry.invalidate();
}
