/**
 * The aura config section on a buff's Advanced tab. DESIGN.md §6A
 *
 * Two faces. On an ordinary buff it is the editor: radius, who receives it, and the handful
 * of switches. On a child placed by this module it is a read-only line naming the source,
 * because editing a copy would only be undone by the next reconcile.
 */

import { AURA_FLAG, CHILD_FLAG, DEFAULT_AURA, MODULE_ID, RELATIONS } from "../constants.mjs";
import { isChild, normalize, read } from "../config.mjs";
import { makeCollapsible, setBadge } from "../../common/sheet/collapse.mjs";
import { attachFormulaPreview } from "../../common/sheet/formula-preview.mjs";
import { bindFields } from "../../common/sheet/field-bind.mjs";

const MARKER = "pfa-aura";
const ICON = "fa-solid fa-circle-dot";

const RELATION_LABELS = {
  ally: "PF1AURAS.Sheet.Relation.ally",
  enemy: "PF1AURAS.Sheet.Relation.enemy",
  neutral: "PF1AURAS.Sheet.Relation.neutral",
};

const SWITCHES = [
  ["whileInactive", "PF1AURAS.Sheet.WhileInactive"],
  ["whileUnconscious", "PF1AURAS.Sheet.WhileUnconscious"],
  ["ignoreElevation", "PF1AURAS.Sheet.IgnoreElevation"],
];

const t = (key) => game.i18n.localize(key);
const esc = foundry.utils.escapeHTML;

/** Resolved radius for the header badge, or null when it can't be evaluated. */
function resolvedRadius(item, cfg) {
  if (!cfg.enabled || !cfg.radius) return null;
  const roll = pf1.dice.RollPF.safeRollSync(cfg.radius, item.getRollData(), MODULE_ID);
  return roll.err ? null : roll.total;
}

/** One source link on a child's read-only face. */
function sourceLink(uuid) {
  const parent = uuid ? fromUuidSync(uuid) : null;
  if (!parent) return `<span>${t("PF1AURAS.Sheet.SourceGone")}</span>`;
  const label = esc(`${parent.name} – ${parent.actor?.name ?? ""}`.trim());
  return `<a class="${MARKER}-open" data-uuid="${esc(uuid)}">${label}</a>`;
}

/** Read-only face shown on a child buff. A group child lists every member. DESIGN.md §13.6 */
function childMarkup(item) {
  const flag = item.flags?.[MODULE_ID]?.[CHILD_FLAG] ?? {};
  const sources = flag.members ?? [flag.source];

  return `
<div class="${MARKER}">
  <h3 class="form-header ${MARKER}-header">
    <i class="${ICON}"></i> ${t("PF1AURAS.Sheet.Title")}
  </h3>
  <div class="${MARKER}-body">
    <p class="notes">${t("PF1AURAS.Sheet.ChildNote")}</p>
    <div class="form-group">
      <label>${t("PF1AURAS.Sheet.Source")}</label>
      <div class="form-fields ${MARKER}-sources">${sources.map(sourceLink).join("")}</div>
    </div>
  </div>
</div>`;
}

/** Editable face shown on an ordinary buff. */
function editorMarkup(cfg) {
  const checked = (on) => (on ? " checked" : "");

  // Input and text on ONE line: a newline between them becomes a leading space in the
  // anonymous flex item core's `label.checkbox` creates, widening the gap unevenly.
  const relations = RELATIONS.map(
    (rel) =>
      `<label class="checkbox"><input type="checkbox" data-field="recipients" value="${rel}"${checked(
        cfg.recipients.includes(rel)
      )}/> ${t(RELATION_LABELS[rel])}</label>`
  ).join("");

  const switches = SWITCHES.map(
    ([name, label]) =>
      `<label class="checkbox"><input type="checkbox" data-field="${name}"${checked(
        cfg[name]
      )}/> ${t(label)}</label>`
  ).join("");

  return `
<div class="${MARKER}">
  <h3 class="form-header ${MARKER}-header">
    <i class="${ICON}"></i> ${t("PF1AURAS.Sheet.Title")}
  </h3>
  <div class="${MARKER}-body">
    <div class="form-group">
      <label class="checkbox"><input type="checkbox" data-field="enabled"${checked(cfg.enabled)}/> ${t(
        "PF1AURAS.Sheet.Enabled"
      )}</label>
    </div>

    <div class="form-group">
      <label>${t("PF1AURAS.Sheet.Radius")}</label>
      <div class="form-fields">
        <input type="text" data-field="radius" value="${esc(cfg.radius)}" placeholder="30"
               title="${t("PF1AURAS.Sheet.RadiusHint")}"/>
        <span class="pfa-preview"></span>
      </div>
    </div>

    <div class="form-group">
      <label>${t("PF1AURAS.Sheet.Recipients")}</label>
      <div class="form-fields ${MARKER}-checks">${relations}</div>
    </div>
    <p class="notes">${t("PF1AURAS.Sheet.RecipientsHint")}</p>

    <div class="form-group">
      <label>${t("PF1AURAS.Sheet.Group")}</label>
      <div class="form-fields">
        <input type="text" data-field="group" value="${esc(cfg.group)}"
               placeholder="${t("PF1AURAS.Sheet.GroupPlaceholder")}"/>
      </div>
    </div>
    <p class="notes">${t("PF1AURAS.Sheet.GroupHint")}</p>

    <div class="form-group">
      <div class="form-fields ${MARKER}-checks">${switches}</div>
    </div>
  </div>
</div>`;
}

/** renderItemSheetPF handler. */
export async function inject(sheet, html, options) {
  const root = Array.isArray(html) ? html[0] : html instanceof jQuery ? html[0] : html;
  const item = sheet.document;
  if (item?.type !== "buff") return;

  const tab = root?.querySelector('.tab[data-tab="advanced"]');
  if (!tab) return;

  const child = isChild(item);
  // A child is read-only, so it renders even when the sheet isn't editable.
  if (!child && !options?.editable) return;

  const stored = read(item);
  const cfg = stored ?? normalize({}, DEFAULT_AURA);

  const holder = document.createElement("div");
  holder.innerHTML = child ? childMarkup(item) : editorMarkup(cfg);
  const section = holder.firstElementChild;
  tab.append(section);

  if (child) {
    for (const link of section.querySelectorAll(`.${MARKER}-open`)) {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        fromUuidSync(event.currentTarget.dataset.uuid)?.sheet?.render(true, { focus: true });
      });
    }
    makeCollapsible(sheet, section, { key: "aura", marker: MARKER, configured: false });
    return;
  }

  const radiusInput = section.querySelector('[data-field="radius"]');
  const refreshPreview = attachFormulaPreview(radiusInput, item.getRollData(), {
    target: section.querySelector(".pfa-preview"),
  });

  const badge = () => {
    const current = read(item) ?? cfg;
    const value = resolvedRadius(item, current);
    setBadge(section, value == null ? "" : `${value} ${canvas?.scene?.grid?.units || "ft"}`);
  };

  bindFields(section, {
    doc: item,
    base: `flags.${MODULE_ID}.${AURA_FLAG}`,
    values: cfg,
    fields: {
      enabled: { type: "checkbox", onChange: badge },
      radius: { type: "text", onChange: () => (refreshPreview?.(), badge()) },
      recipients: { type: "set" },
      group: { type: "text" },
      whileInactive: { type: "checkbox" },
      whileUnconscious: { type: "checkbox" },
      ignoreElevation: { type: "checkbox" },
    },
  });

  makeCollapsible(sheet, section, {
    key: "aura",
    marker: MARKER,
    configured: !!stored?.enabled,
    badge: "",
    title: t("PF1AURAS.Sheet.Toggle"),
    niche: true,
  });
  badge();
}

export function registerHooks() {
  Hooks.on("renderItemSheetPF", (sheet, html, options) => {
    inject(sheet, html, options).catch((err) =>
      console.error(`${MODULE_ID} | aura sheet section failed:`, err)
    );
  });
}
