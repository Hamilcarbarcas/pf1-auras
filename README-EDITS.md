# README / user-facing prose edit log

Append-only. Every change to user-facing documentation or `lang/en.json` hint prose is
recorded here as before/after. Never rewrite this file.

---

## 2026-09-06 — initial creation (Phase 1)

New module; no prior text to diff against. Files created:

- `README.md` — title + manifest URL, Requirements, Contents TOC, What it does, Configuring
  an aura (options table, Fast vs Complete), Settings table, Current state.
- `CHANGELOG.md` — Unreleased / Phase 1 entry.
- `lang/en.json` — six setting name/hint pairs.

Setting hints as first written:

| Key | Name | Hint |
| --- | --- | --- |
| `shareZero` | Share at 0 HP | Auras keep emitting at exactly 0 HP. |
| `unconsciousAuras` | Share while unconscious | Auras keep emitting below 0 HP. Per-aura option overrides this. |
| `diehard` | Diehard keeps auras up | The Diehard feat lets an aura emit below 0 HP. |
| `quietWindow` | Settle delay (ms) | Wait this long after movement stops before applying full auras. |
| `settleCeiling` | Maximum settle wait (ms) | Apply anyway once this long has passed, for tokens that never stop moving. |
| `fastDebounce` | Fast aura delay (ms) | How long fast auras wait before updating. |

---

## 2026-09-06 — consciousness read from conditions, not HP

Three settings removed, one added.

**Removed** (`lang/en.json`):

| Key | Name | Hint |
| --- | --- | --- |
| `shareZero` | Share at 0 HP | Auras keep emitting at exactly 0 HP. |
| `unconsciousAuras` | Share while unconscious | Auras keep emitting below 0 HP. Per-aura option overrides this. |
| `diehard` | Diehard keeps auras up | The Diehard feat lets an aura emit below 0 HP. |

**Added** (`lang/en.json`):

| Key | Name | Hint |
| --- | --- | --- |
| `hpFallback` | Stop auras below 0 HP | Only for worlds without condition automation. Auras normally stop when the emitter is unconscious or dead. |

**`README.md` — options table, `whileUnconscious` row**

- Before: `Emit below the HP threshold`
- After: `Emit even while the emitter is unconscious or dead`

**`README.md` — Settings table**

- Before: three rows (Share at 0 HP / Share while unconscious / Diehard keeps auras up)
  above the three timing rows.
- After: one row, `Stop auras below 0 HP | off | Only for worlds without condition
  automation — see below`, above the three timing rows.

**`README.md` — new subsection "When auras stop"** added after the Settings table:

> An aura stops emitting when its owner is **unconscious** or **dead**, read from the
> actor's conditions rather than from HP. That handles Diehard correctly — including the
> player's choice to keep fighting — along with Ferocity, Last Stand and anything else that
> keeps a character up, and it also catches being knocked out at full HP by a sleep spell.
>
> This relies on something in your world setting those conditions; the PF1 system does not
> do it on its own. If nothing does, turn on **Stop auras below 0 HP** for a rough
> equivalent.
>
> Per-aura, `whileUnconscious` overrides all of it.

---

## 2026-09-06 — Phase 2, Complete-mode application

**`README.md` — "Current state" section rewritten.**

- Before:

  > **Phase 1 of the build.** The engine works — auras are computed, membership is tracked
  > and movement settling is handled — but **nothing is applied to an actor yet**. No
  > changes are injected and no items are created.
  >
  > Inspect what it has worked out with: `game.pf1Auras.debug()`
  >
  > Still to come: applying Complete auras, applying Fast auras, and a proper configuration
  > section on the buff sheet.

- After:

  > **Phase 2 of the build.** Auras are applied as real buff items on the recipient, held
  > until token movement settles.
  >
  > **Fast mode is not implemented yet**, so `mode` is ignored — every aura currently
  > applies as a real item. Setting `mode: "fast"` stores the preference but changes
  > nothing today.
  >
  > Inspect what the engine has worked out with: `game.pf1Auras.debug()`
  >
  > If a child buff is ever left somewhere it shouldn't be:
  > `await game.pf1Auras.purge()` / `await game.pf1Auras.purge({ world: true })`
  >
  > They come straight back on the next flush if the aura still reaches them — that is for
  > clearing a bad state, not for switching an aura off.
  >
  > Still to come: Fast mode, and a configuration section on the buff sheet.

No changes to `lang/en.json` this phase.

---

## 2026-09-06 — Fast mode cut; propagation fix

**`lang/en.json` — `fastDebounce` relabelled** (key unchanged; it now only governs how fast
an aura edit reaches the copies).

- Before: Name `Fast aura delay (ms)` / Hint `How long fast auras wait before updating.`
- After: Name `Aura edit delay (ms)` / Hint `How quickly edits to an aura buff reach the
  copies. Not affected by movement.`

**`README.md` — options table:** `mode` row removed entirely.

- Removed: `| `mode` | `"auto"` | `"auto"`, `"fast"` or `"complete"` |`

**`README.md` — "Fast and Complete" section replaced by "How an aura is applied".**

- Before:

  > **Fast** auras are applied as derived changes. They cost nothing — no items are created,
  > nothing is written to the database — and they update immediately. They can carry the
  > buff's changes and context notes.
  >
  > **Complete** auras are applied as a real buff item on the recipient. That costs a
  > database write, so they are held until token movement stops, but they carry everything a
  > buff can: conditions, script calls, status icons.
  >
  > `"auto"` picks Complete when the buff needs it and Fast otherwise.

- After:

  > The recipient gets a real copy of the buff on their sheet, named `Bless (Hellenrae)` so
  > its source is obvious. It carries everything a buff can — changes, context notes,
  > conditions, script calls, status icons — because it *is* a buff.
  >
  > Copies are applied once token movement settles rather than mid-step, so walking through
  > an aura and out the far side costs nothing at all.
  >
  > If the emitting buff changes — the bard levels up, the aura improves — the copies are
  > updated in place rather than removed and remade, so their duration keeps running.

**`README.md` — Settings table**, two rows reworded:

- `Settle delay` — before: `Wait after movement stops before applying full auras`; after:
  `Wait after movement stops before applying auras`.
- Before: `| Fast aura delay | 100 ms | How long fast auras wait before updating |`; after:
  `| Aura edit delay | 100 ms | How quickly edits to an aura buff reach the copies |`.

**`README.md` — "Current state" opening replaced.**

- Before: `**Phase 2 of the build.** Auras are applied as real buff items on the recipient,
  held until token movement settles.` followed by the "Fast mode is not implemented yet"
  paragraph.
- After: `Functionally complete. Auras emit, apply, update and clear.` followed by `What is
  missing is the interface: there is no configuration section on the buff sheet yet, so
  auras are set up from the console.`
- Trailing line before: `Still to come: Fast mode, and a configuration section on the buff
  sheet.`; after: `Still to come: the configuration section on the buff sheet.`

---

## 2026-09-06 — Phase 3, aura section on the buff sheet

**`lang/en.json` — 16 new sheet strings added** (no existing strings changed):

| Key | Text |
| --- | --- |
| `Sheet.Title` | Aura |
| `Sheet.Toggle` | Click to expand / collapse |
| `Sheet.Enabled` | Share this buff as an aura |
| `Sheet.Radius` | Radius |
| `Sheet.Recipients` | Share with |
| `Sheet.RecipientsHint` | Relative to this token's disposition. |
| `Sheet.Relation.ally` | Allies |
| `Sheet.Relation.enemy` | Enemies |
| `Sheet.Relation.neutral` | Neutral |
| `Sheet.IncludeSelf` | Include self |
| `Sheet.WhileInactive` | Share while off |
| `Sheet.WhileUnconscious` | Share while down |
| `Sheet.IgnoreElevation` | Ignore elevation |
| `Sheet.ChildNote` | Shared by an aura. Edit the source buff instead. |
| `Sheet.Source` | Source |
| `Sheet.SourceGone` | Source no longer available |

**`README.md` — "Configuring an aura" opening replaced.**

- Before:

  > There is no sheet UI yet (see Current state). Auras are configured from the console:
  > `game.pf1Auras.configure(item, { enabled: true, radius: "30", recipients: ["ally"] });`
  > `item` is a buff item — a document, or its uuid as a string. The radius is a formula
  > resolved against the emitting actor, so `"10 + @classes.paladin.level"` works.

- After:

  > Open a buff and go to its **Advanced** tab. The **Aura** section is collapsed until you
  > use it; when configured, the header shows the resolved radius so you can read it at a
  > glance without expanding.
  >
  > Tick **Share this buff as an aura**, set a radius, and choose who receives it. The radius
  > is a formula resolved against the emitting actor, so `10 + @classes.paladin.level` works
  > — the `= value` readout beside the field shows what it currently comes to, and hovering
  > it breaks down each `@variable`.
  >
  > A buff that arrived *from* someone else's aura shows a read-only version of this section
  > naming its source, with a link to the original.
  >
  > Everything is also available from the console: [same snippet], `item` is a buff item — a
  > document, or its uuid as a string.

**`README.md` — "Current state" replaced.**

- Before: `Functionally complete. Auras emit, apply, update and clear.` + `What is missing is
  the interface: there is no configuration section on the buff sheet yet, so auras are set up
  from the console.`
- After: `Complete. Auras are configured on the buff sheet, and they emit, apply, update and
  clear.`
- Trailing line `Still to come: the configuration section on the buff sheet.` removed.

---

## 2026-09-06 — all grid types; radius formula hint

**`lang/en.json` — one string added:**

| Key | Text |
| --- | --- |
| `Sheet.RadiusHint` | Formulas allowed, e.g. 10 + @classes.paladin.level |

Shown as the radius input's hover tooltip. Added because a plain number shows no `= value`
readout, so nothing indicated formulas were accepted.

**`README.md` — Requirements**

- Removed the line `- A square-grid scene` (hex and gridless are now supported).

**`README.md` — "Configuring an aura", radius paragraph expanded.**

- Before:

  > Tick **Share this buff as an aura**, set a radius, and choose who receives it. The radius
  > is a formula resolved against the emitting actor, so `10 + @classes.paladin.level` works
  > — the `= value` readout beside the field shows what it currently comes to, and hovering
  > it breaks down each `@variable`.

- After:

  > Tick **Share this buff as an aura**, set a radius, and choose who receives it.
  >
  > The radius accepts a **formula**, resolved against the emitting actor — so
  > `10 + @classes.paladin.level` works as well as a plain `30`. When you use one, a
  > `= value` readout appears beside the field showing what it currently comes to, and
  > hovering that breaks down each `@variable`. A plain number gets no readout, since it
  > would only repeat itself.
  >
  > Distances match the scene's own measurement, including its diagonal rule, on square, hex
  > and gridless scenes alike.
