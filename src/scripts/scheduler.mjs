/**
 * When membership is recomputed, and when each lane is told about it. DESIGN.md §6.3, §6.5, §6.7
 *
 * Two lanes run at different speeds:
 *   fast     — local, cheap, no documents. Flushes on a short debounce.
 *   complete — writes real items. Waits until token movement has actually settled, so a
 *              walk through an aura and out the far side costs nothing at all.
 *
 * Settle is read from v13's movement API rather than guessed with a timer: movement.state,
 * User#movingTokens and Token#movementAnimationPromise. DESIGN.md §6.2
 */

import { isChild, isEmitter, read } from "./config.mjs";
import * as geometry from "./geometry.mjs";
import * as membership from "./membership.mjs";
import { MODULE_ID } from "./constants.mjs";
import * as settings from "./settings.mjs";

const appliers = { fast: [], complete: [] };

/** Register a lane applier. Called with (membership, emitters, {reason}). */
export function registerApplier(lane, fn) {
  if (!appliers[lane]) throw new Error(`${MODULE_ID} | unknown lane "${lane}"`);
  appliers[lane].push(fn);
}

const touched = new Set(); // token ids moved since the last complete flush

// Actors whose token left the scene. They fall out of the sweep but a linked actor keeps
// any child items it was given, so a writing lane needs one more chance at them.
const departedActors = new Set();
const departed = (actorUuid) => departedActors.add(actorUuid);

/** Consume the departed-actor list. Called by a lane that writes documents. */
export function takeDeparted() {
  const out = [...departedActors];
  departedActors.clear();
  return out;
}
let fastTimer = null;
let quietTimer = null;
let ceilingTimer = null;
let pendingComplete = false;

// ---------------------------------------------------------------------------
// Dirtying
// ---------------------------------------------------------------------------

/** A token's position, elevation, disposition or existence changed. */
export function markGeometry(tokenDoc) {
  if (tokenDoc?.id) {
    geometry.invalidate(tokenDoc.id);
    touched.add(tokenDoc.id);
  }
  scheduleFast();
  scheduleComplete();
}

/**
 * The set of emitting auras changed — a buff toggled, edited, created or deleted, or an
 * actor's HP moved.
 *
 * Not gated by movement: a bard toggling Inspire Courage while somebody else is walking has
 * to take effect now, or toggling a buff feels broken. DESIGN.md §6.5
 */
export function markEmitters() {
  scheduleFast();
  scheduleCompleteNow();
}

// ---------------------------------------------------------------------------
// Fast lane
// ---------------------------------------------------------------------------

function scheduleFast() {
  if (fastTimer) return;
  fastTimer = setTimeout(() => {
    fastTimer = null;
    flush("fast", "debounce");
  }, settings.get("fastDebounce"));
}

// ---------------------------------------------------------------------------
// Complete lane
// ---------------------------------------------------------------------------

/** Nothing anywhere is still mid-move. */
function movementSettled() {
  for (const user of game.users) if (user.movingTokens?.size) return false;
  for (const id of touched) {
    if (canvas.scene?.tokens.get(id)?.movement?.state === "pending") return false;
  }
  return true;
}

/** Animation promises for the tokens we are waiting on. */
function animations() {
  const out = [];
  for (const id of touched) {
    const promise = canvas.scene?.tokens.get(id)?.object?.movementAnimationPromise;
    if (promise) out.push(promise);
  }
  return out;
}

function scheduleComplete() {
  pendingComplete = true;
  clearTimeout(quietTimer);
  quietTimer = setTimeout(trySettle, settings.get("quietWindow"));
  // A token that never settles - a tile-driven patrol loop - must not starve this lane.
  ceilingTimer ??= setTimeout(() => finishComplete("ceiling"), settings.get("settleCeiling"));
}

/** Flush the complete lane on the short debounce, bypassing the settle gate. */
function scheduleCompleteNow() {
  pendingComplete = true;
  clearTimeout(quietTimer);
  quietTimer = setTimeout(() => finishComplete("emitters"), settings.get("fastDebounce"));
}

async function trySettle() {
  if (!pendingComplete) return;

  if (!movementSettled()) {
    scheduleComplete(); // re-arm; stopToken and the next move also poke this
    return;
  }

  // Hold until the sprites have arrived, so a buff never lands on a token still visibly walking.
  const waits = animations();
  if (waits.length) await Promise.allSettled(waits);

  // Something may have started moving again while awaiting.
  if (!movementSettled()) {
    scheduleComplete();
    return;
  }

  finishComplete("settle");
}

function finishComplete(reason) {
  clearTimeout(quietTimer);
  clearTimeout(ceilingTimer);
  quietTimer = ceilingTimer = null;
  pendingComplete = false;
  touched.clear();
  flush("complete", reason);
}

/** Flush both lanes immediately, ignoring every timer. */
export function flushNow(reason = "forced") {
  clearTimeout(fastTimer);
  fastTimer = null;
  flush("fast", reason);
  finishComplete(reason);
}

// ---------------------------------------------------------------------------

let dormant = false;

/** Stop doing any work at all. Used when a conflicting module is active. */
export function setDormant(value) {
  dormant = !!value;
}

function flush(lane, reason) {
  if (dormant || !canvas.ready) return;
  // A lane nobody listens to still costs a full sweep. The fast lane is currently empty.
  if (!appliers[lane].length) return;

  const { membership: map, emitters } = membership.recompute();
  for (const fn of appliers[lane]) {
    try {
      fn(map, emitters, { reason, lane });
    } catch (err) {
      console.error(`${MODULE_ID} | ${lane} applier failed:`, err);
    }
  }
}

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

export function registerHooks() {
  Hooks.on("moveToken", (doc) => markGeometry(doc));
  Hooks.on("stopToken", (doc) => markGeometry(doc));
  Hooks.on("createToken", (doc) => markGeometry(doc));
  Hooks.on("deleteToken", (doc) => {
    geometry.invalidate(doc.id);
    touched.delete(doc.id);
    // A linked actor keeps its child items after its token goes; flag it for one more
    // reconcile so nothing is stranded off-scene.
    if (doc.actor) departed(doc.actor.uuid);
    markEmitters(); // the token may have been an emitter's only presence
  });

  Hooks.on("updateToken", (doc, change) => {
    if (change.disposition !== undefined || change.elevation !== undefined) markGeometry(doc);
  });

  // HP only matters on an actor that actually emits something - otherwise every damage roll
  // in a combat would schedule a flush. Whether the threshold was crossed is left to the
  // sweep: it is cheap, and the per-lane diff absorbs a no-op result.
  Hooks.on("updateActor", (actor, change) => {
    if (change.system?.attributes?.hp === undefined) return;
    if (!actor.itemTypes.buff.some((i) => isEmitter(i))) return;
    markEmitters();
  });

  // Aura config or buff activation changed. Children are skipped so the complete lane's own
  // writes cannot retrigger the sweep - the feedback loop Aura Share had. DESIGN.md §3.3
  const itemTouchesAuras = (item, change) => {
    if (item?.type !== "buff" || !item.actor) return false;
    if (isChild(item)) return false;
    // Config being added or removed right now: the item may not read as an aura yet, or
    // may have just stopped being one.
    if (change?.flags?.[MODULE_ID] !== undefined) return true;
    // Otherwise ANY edit to an aura buff, not just activation - a child is a copy of it,
    // so a changed level, formula or description all have to reach the copies. The payload
    // hash absorbs an edit that changes nothing material, so over-triggering here is free.
    return !!read(item);
  };

  Hooks.on("createItem", (item) => itemTouchesAuras(item) && markEmitters());
  Hooks.on("deleteItem", (item) => itemTouchesAuras(item) && markEmitters());
  Hooks.on("updateItem", (item, change) => itemTouchesAuras(item, change) && markEmitters());

  // Nobody should start a turn missing an aura they should have. DESIGN.md §6.3
  Hooks.on("updateCombat", (_combat, change) => {
    if (change.turn !== undefined || change.round !== undefined) flushNow("combat");
  });

  Hooks.on("canvasReady", () => {
    membership.reset();
    touched.clear();
    flushNow("canvasReady");
  });

  Hooks.on("updateScene", (scene, change) => {
    if (scene.id === canvas.scene?.id && change.grid !== undefined) {
      geometry.invalidate();
      flushNow("grid");
    }
  });
}
