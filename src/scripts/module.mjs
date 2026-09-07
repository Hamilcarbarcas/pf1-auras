/**
 * pf1-auras — entry point.
 *
 * Current state: DESIGN.md Phase 1. The membership engine and flush scheduler run, but
 * nothing is applied to an actor yet — no changes are injected and no items are written.
 * Drive it from the console via `game.pf1Auras`.
 */

import { api } from "./api.mjs";
import * as complete from "./apply-complete.mjs";
import { MODULE_ID } from "./constants.mjs";
import * as scheduler from "./scheduler.mjs";
import * as settings from "./settings.mjs";
import * as auraSection from "./ui/aura-section.mjs";

Hooks.once("init", () => {
  // Assigned first so a failure below still leaves the API reachable for diagnosis.
  game.pf1Auras = api;
  game.modules.get(MODULE_ID).api = api;

  try {
    settings.register();
    scheduler.registerHooks();
    scheduler.registerApplier("complete", complete.apply);
    auraSection.registerHooks();
  } catch (err) {
    console.error(`${MODULE_ID} | setup failed:`, err);
    scheduler.setDormant(true);
  }
});

Hooks.once("ready", () => {
  // Both modules writing the same child items would fight; neither is worth the other.
  if (game.modules.get("aurashare")?.active) {
    scheduler.setDormant(true);
    ui.notifications.error(
      "PF1 Auras and Aura Share are both active. Disable Aura Share — PF1 Auras will stay dormant."
    );
    return;
  }

  scheduler.flushNow("ready");
});
