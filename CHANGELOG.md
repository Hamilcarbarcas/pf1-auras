# Changelog

## [Unreleased]

Phases 1–2 — the membership engine, and auras applied as real buff items.

### Added

- **Aura groups.** Buffs on one character that share a **Group** name arrive on each
  recipient as a single buff, so a paladin's three auras put one buff on each ally instead
  of three. Fewer buffs means less lag when allies move in and out of range, and fewer
  token icons.
- **Aura section on the buff sheet** (Advanced tab). Enable the aura, set a radius with a
  live `= value` readout, and choose who receives it. Collapsed until used; the header
  shows the resolved radius while closed.
- A buff received from someone else's aura shows a read-only version of the section naming
  its source, with a link to the original.
- Works on square, hex and gridless scenes, matching each scene's own measurement.
- Auras are applied to recipients as a real buff item, created when they come into range
  and removed when they leave. Application waits until token movement has settled, so
  walking through an aura and out again costs nothing.
- A shared buff tracks its source: if the emitting buff changes (the bard levels up, the
  aura improves), the copies are updated in place rather than left at their original
  values, and the duration clock is not reset.
- `game.pf1Auras.purge()` — remove every buff this module has placed, for clearing a bad
  state.

### Fixed

- Editing an aura buff's module settings, such as a roll-bonuses bonus, now reaches the
  copies other characters hold. Previously only changes, notes, and other system data did.
- **Adding or changing an entry in a sheet section no longer jumps the sheet back to the top of
  the tab.** Sections from the shared sheet kit now restore the scroll position once they have
  drawn.

- Checkbox labels in the aura section sat slightly off-centre from their boxes.
- Editing an aura buff — changing its level, a formula, its description — now reaches the
  copies immediately. Previously the change waited until something else happened on the
  scene, such as a token moving.

### Removed

- **Include self.** An aura's owner already has the buff, so it only ever added a duplicate.
  To share a buff with allies but not yourself, turn the buff off and tick **Share while
  off**.

### Also added

- Aura config on buff items: radius formula, recipients, share while
  inactive, share while unconscious, application mode, ignore elevation.
- `game.pf1Auras` console API — `configure`, `clear`, `read`, `refresh`, `membership`,
  `emitters`, `distance`, `debug`.
- Two-speed flush scheduler. Fast auras update on a short debounce; full auras wait until
  token movement has actually settled, so walking through an aura and out again costs
  nothing.
- World settings for the three flush timings, plus an HP fallback for worlds without
  condition automation.

### Notes

- An aura stops when its owner is unconscious or dead, read from conditions rather than
  from HP. This handles Diehard — including the player's choice to keep fighting — along
  with Ferocity, Last Stand and anything else that keeps a character up, and it catches
  being knocked out at full HP.
