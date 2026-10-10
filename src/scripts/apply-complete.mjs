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

import { groupKey } from "./config.mjs";
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

/** Existing children on an actor, by child key: emitter uuid, or actor and group. */
function childrenOf(actor) {
  const out = new Map();
  for (const item of actor.items) {
    const source = item.flags?.[MODULE_ID]?.[CHILD_FLAG]?.source;
    if (source) out.set(source, item);
  }
  return out;
}

/**
 * An emitter's buff as plain data, formulas resolved.
 *
 * Formulas are resolved against the EMITTER's roll data, because the change belongs to the
 * emitter's numbers, not the recipient's. The payload hash covers the resolved result, so a
 * parent that later changes (the bard levels up, Inspire Courage improves) is detected and
 * the existing child updated in place rather than left frozen at creation time.
 */
function resolvedCopy(emitter, rollData) {
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
  return data;
}

/** Stamp the child-only fields onto built data and hash it. */
function finalize(data, { key, label, members }) {
  data.name = label;
  data.system.identifiedName = label;
  data.system.active = true;
  data.system.subType = "temp";

  // Item links point at items on the EMITTER's actor. Carried across they dangle, so a
  // charge or child link would either do nothing or resolve against the wrong sheet.
  data.system.links = {};

  // `members` is left out for an ungrouped child so its hash matches what earlier versions
  // wrote, and the upgrade touches nothing.
  const payload = hash(
    JSON.stringify({ name: data.name, img: data.img, system: data.system, ...(members ? { members } : {}) })
  );

  // The module's flag block is REPLACED, not merged: a child carrying the parent's aura
  // config would emit an aura of its own and the whole thing would cascade.
  data.flags ??= {};
  delete data.flags[MODULE_ID];
  const flagsHash = hash(JSON.stringify(data.flags));
  data.flags[MODULE_ID] = {
    [CHILD_FLAG]: { source: key, hash: payload, flagsHash, ...(members ? { members } : {}) },
  };

  return { data, payload, flagsHash };
}

/** The child for an ungrouped emitter, keyed by its own uuid. */
function buildSingle(emitter, rollData) {
  return finalize(resolvedCopy(emitter, rollData), {
    key: emitter.uuid,
    label: `${emitter.item.name} (${emitter.actor.name})`,
  });
}

// ---------------------------------------------------------------------------
// Groups. DESIGN.md §13
// ---------------------------------------------------------------------------

// Namespaces that differ on every item by construction; comparing them would make every
// group a conflict. The lead's copy is kept.
const BOOKKEEPING = new Set(["core", "scene-packer", MODULE_ID]);

// Members already reported as split out, so a flush per move doesn't repeat the message.
const warned = new Set();

const bySheetOrder = (a, b) =>
  (a.item.sort ?? 0) - (b.item.sort ?? 0) ||
  a.item.name.localeCompare(b.item.name) ||
  a.item.id.localeCompare(b.item.id);

const comparable = (flags) =>
  Object.fromEntries(Object.entries(flags ?? {}).filter(([ns]) => !BOOKKEEPING.has(ns)));

/** Leaf values of a nested object by dotted path. Arrays are leaves. */
function leaves(obj, prefix = "", out = new Map()) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) leaves(v, path, out);
    else out.set(path, v);
  }
  return out;
}

/** First path where `incoming` would overwrite a different value in `base`, or null. */
function clash(base, incoming, prefix = "") {
  const have = leaves(base, prefix);
  for (const [path, value] of leaves(incoming, prefix)) {
    if (have.has(path) && JSON.stringify(have.get(path)) !== JSON.stringify(value)) return path;
  }
  return null;
}

/**
 * Entries with repeated `_id`s re-keyed. PF1 keys item.changes and item.scriptCalls by id,
 * so a duplicate would silently replace another member's entry. The new id is derived, not
 * random, so the payload hash stays stable across flushes.
 */
function uniqueIds(entries, seen, salt) {
  return entries.map((entry) => {
    let id = entry._id;
    if (id && seen.has(id)) {
      let n = 0;
      do id = (hash(`${salt}:${entry._id}:${n++}`) + "00000000").slice(0, 8);
      while (seen.has(id));
      entry = { ...entry, _id: id };
    }
    if (id) seen.add(id);
    return entry;
  });
}

function reportSplit(member, group, path) {
  if (warned.has(member.uuid)) return;
  warned.add(member.uuid);
  console.error(
    `${MODULE_ID} | "${member.item.name}" on ${member.actor.name} can't join group "${group}": ` +
      `"${path}" differs from another member. Shared as its own buff instead.`
  );
}

/**
 * One child from several emitters on the same actor. The lead (first in sheet order)
 * supplies everything that isn't merged. A member whose flags clash is split out rather
 * than merged over, which would silently lose one member's value. DESIGN.md §13.4
 *
 * @returns {{built: object, split: object[]}}
 */
function buildGroup(key, members, rollDataFor) {
  members.sort(bySheetOrder);
  const lead = members[0];
  const group = lead.cfg.group;

  const data = resolvedCopy(lead, rollDataFor(lead));
  const sys = data.system;
  sys.flags ??= {};
  sys.changeFlags ??= {};

  const changes = [];
  const contextNotes = [];
  const scriptCalls = [];
  const conditions = new Set();
  const sections = [];
  const ids = { changes: new Set(), scriptCalls: new Set() };
  const joined = [];
  const split = [];

  for (const member of members) {
    const part = member === lead ? data : resolvedCopy(member, rollDataFor(member));
    const ps = part.system;

    if (member !== lead) {
      const where =
        clash(comparable(data.flags), comparable(part.flags), "flags") ??
        clash(sys.flags.dictionary, ps.flags?.dictionary, "system.flags.dictionary");
      if (where) {
        reportSplit(member, group, where);
        split.push(member);
        continue;
      }

      data.flags = foundry.utils.mergeObject(data.flags ?? {}, comparable(part.flags), { inplace: false });
      sys.flags.boolean = { ...sys.flags.boolean, ...ps.flags?.boolean };
      sys.flags.dictionary = { ...sys.flags.dictionary, ...ps.flags?.dictionary };
      for (const [flag, on] of Object.entries(ps.changeFlags ?? {})) if (on) sys.changeFlags[flag] = true;
    }

    changes.push(...uniqueIds(ps.changes ?? [], ids.changes, member.uuid));
    scriptCalls.push(...uniqueIds(ps.scriptCalls ?? [], ids.scriptCalls, member.uuid));
    contextNotes.push(...(ps.contextNotes ?? []));
    for (const c of ps.conditions ?? []) conditions.add(c);
    sections.push(`<h3>${foundry.utils.escapeHTML(member.item.name)}</h3>${ps.description?.value ?? ""}`);
    joined.push(member.uuid);
  }

  sys.changes = changes;
  sys.contextNotes = contextNotes;
  sys.scriptCalls = scriptCalls;
  sys.conditions = [...conditions];
  sys.description = { ...sys.description, value: sections.join("") };

  const built = finalize(data, { key, label: `${group} (${lead.actor.name})`, members: joined });
  return { built, split };
}

/**
 * Every child one recipient should hold, by child key. An ungrouped emitter keys by its own
 * uuid; a group keys by actor and group, and keeps that key even with one member in range so
 * a second member arriving is an update, not a delete and create. DESIGN.md §13.3
 */
function desiredChildren(desired, emitters, rollDataFor) {
  const out = new Map();
  const groups = new Map();

  for (const uuid of desired) {
    const emitter = emitters.get(uuid);
    if (!emitter) continue;

    const g = groupKey(emitter.cfg);
    if (!g) {
      out.set(uuid, buildSingle(emitter, rollDataFor(emitter)));
      continue;
    }

    const key = `${emitter.actor.uuid}::${g}`;
    let members = groups.get(key);
    if (!members) groups.set(key, (members = []));
    members.push(emitter);
  }

  for (const [key, members] of groups) {
    const { built, split } = buildGroup(key, members, rollDataFor);
    out.set(key, built);
    for (const member of split) out.set(member.uuid, buildSingle(member, rollDataFor(member)));
  }

  return out;
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
  const rollDataFor = (emitter) => {
    let rd = rollData.get(emitter.uuid);
    if (!rd) rollData.set(emitter.uuid, (rd = emitter.item.getRollData()));
    return rd;
  };
  const plan = [];

  for (const { actor, desired } of reconcileTargets(membershipMap).values()) {
    const existing = childrenOf(actor);
    if (!existing.size && !desired.size) continue;

    const creates = [];
    const updates = [];
    const deletes = [];

    const wanted = desiredChildren(desired, emitters, rollDataFor);

    for (const [key, { data, payload, flagsHash }] of wanted) {
      const current = existing.get(key);
      const stored = current?.flags[MODULE_ID][CHILD_FLAG];

      if (!current) {
        creates.push(data);
      } else if (stored.flagsHash !== undefined && stored.flagsHash !== flagsHash) {
        // An update merges flags and can't drop a key a departed member brought, so a flags
        // change replaces the child. A child from before flagsHash existed counts as a
        // match and picks the hash up on its next update. DESIGN.md §13.5
        deletes.push(current.id);
        creates.push(data);
      } else if (stored.hash !== payload) {
        // Update in place rather than replace, so the duration clock and the underlying
        // Active Effect survive the parent changing.
        updates.push({
          _id: current.id,
          name: data.name,
          img: data.img,
          system: data.system,
          [`flags.${MODULE_ID}.${CHILD_FLAG}`]: data.flags[MODULE_ID][CHILD_FLAG],
        });
      }
    }

    for (const [key, item] of existing) {
      if (!wanted.has(key)) deletes.push(item.id);
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
