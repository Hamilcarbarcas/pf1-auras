/**
 * Complete mode — the aura as a real buff item on the recipient. DESIGN.md §6.8
 *
 * Runs on the settle gate, so a walk through an aura and out again produces no document
 * operations at all: the reconcile diffs desired membership against the children that are
 * ACTUALLY on the actor right now, and a transient visit never changes that.
 *
 * Reading the real items rather than an in-memory record of what was written is what makes
 * this self-correcting — a reload, a crash, or a hand-deleted child all reconcile on the
 * next flush instead of leaving something stranded.
 */

import { CHILD_FLAG, MODULE_ID } from "./constants.mjs";
import * as scheduler from "./scheduler.mjs";

// Writes are async while flushes are not, so a settle during an in-flight reconcile would
// otherwise interleave and double-create.
let running = false;
let rerun = false;

/** Only one client may write. */
const isPrimaryWriter = () => game.users.activeGM?.isSelf ?? false;

/** FNV-1a, enough to notice a parent's resolved payload changing. */
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** Existing children on an actor, keyed by the emitter they came from. */
function childrenOf(actor) {
  const out = new Map();
  for (const item of actor.items) {
    const source = item.flags?.[MODULE_ID]?.[CHILD_FLAG]?.source;
    if (source) out.set(source, item);
  }
  return out;
}

/**
 * The child item an emitter should produce right now.
 *
 * Formulas are resolved against the EMITTER's roll data, because the change belongs to the
 * emitter's numbers, not the recipient's. The payload hash covers the resolved result, so a
 * parent that later changes (the bard levels up, Inspire Courage improves) is detected and
 * the existing child updated in place rather than left frozen at creation time.
 */
function buildChild(emitter, rollData) {
  const data = emitter.item.toObject();
  delete data._id;

  for (const change of data.system.changes ?? []) {
    if (change.formula) {
      change.formula = Roll.replaceFormulaData(String(change.formula), rollData, { missing: 0 });
    }
  }
  if (data.system.duration?.value) {
    data.system.duration.value = Roll.replaceFormulaData(
      String(data.system.duration.value),
      rollData,
      { missing: 0 }
    );
  }

  const label = `${emitter.item.name} (${emitter.actor.name})`;
  data.name = label;
  data.system.identifiedName = label;
  data.system.active = true;
  data.system.subType = "temp";

  // Item links point at items on the EMITTER's actor. Carried across they dangle, so a
  // charge or child link would either do nothing or resolve against the wrong sheet.
  data.system.links = {};

  const payload = hash(JSON.stringify({ name: data.name, img: data.img, system: data.system }));

  // The module's flag block is REPLACED, not merged: a child carrying the parent's aura
  // config would emit an aura of its own and the whole thing would cascade.
  data.flags ??= {};
  data.flags[MODULE_ID] = { [CHILD_FLAG]: { source: emitter.uuid, hash: payload } };

  return { data, payload };
}

/** Every actor worth reconciling: current recipients, everyone on the scene, and the departed. */
function reconcileTargets(membershipMap) {
  const targets = new Map();

  for (const [actorUuid, desired] of membershipMap) {
    const actor = fromUuidSync(actorUuid);
    if (actor) targets.set(actorUuid, { actor, desired });
  }

  // On-scene actors with no membership may still be carrying children to clear.
  for (const token of canvas.scene?.tokens ?? []) {
    const actor = token.actor;
    if (actor && !targets.has(actor.uuid)) targets.set(actor.uuid, { actor, desired: new Set() });
  }

  for (const actorUuid of scheduler.takeDeparted()) {
    const actor = fromUuidSync(actorUuid);
    if (actor && !targets.has(actorUuid)) targets.set(actorUuid, { actor, desired: new Set() });
  }

  return targets;
}

async function reconcile(membershipMap, emitters) {
  if (!isPrimaryWriter()) return;

  const rollData = new Map();
  const plan = [];

  for (const { actor, desired } of reconcileTargets(membershipMap).values()) {
    const existing = childrenOf(actor);
    if (!existing.size && !desired.size) continue;

    const creates = [];
    const updates = [];
    const deletes = [];

    for (const sourceUuid of desired) {
      const emitter = emitters.get(sourceUuid);
      if (!emitter) continue;

      let rd = rollData.get(sourceUuid);
      if (!rd) rollData.set(sourceUuid, (rd = emitter.item.getRollData()));

      const { data, payload } = buildChild(emitter, rd);
      const current = existing.get(sourceUuid);

      if (!current) {
        creates.push(data);
      } else if (current.flags[MODULE_ID][CHILD_FLAG].hash !== payload) {
        // Update in place rather than replace, so the duration clock and the underlying
        // Active Effect survive the parent changing.
        updates.push({
          _id: current.id,
          name: data.name,
          system: data.system,
          [`flags.${MODULE_ID}.${CHILD_FLAG}.hash`]: payload,
        });
      }
    }

    for (const [sourceUuid, item] of existing) {
      if (!desired.has(sourceUuid)) deletes.push(item.id);
    }

    if (creates.length || updates.length || deletes.length) {
      plan.push({ actor, creates, updates, deletes });
    }
  }

  // One call per operation per actor, and only the last one re-renders the sheet.
  for (const { actor, creates, updates, deletes } of plan) {
    try {
      if (deletes.length) {
        await actor.deleteEmbeddedDocuments("Item", deletes, {
          render: !creates.length && !updates.length,
        });
      }
      if (updates.length) {
        await actor.updateEmbeddedDocuments("Item", updates, { render: !creates.length });
      }
      if (creates.length) {
        await actor.createEmbeddedDocuments("Item", creates);
      }
    } catch (err) {
      console.error(`${MODULE_ID} | could not reconcile auras on ${actor.name}:`, err);
    }
  }
}

/** Lane applier. Serialised against itself; a flush arriving mid-write re-runs after. */
export function apply(membershipMap, emitters) {
  if (running) {
    rerun = true;
    return;
  }
  running = true;

  reconcile(membershipMap, emitters)
    .catch((err) => console.error(`${MODULE_ID} | complete-lane reconcile failed:`, err))
    .finally(() => {
      running = false;
      if (rerun) {
        rerun = false;
        // State moved while writing; recompute rather than replay a stale membership.
        // Children are excluded from the item triggers, so this cannot feed itself.
        scheduler.flushNow("rerun");
      }
    });
}

/**
 * Delete every child item this module has placed, anywhere in the world.
 * Exposed on the API for cleaning up after a mode change or a bad state.
 */
export async function purge({ world = false } = {}) {
  if (!isPrimaryWriter()) throw new Error(`${MODULE_ID} | purge requires the active GM.`);

  const actors = new Set();
  for (const token of canvas.scene?.tokens ?? []) if (token.actor) actors.add(token.actor);
  if (world) for (const actor of game.actors) actors.add(actor);

  let removed = 0;
  for (const actor of actors) {
    const ids = [...childrenOf(actor).values()].map((i) => i.id);
    if (!ids.length) continue;
    await actor.deleteEmbeddedDocuments("Item", ids);
    removed += ids.length;
  }
  return removed;
}
