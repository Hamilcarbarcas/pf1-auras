# PF1 Auras

**Manifest URL:** `https://github.com/Hamilcarbarcas/pf1-auras/releases/latest/download/module.json`

## Requirements

- Foundry VTT v13
- PF1e system v11

## Contents

- [What it does](#what-it-does)
- [Configuring an aura](#configuring-an-aura)
  - [Options](#options)
  - [How an aura is applied](#how-an-aura-is-applied)
  - [Grouping auras](#grouping-auras)
- [Settings](#settings)
- [Current state](#current-state)

## What it does

Give a buff a radius and it becomes an aura: everyone standing inside it gets the buff,
and loses it when they leave.

## Configuring an aura

Open a buff and go to its **Advanced** tab. The **Aura** section is collapsed until you use
it; when configured, the header shows the resolved radius so you can read it at a glance
without expanding.

Tick **Share this buff as an aura**, set a radius, and choose who receives it.

The radius accepts a **formula**, resolved against the emitting actor — so
`10 + @classes.paladin.level` works as well as a plain `30`. When you use one, a `= value`
readout appears beside the field showing what it currently comes to, and hovering that breaks
down each `@variable`. A plain number gets no readout, since it would only repeat itself.

Distances match the scene's own measurement, including its diagonal rule, on square, hex and
gridless scenes alike.

A buff that arrived *from* someone else's aura shows a read-only version of this section
naming its source, with a link to the original.

Everything is also available from the console:

```js
game.pf1Auras.configure(item, { enabled: true, radius: "30", recipients: ["ally"] });
```

`item` is a buff item — a document, or its uuid as a string.

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `enabled` | `false` | Whether the aura emits at all |
| `radius` | `""` | Radius formula, in scene units |
| `recipients` | `["ally"]` | Any of `"ally"`, `"enemy"`, `"neutral"` — or `"all"` |
| `whileInactive` | `false` | Emit even when the buff is toggled off |
| `whileUnconscious` | `false` | Emit even while the emitter is unconscious or dead |
| `ignoreElevation` | `false` | Treat height differences as zero distance |
| `group` | `""` | Merge with this actor's other auras of the same group – see [Grouping auras](#grouping-auras) |

Relations are relative to the emitter: **ally** is matching disposition, **enemy** is
opposite, **neutral** is disposition zero. A neutral emitter treats every non-zero
disposition as an enemy. Tokens with the Secret disposition only ever receive auras from
other Secret tokens.

### How an aura is applied

The recipient gets a real copy of the buff on their sheet, named `Bless (Hellenrae)` so its
source is obvious. It carries everything a buff can — changes, context notes, conditions,
script calls, status icons — because it *is* a buff.

Copies are applied once token movement settles rather than mid-step, so walking through an
aura and out the far side costs nothing at all.

If the emitting buff changes — the bard levels up, the aura improves — the copies are
updated in place rather than removed and remade, so their duration keeps running.

### Grouping auras

A character with several auras – a paladin's Aura of Courage, Resolve, and Righteousness –
would otherwise put several buffs on everyone nearby. Give those buffs the same **Group**
(e.g. `Paladin Aura`) and each ally gets **one** buff instead, named `Paladin Aura (Meraxes)`,
holding everything from the members that reach them.

- Each member keeps its own radius and recipients. An ally only reached by some members gets
  just those.
- Changes, context notes, conditions, and script calls are combined, and the description has
  one section per member.
- The **first** member in sheet order supplies the icon and duration. Drag the buff you want
  first to the top.
- Gaining a new member, such as Aura of Resolve at 8th level, updates the existing buff
  rather than adding another.
- Group names match ignoring case, and only within one character: two paladins still give
  two buffs.

If two members disagree on a setting that can't be combined (the same roll-bonuses flag with
different values, for example), the odd one out is shared as its own buff, and the console
says which and why.

## Settings

| Setting | Default | |
| --- | --- | --- |
| Stop auras below 0 HP | off | Only for worlds without condition automation — see below |
| Settle delay | 200 ms | Wait after movement stops before applying auras |
| Maximum settle wait | 5000 ms | Apply anyway, for tokens that never stop moving |
| Aura edit delay | 100 ms | How quickly edits to an aura buff reach the copies |

### When auras stop

An aura stops emitting when its owner is **unconscious** or **dead**, read from the actor's
conditions rather than from HP. That handles Diehard correctly — including the player's
choice to keep fighting — along with Ferocity, Last Stand and anything else that keeps a
character up, and it also catches being knocked out at full HP by a sleep spell.

This relies on something in your world setting those conditions; the PF1 system does not do
it on its own. If nothing does, turn on **Stop auras below 0 HP** for a rough equivalent.

Per-aura, `whileUnconscious` overrides all of it.

## Current state

Complete. Auras are configured on the buff sheet, and they emit, apply, update and clear.

Inspect what the engine has worked out with:

```js
game.pf1Auras.debug()
```

If a child buff is ever left somewhere it shouldn't be:

```js
await game.pf1Auras.purge()                 // this scene
await game.pf1Auras.purge({ world: true })  // every actor
```

They come straight back on the next flush if the aura still reaches them — that is for
clearing a bad state, not for switching an aura off.
