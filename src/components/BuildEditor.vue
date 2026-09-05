<script setup lang="ts">
// The left column: 15 collapsible sections over 180 slots.
//
// Sections start collapsed except Gear. That keeps the mounted DOM at ~15 rows
// on load; expanding everything is ~180 rows, which the browser handles fine -- only one
// dropdown is ever open, and that is where the per-row cost actually lives. No virtualisation.
import { computed, reactive, ref, watch, useTemplateRef, nextTick } from "vue";
import { useActiveElement } from "@vueuse/core";
import ItemCard from "./game/ItemCard.vue";
import BasePopover from "./ui/BasePopover.vue";
import BuildSection from "./game/BuildSection.vue";
import BuildSlot from "./game/BuildSlot.vue";
import SeparatorRow from "./game/SeparatorRow.vue";
import ItemPickerListRow from "./game/ItemPickerListRow.vue";
import TextRow from "./game/TextRow.vue";
import BaseButton from "./ui/BaseButton.vue";
import BaseBadge from "./ui/BaseBadge.vue";
import IconButton from "./ui/IconButton.vue";
import ComboBox from "./ui/ComboBox.vue";
import QuickOptions from "./game/QuickOptions.vue";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Eye,
  EyeOff,
  FilterX,
} from "@lucide/vue";
import { NW_SCHEMA, NW_SLOTS } from "../data/data";
import { forSlotAndBuild, hiddenReasons } from "../data/db";
import { abbr, signedStat, statPickerOptions } from "../lib/format";
import { descriptionParagraphs } from "../lib/description";
import { matchesQuery } from "../lib/text-filter";
import { slotsSupplying } from "../lib/bonus-slots";
import { slotVisible } from "../lib/slot-visibility";
import { expandSlots } from "../lib/item-picker-list";
import { useHoverCard } from "../composables/useHoverCard";
import { occurrenceRowsForItem } from "../composables/useItemBonusOccurrences";
import { scaledStat } from "../engine/scaling";
import { itemScaleFactor, itemScaleNotes } from "../composables/useItemScale";
import {
  useCompareDiff,
  paramDiffers,
  paramDiffTitle,
  assignmentDiffers,
  assignmentDiffTitle,
  occurrenceDiffers,
  occurrenceDiffTitle,
} from "../composables/useCompareDiff";
import * as storage from "../storage/storage";
import * as router from "../lib/router";
import * as builds from "../stores/builds";
import * as buildEditor from "../stores/buildEditor";
import * as compare from "../stores/compare";
import * as slotFilter from "../stores/slotFilter";
import * as pickerLens from "../stores/pickerLens";
import * as engine from "../stores/resolved";
import * as editorScroll from "../stores/editorScroll";
import * as selection from "../stores/selection";
import * as layers from "../stores/layers";
import * as layerEditorUi from "../stores/layerEditorUi";
import * as goTo from "../stores/goTo";
import { isMac } from "../lib/platform";
import type {
  Item,
  EvaluatedBonus,
  EngineError,
  Slot,
  SlotSection,
  SectionPreset,
} from "../types";

const root = useTemplateRef("root");
const activeElement = useActiveElement();
const tooltip = ref<InstanceType<typeof BasePopover> | null>(null);

const db = engine.db;
const build = builds.build;
const resolved = engine.resolved;

/** The swaps "update" would make, one per line. */
const retiredTitle = computed(() =>
  buildEditor.retired.value.map(({ from, to }) => `${from} → ${to}`).join("\n"),
);

// Only ever mounted when `engine.resolved.value.ok` -- the throw documents that invariant
// instead of a defensive fallback for a state that can't happen.
const result = computed(() => {
  const r = engine.resolved.value;
  if (!r.ok) throw new Error("BuildEditor requires a resolved build");
  return r.result;
});
const compareBuild = compare.compareBuild;
const compareResult = computed(() =>
  engine.compareResolved.value?.ok ? engine.compareResolved.value.result : null,
);
const highlightDiff = computed(() => build.value.compare.highlight);
const onlyDiff = computed(() => build.value.compare.onlyDiff);
const otherBuilds = builds.otherBuilds;

// Which sections are open -- a UI preference, not a build edit, shared across every build
// rather than saved with one, persisted under its own key so it survives a reload. The default
// open state is authored per-section in `data/slots.json` (`defaultOpen`).
const savedExpanded = storage.loadUiState().expanded;
const expanded = reactive<Record<string, boolean>>({});
for (const section of NW_SLOTS.sections) {
  expanded[section.id] =
    savedExpanded?.[section.id] ?? section.defaultOpen !== false;
}
watch(
  expanded,
  () => {
    storage.saveUiState({ expanded: { ...expanded } });
  },
  { deep: true },
);

// --- slot filter -------------------------------------------------------------------------

const modKey = isMac ? "Cmd" : "Ctrl";

// The filter lives in a store because the Bonuses tab, in the other column, is a second author
// for it -- clicking a near miss narrows this list to the slots that could supply that bonus.
const filterText = slotFilter.text;
const filterStat = slotFilter.stat;
const filterActive = slotFilter.isActive;

const lensTitle = computed(() =>
  pickerLens.showHidden.value
    ? "Hide unavailable items"
    : "Show unavailable items",
);

const statFilterOptions = [
  { value: "", label: "All stats" },
  ...statPickerOptions,
];

/** Slots that could supply the bonus being filtered on, or null when none is. Off the
 *  catalogue, memoised per db+bonus -- see lib/bonus-slots.ts on why this can afford to ask
 *  about candidates when the stat filter below cannot. */
const bonusSupplierSlots = computed(() =>
  slotFilter.bonusId.value
    ? slotsSupplying(db.value, slotFilter.bonusId.value)
    : null,
);

/** Whether this slotDef's *current choice* grants the given stat -- read straight off the
 *  engine's own resolved row vector (`rowBySlot`, `EngineRow.stats`), which already sums the
 *  row's item stats, its point_assignment items' stats (scaled by count), and any active bonus
 *  attributed to it (engine.ts's `rowVectors`) -- the same numbers the row's own stat summary
 *  is built from, untouched by any later pipeline stage. Deliberately not "could some other,
 *  not-yet-chosen candidate item grant this instead" -- that would mean re-running the engine
 *  per candidate item per slot (see ItemPicker.vue's `previewBonusStats`), and would defeat the
 *  filter's own point: finding where a stat is actually coming from in *this* build. */
function slotGrantsStat(slotDef: Slot, statKey: string): boolean {
  return !!rowBySlot.value.get(slotDef.id)?.stats[statKey];
}

/** A slotDef is kept when its own label matches the text query, when the section's own
 *  header does -- a matching header pulls in every slot underneath it, unfiltered by text --
 *  when its current choice's (or linked item's) name matches, or when its rendered stat
 *  summary (the text next to the picker, `statSummary`) does. The stat filter is independent
 *  of all of that: it always narrows the result further. */
function slotMatchesFilters(section: SlotSection, slotDef: Slot): boolean {
  if (
    slotDef.type === "separator" ||
    slotDef.type === "text" ||
    slotDef.type === "item_picker_list"
  )
    return false;
  if (filterStat.value && !slotGrantsStat(slotDef, filterStat.value))
    return false;
  // Narrows the same way the stat filter does, and for the same reason: it answers "where
  // could this come from", so it must survive the text query rather than widen it. A list's
  // rows are indexed under the container (lib/bonus-slots.ts), not under each row.
  if (
    bonusSupplierSlots.value &&
    !bonusSupplierSlots.value.has(slotDef.id) &&
    !(slotDef.type === "item_picker" && slotDef.list
      ? bonusSupplierSlots.value.has(slotDef.list)
      : false)
  )
    return false;
  return matchesQuery(
    [
      section.label,
      slotDef.label,
      itemIn(slotDef.id)?.name ?? "",
      statSummary(slotDef.id),
    ],
    filterText.value,
  );
}

/** While filtering, a section with any surviving slot is forced open so its matches are
 *  actually visible -- otherwise a match inside a collapsed section would never show. The
 *  manually-toggled `expanded` state underneath is left untouched, so clearing the filter
 *  restores whatever the user had before. */
function sectionExpanded(sectionId: string) {
  return filterActive.value ? true : expanded[sectionId];
}

/** slotId -> the engine's resolved row, so the item object is never looked up twice. */
const rowBySlot = computed(
  () => new Map(result.value.rows.map((row) => [row.slotId, row])),
);

/** slotId -> [error]. Errors are rare, so a Map beats filtering per row. */
const errorsBySlot = computed(() => {
  const map = new Map<string, EngineError[]>();
  for (const error of result.value.errors) {
    const list = map.get(error.slotId);
    if (list) list.push(error);
    else map.set(error.slotId, [error]);
  }
  return map;
});

/**
 * bonusId -> resolved entry, so a hover can look up an item's bonuses without scanning
 * all 48 of them per row.
 */
const bonusById = computed(
  () => new Map(result.value.bonuses.map((bonus) => [bonus.id, bonus])),
);

function itemIn(slotId: string): Item | null {
  return rowBySlot.value.get(slotId)?.item ?? null;
}

/** The hover card's own item resolution: an item_picker/build_parameter row hovers as a
 * whole (`itemIn`, the row's single resolved item), but a point_assignment row has no
 * single item -- `itemId` names which of its rows was hovered instead (looked up straight
 * off the catalogue, not off `build.assignments`, since the card should preview any row's
 * item whether or not points are currently spent on it). */
function itemForHover(slotId: string, itemId?: string): Item | null {
  return itemId ? db.value.get(itemId) : itemIn(slotId);
}

const {
  hover,
  onRowEnter,
  onRowLeave,
  onCardEnter,
  onCardLeave,
  onFocusIn: onHoverFocusIn,
  onFocusOut,
} = useHoverCard(
  tooltip,
  (slotId, itemId) => itemForHover(slotId, itemId) !== null,
);

const hoveredItem = computed(() =>
  hover.value ? itemForHover(hover.value.slotId, hover.value.itemId) : null,
);

/**
 * Every bonus the hovered item takes part in -- its own inline ones and its sets'.
 * Not `bonuses.filter(b => b.slotId === …)`: a set bonus is attributed to the single
 * slotDef that instanced it, so the other items in the set would show nothing. A
 * point_assignment candidate at 0 points still has a (reachable, inactive) entry here --
 * `collect()`'s `collectAttachments` walks every candidate in the slot regardless of its own
 * count, not just the ones with points spent (bonus.ts's own comment on why).
 */
const hoveredBonuses = computed(() => {
  const item = hoveredItem.value;
  if (!item) return [];
  const seen = new Set<string>();
  const out: EvaluatedBonus[] = [];
  for (const entry of db.value.bonusesFor(item)) {
    const resolved = bonusById.value.get(entry.bonus.id);
    if (resolved && !seen.has(resolved.id)) {
      seen.add(resolved.id);
      out.push(resolved);
    }
  }
  return out;
});

/** The hovered item's own BonusOccurrenceConfig rows -- lets ItemCard.vue's inactive-bonus
 *  rendering explain a row that's inactive because *this* item's own count is 0, the same
 *  data ItemPickerRow.vue's checkbox/stepper inputs already read. */
const hoveredOccurrenceRows = computed(() =>
  occurrenceRowsForItem(hoveredItem.value),
);

// --- quick compare ---------------------------------------------------------------------

const { differs, otherChoiceLabel, rowDiff, rowHasDiff } = useCompareDiff({
  db,
  build,
  result,
  compareBuild,
  compareResult,
  itemIn,
});

interface SectionRow extends SlotSection {
  slots: Slot[];
  filled: number;
  errors: number;
  warnings: number;
  diffs: number;
  total: number;
  presets: SectionPreset[];
}

/** True for a slotDef that renders in the always-visible QuickOptions strip instead of its own
 * section body, and so never counts toward that section's badge/diff/unsaved state. */
function isQuick(slotDef: Slot) {
  return (
    (slotDef.type === "build_parameter" || slotDef.type === "item_picker") &&
    !!slotDef.quick
  );
}

function rowDiffers(slotDef: Slot) {
  if (slotDef.type === "item_picker_list") return false;
  if (slotDef.type === "build_parameter")
    return paramDiffers(build.value, compareBuild.value, slotDef);
  if (slotDef.type === "point_assignment")
    return assignmentDiffers(
      db.value,
      build.value,
      compareBuild.value,
      slotDef,
    );
  // An item_picker's pick can repeat inline -- a count `rowHasDiff` (choice/value/bonus) knows
  // nothing about.
  if (slotDef.type === "item_picker")
    return (
      rowHasDiff(slotDef.id) ||
      assignmentDiffers(db.value, build.value, compareBuild.value, slotDef)
    );
  return rowHasDiff(slotDef.id);
}

/** Every non-quick slotDef in canonical order, grouped by section -- unaffected by the active
 *  text/stat filter or the only-diff toggle, unlike `sections.value`'s own per-section lists.
 *  `sections` and `bonusesBySlot` both read their slot lists off this rather than off each
 *  other: `slotMatchesFilters` (used by `sections`) matches against `statSummary`, which reads
 *  `bonusesBySlot` -- if that read `sections.value` back, the two computeds would cycle.
 *
 *  `visibleWhen` is applied here rather than alongside the text/stat filter below so that
 *  everything downstream agrees a hidden param is not on screen: the section's own diff and
 *  error badges stop counting it, and `bonusesBySlot` stops crediting a shared bonus to a row
 *  nobody can see (which would hide the bonus from the summary entirely). */
const editorSlots = computed(() => expandSlots(db.value.slots, build.value));

const allSlotsBySection = computed(() =>
  db.value.sections.map((section) => ({
    section,
    slots: editorSlots.value.filter(
      (slotDef) =>
        slotDef.section === section.id &&
        !isQuick(slotDef) &&
        slotVisible(slotDef, result.value.context),
    ),
  })),
);

const sections = computed<SectionRow[]>(() => {
  const onlyDiffAndComparing = onlyDiff.value && compareBuild.value;
  return allSlotsBySection.value
    .map(({ section, slots: allSlots }) => {
      // Counted off the section's full slotDef list, not the (possibly onlyDiff/filter-
      // narrowed) one below -- the badge's job is telling a *collapsed* section apart, where
      // `slots` would otherwise be invisible. Same reasoning for `unsaved`.
      const diffs = compareBuild.value ? allSlots.filter(rowDiffers).length : 0;
      const slots = allSlots.filter((slotDef) => {
        if (onlyDiffAndComparing && !rowDiffers(slotDef)) return false;
        if (filterActive.value && !slotMatchesFilters(section, slotDef))
          return false;
        return true;
      });
      // The fill-count badge only means anything for item_picker slots -- a build_parameter
      // always has *some* value, "filled" isn't a meaningful state for it. A section made
      // entirely of build_parameter slots ends up with total 0, so the badge just doesn't render.
      const pickerSlots = slots.filter(
        (slotDef) => slotDef.type === "item_picker",
      );
      let filled = 0;
      let errors = 0;
      let warnings = 0;
      for (const slotDef of pickerSlots) {
        if (rowBySlot.value.get(slotDef.id)?.item) filled += 1;
        for (const error of errorsBySlot.value.get(slotDef.id) ?? []) {
          if (error.severity === "warning") warnings += 1;
          else errors += 1;
        }
      }
      // point_assignment slots can also produce errors (class/maxCopies/outOfRange, per-item
      // rather than per-slot), but they never count toward `filled` -- like build_parameter, a
      // point_assignment slot always has *some* value, so "filled" isn't meaningful for it.
      for (const slotDef of slots) {
        if (slotDef.type !== "point_assignment") continue;
        for (const error of errorsBySlot.value.get(slotDef.id) ?? []) {
          if (error.severity === "warning") warnings += 1;
          else errors += 1;
        }
      }
      return {
        ...section,
        slots,
        filled,
        errors,
        warnings,
        diffs,
        total: pickerSlots.length,
        presets: db.value.presets.filter(
          (preset) => preset.section === section.id,
        ),
      };
    })
    .filter(
      (section) =>
        section.slots.length > 0 ||
        (!onlyDiffAndComparing && !filterActive.value),
    );
});

/** Total rendered slots across every visible section, for the "N matches" indicator next to
 *  the filter controls. */
const filteredSlotCount = computed(() =>
  sections.value.reduce((sum, section) => sum + section.slots.length, 0),
);

/** Ids of rows immediately followed by a separator in their section's rendered slot list --
 *  BuildSlot.vue suppresses its own bottom border for these, so a row's border and the
 *  separator's own bar never double up right next to each other. Derived from the same
 *  (possibly onlyDiff-filtered) list actually rendered, so a filtered-out separator correctly
 *  stops suppressing its neighbour's border. */
const noBorderIds = computed(() => {
  const ids = new Set<string>();
  for (const section of sections.value) {
    for (let i = 0; i < section.slots.length - 1; i += 1) {
      if (section.slots[i + 1].type === "separator")
        ids.add(section.slots[i].id);
    }
  }
  return ids;
});

/**
 * slotId -> active bonuses to credit to *that* row's inline summary, one row-line per
 * bonus rather than a name attached to raw numbers. A bonus fed by several equipped
 * items (an occurrence-count requirement, or a flat bonus two items both grant) would otherwise
 * print on every one of their rows -- read together that looks like each item grants it
 * independently, when really they share credit for one thing. Google Sheets' own
 * summary sidesteps this by crediting a shared bonus to only the first contributing row;
 * this walks the slots in the same canonical (not display/expanded) order and does the
 * same, via a `shown` set threaded through the whole pass.
 */
const bonusesBySlot = computed(() => {
  const shown = new Set<string>();
  const map = new Map<string, EvaluatedBonus[]>();
  for (const { slots } of allSlotsBySection.value) {
    for (const slotDef of slots) {
      const item = itemIn(slotDef.id);
      if (!item) continue;
      const entries: EvaluatedBonus[] = [];
      for (const raw of db.value.bonusesFor(item)) {
        const resolved = bonusById.value.get(raw.bonus.id);
        if (!resolved?.active || shown.has(resolved.id)) continue;
        shown.add(resolved.id);
        entries.push(resolved);
      }
      if (entries.length) map.set(slotDef.id, entries);
    }
  }
  return map;
});

// An unset class/race constrains nothing: with both fields defaulting to empty, a fresh build
// would otherwise hide every restricted item with no explanation. Equipping one still flags
// the `requires X` error once a class/race is (not) chosen.
function itemsFor(slotId: string) {
  return forSlotAndBuild(db.value, slotId, build.value, {
    includeHidden: pickerLens.showHidden.value,
  });
}

/** Only computed while the lens is on: with it off nothing is re-shown, so nothing needs a
 *  reason and the second pass over the candidates is pure cost. */
function hiddenReasonsFor(slotId: string) {
  return pickerLens.showHidden.value
    ? hiddenReasons(db.value, slotId, build.value)
    : null;
}

function errorsFor(slotId: string) {
  return errorsBySlot.value.get(slotId) ?? [];
}

function toggle(sectionId: string) {
  expanded[sectionId] = !expanded[sectionId];
}

function setAll(open: boolean) {
  for (const section of db.value.sections) expanded[section.id] = open;
}

/** What a brand-new item would need to become a candidate for this row: its `filter`, or its
 *  `tags` when the slot selects by tag instead (`ItemPickerSlot`'s own doc comment on why the
 *  two are exclusive). Only an item_picker offers one -- a build_parameter has neither field to
 *  pre-fill, and a point_assignment row is never actually empty (every one of them ships with
 *  candidate items) while Ctrl/Cmd+click already means "jump to this stepper's bound" across
 *  most of its width.
 *
 *  A tag-selected slot names no filter of its own, yet ItemForm requires one to save at all --
 *  so the seed borrows whatever filter this slot's existing candidates already share, a new one
 *  having no reason to differ. Blank when the slot has no candidates to learn from. */
function newItemSeedFor(slotId: string): Item | null {
  const slotDef = db.value.slotFor(slotId);
  if (slotDef?.type !== "item_picker") return null;
  if (slotDef.filter) return { id: "", name: "", filter: slotDef.filter };
  if (!slotDef.tags?.length) return null;
  return {
    id: "",
    name: "",
    filter: db.value.forSlot(slotId)[0]?.filter ?? "",
    tags: [...slotDef.tags],
  };
}

/** A plain click parks the cursor via BuildSlot's own anchor focus; Ctrl/Cmd+click jumps into
 *  the layer editor -- straight to the row's item when it has one, and otherwise to a fresh
 *  item draft already narrowed to what the row can hold (`newItemSeedFor`), making an empty row
 *  the way into authoring the item that belongs there. The platform's own modifier exclusively
 *  (decision 46).
 *  `itemId` names which stepper was clicked on a point_assignment row, which has no single
 *  `itemIn` resolution of its own (BuildSlot.vue's own doc comment on `onRowClick`). */
/** "Create new from current" in a section's preset menu: snapshots the section into a preset
 *  shape and jumps to the layer editor holding it as an unsaved draft, so the user names it and
 *  saves it there. Deliberately not a silent save -- a preset needs a label to be worth
 *  anything, and the draft form is where every other preset field is edited anyway. */
function onCreatePreset(sectionId: string, sectionLabel: string) {
  layerEditorUi.seedNewPreset(
    buildEditor.presetFromSection(sectionId, `${sectionLabel} preset`),
  );
  const layer = layers.ensureTargetLayer();
  selection.selectLayer(layer.id);
}

/** "Update from current" on one preset in a section's menu: re-snapshots the section into that
 *  preset's identity and writes it back to the layer that defines it (or, for a shipped preset,
 *  an overlay edit over it). PresetMenu confirms before this fires -- see its own comment on
 *  why an overwrite here needs one. */
function onUpdatePreset(preset: SectionPreset) {
  layers.updatePreset(buildEditor.presetUpdatedFromSection(preset));
}

function onRowClick(event: MouseEvent, slotId: string, itemId?: string) {
  if (!(isMac ? event.metaKey : event.ctrlKey)) return;
  const item = itemId ? db.value.get(itemId) : itemIn(slotId);
  const seed = item ? null : newItemSeedFor(slotId);
  if (!item && !seed) return;
  if (seed) layerEditorUi.seedNewItem(seed);
  const layer = layers.ensureTargetLayer();
  router.apply({ item: item?.id ?? null });
  selection.selectLayer(layer.id);
}

/**
 * Condensed, single-line stat summary for a row: the item's own stats plus whatever
 * active bonuses are credited to this slotDef (`bonusesBySlot`), summed together key by key
 * rather than attributed separately -- one number per stat, not a name-tagged breakdown.
 */
function statSummary(slotId: string) {
  const item = itemIn(slotId);
  if (!item) return "";
  const totals: Record<string, number> = {};
  // Scaled the same way the pipeline scales it, so the row's summary and the panel's totals
  // never disagree. The bonus stats folded in below are not the item's to scale.
  const factor = itemScaleFactor(item);
  for (const key of NW_SCHEMA.statKeys) {
    if (item[key])
      totals[key] =
        (totals[key] ?? 0) + scaledStat(NW_SCHEMA, item, key, factor);
  }
  // The item's own shortDescription leads, followed by every active grant crediting this
  // row that carries one -- same "attributed to the first contributing row" set the stats
  // above already dedupe through (bonusesBySlot).
  //
  // A description's paragraphs join the summary as separate parts, so the break an author
  // typed reads here as the same separator that already divides one stat from the next.
  const descriptions: string[] = [];
  descriptions.push(...descriptionParagraphs(item.shortDescription));
  for (const entry of bonusesBySlot.value.get(slotId) ?? []) {
    for (const [key, value] of Object.entries(entry.appliedStats ?? {})) {
      totals[key] = (totals[key] ?? 0) + (value as number);
    }
    for (const grant of entry.grants ?? []) {
      if (grant.active) {
        descriptions.push(...descriptionParagraphs(grant.raw.shortDescription));
      }
    }
  }
  const parts = [...descriptions];
  for (const key of NW_SCHEMA.statKeys) {
    if (!totals[key]) continue;
    parts.push(`${abbr(key)} ${signedStat(key, totals[key])}`);
  }
  return parts.join(" • ");
}

/**
 * Arrow-key row navigation. There is no virtual cursor -- real focus IS the cursor, so
 * "move" means focusing the next/previous row's focus target: a header's own button, or a
 * slot row's invisible cursor anchor (BuildSlot.vue). Collapsed and only-diff sections
 * simply don't render their rows, so DOM order equals what's visible.
 *
 * Held with the platform modifier, the same arrows step a whole section per press instead.
 */
function moveCursor(dir: 1 | -1, bySection = false) {
  if (bySection) moveCursorBySection(dir);
  else moveCursorByRow(dir);
}

/** Focuses a cursor row: its invisible anchor when it has one, the row itself otherwise.
 *  `preventScroll` is for callers that place the scroll themselves -- letting focus do its own
 *  minimal scroll first would show a jump, then the real one. */
function focusRow(row: Element, preventScroll = false) {
  const target =
    row.querySelector<HTMLElement>("[data-cursor-anchor]") ??
    (row as HTMLElement);
  target.focus({ preventScroll });
}

function moveCursorByRow(dir: 1 | -1) {
  const rows = root.value?.querySelectorAll("[data-cursor-key]");
  if (!rows?.length) return;
  const current = activeElement.value?.closest("[data-cursor-key]");
  const idx = current ? Array.from(rows).indexOf(current) : -1;
  focusRow(rows[Math.min(Math.max(idx + dir, 0), rows.length - 1)]);
}

/**
 * Mod+arrow: one whole section per press, landing on the section's first slot -- or on its
 * header when the section is collapsed and has no slot to land on. The header is a cursor row
 * in its own right and Enter on it expands, so a collapsed section reads as a stop with an
 * obvious next step rather than something the cursor silently skipped over.
 *
 * Strictly the previous/next section, even from the middle of a long one: pressing back and
 * forth then always lands in the same two places, which "top of this section first, then the
 * previous one" does not.
 */
function moveCursorBySection(dir: 1 | -1) {
  const sectionEls = Array.from(
    root.value?.querySelectorAll("[data-section-id]") ?? [],
  );
  if (!sectionEls.length) return;
  const current = activeElement.value?.closest("[data-section-id]");
  const idx = current ? sectionEls.indexOf(current) : -1;
  const target =
    sectionEls[Math.min(Math.max(idx + dir, 0), sectionEls.length - 1)];
  // A section's own cursor rows in order: its header first, then whatever slots it renders.
  const rows = target.querySelectorAll("[data-cursor-key]");
  const row = rows[1] ?? rows[0];
  if (row) focusRow(row);
}

/** Forwards the list's own `focusin` to the hover card -- see `useHoverCard`'s own doc
 *  comment for why hover suppression can't just register its own listener. The keyboard
 *  cursor needs no such forwarding: with native focus, the rows own their own keys. */
function onFocusIn(event: FocusEvent) {
  onHoverFocusIn(event);
}

// --- build editor scroll position ------------------------------------------------------
// Selecting a layer unmounts this element (the layer editor takes over columns 2-3), so
// restoring scrollTop on mount is what makes switching back to the build feel like it never
// left, instead of snapping back to the top of the list.
const buildScrollEl = useTemplateRef<HTMLElement>("buildScrollEl");

watch(buildScrollEl, async (el) => {
  if (!el) return;
  await nextTick();
  el.scrollTop = editorScroll.buildScrollTop.value;
});

function onBuildScroll(event: Event) {
  editorScroll.buildScrollTop.value = (event.target as HTMLElement).scrollTop;
}

// --- "go to" jumps -----------------------------------------------------------------------

/** How far below the scroll area's top edge a jumped-to target comes to rest, so it does not
 *  sit flush against the border. */
const SECTION_TOP_GAP = 6;

/**
 * Scrolls `el` to rest just inside the editor's top edge. `clearance` is what has to stay above
 * it -- the section's own sticky header, when the target is a row underneath one.
 *
 * Measured against the scroll area's content edge rather than its border box: the list is
 * padded, and a sticky header comes to rest past that padding, so anything landing at the
 * border box top would end up underneath it.
 *
 * Never animated. Smooth scrolling is duration-by-distance and the list is ~8000px tall, so end
 * to end takes about two seconds -- which is latency, for somewhere reached by typing its name.
 */
function scrollIntoEditor(el: HTMLElement, clearance = 0) {
  const container = buildScrollEl.value;
  if (!container) return;
  const style = getComputedStyle(container);
  const inset =
    (parseFloat(style.borderTopWidth) || 0) +
    (parseFloat(style.paddingTop) || 0);
  container.scrollTop +=
    el.getBoundingClientRect().top -
    container.getBoundingClientRect().top -
    inset -
    clearance -
    SECTION_TOP_GAP;
}

function sectionEl(sectionId: string) {
  return buildScrollEl.value?.querySelector<HTMLElement>(
    `[data-section-id="${CSS.escape(sectionId)}"]`,
  );
}

/**
 * The "go to" palette's destination, once it is this editor's turn to act on it (the palette
 * can be used while the Layer editor holds the columns, in which case the request waits in the
 * store until this mounts).
 *
 * A slot target *does* open its section first -- the one place navigation here rewrites the
 * open/closed layout, and deliberately so: Mod+arrow lands on a section header, which exists
 * either way, but a row inside a collapsed section has nothing to land on at all.
 */
async function runJump(target: goTo.JumpTarget) {
  goTo.consumeJump();
  if (target.slotId && !expanded[target.sectionId]) {
    expanded[target.sectionId] = true;
    await nextTick();
  }
  const section = sectionEl(target.sectionId);
  if (!section) return;
  const header = section.querySelector<HTMLElement>(
    "[data-cursor-key^='header:']",
  );
  const row = target.slotId
    ? section.querySelector<HTMLElement>(
        `[data-cursor-key="slot:${CSS.escape(target.slotId)}"]`,
      )
    : null;
  // Every jump parks the keyboard cursor, not just scrolls: the palette dismisses itself, so
  // it has to hand focus to the destination or leave it on <body>. A slot lands on its own
  // row, ready for Enter/type-ahead; a whole-section jump lands on the header, which is a
  // cursor row in its own right and is there whether the section is open or not -- the same
  // place Mod+arrow lands for a collapsed section.
  const cursorTarget = row ?? header;
  if (cursorTarget) focusRow(cursorTarget, true);
  if (row) scrollIntoEditor(row, header?.offsetHeight ?? 0);
  else scrollIntoEditor(section);
}

watch(
  () => goTo.jump.value,
  async (target) => {
    if (!target) return;
    await nextTick();
    await runJump(target);
  },
  { immediate: true, flush: "post" },
);
</script>

<template>
  <div class="flex min-w-0 flex-1 flex-col min-h-0">
    <!-- Above the section headers below, which are sticky at `z-10` of their own: this bar is
         positioned, so its dropdowns are stacked within it and cannot outrank a later sibling
         on their own -- the bar has to win the comparison for them. -->
    <div
      class="sticky top-0 z-20 flex flex-col flex-wrap gap-3 border-b border-line bg-surface px-3.5 py-2"
    >
      <QuickOptions class="flex-1" />
      <div class="flex flex-wrap items-center gap-1.5">
        <BaseButton @click="setAll(true)"
          ><ChevronsUpDown />expand all</BaseButton
        >
        <BaseButton @click="setAll(false)"
          ><ChevronsDownUp />collapse all</BaseButton
        >
        <input
          v-model="filterText"
          type="search"
          data-testid="slot-filter-text"
          class="slot-filter-text min-w-40 rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
          :placeholder="`Filter slots… (${modKey}+/)`"
        />
        <ComboBox
          class="w-52"
          data-testid="slot-filter-stat"
          :options="statFilterOptions"
          :model-value="filterStat"
          @update:model-value="(v) => (filterStat = v)"
        />
        <BaseButton
          :disabled="!filterActive"
          data-testid="slot-filter-clear"
          @click="slotFilter.clear()"
          ><FilterX />clear filters</BaseButton
        >
        <!-- The bonus filter has no control of its own here -- it is set from the Bonuses
             tab -- so it needs something on screen saying it is on and how to drop it. -->
        <BaseBadge
          v-if="slotFilter.bonusId.value"
          variant="near"
          data-testid="slot-filter-bonus"
        >
          could supply {{ slotFilter.bonusLabel.value }}
          <button
            type="button"
            class="ml-1 cursor-pointer font-semibold"
            aria-label="Clear the bonus filter"
            data-testid="slot-filter-bonus-clear"
            @click="slotFilter.clearBonus()"
          >
            ✕
          </button>
        </BaseBadge>
        <BaseBadge
          v-if="buildEditor.retired.value.length"
          variant="near"
          data-testid="retired-items"
          :title="retiredTitle"
        >
          {{ buildEditor.retired.value.length }} retired item{{
            buildEditor.retired.value.length === 1 ? "" : "s"
          }}
          <button
            type="button"
            class="ml-1 cursor-pointer font-semibold underline"
            data-testid="retired-items-apply"
            @click="buildEditor.applyRetiredItems()"
          >
            update
          </button>
        </BaseBadge>
        <BaseBadge
          v-if="filterActive"
          variant="near"
          data-testid="slot-filter-count"
          >{{ filteredSlotCount }} match{{
            filteredSlotCount === 1 ? "" : "es"
          }}</BaseBadge
        >
        <!-- Last and pushed to the far edge: a lens, not a filter -- it widens what the
             pickers offer rather than narrowing the slot list the rest of this bar acts on,
             and "clear filters" leaves it alone. -->
        <IconButton
          class="ml-auto"
          :class="pickerLens.showHidden.value && 'bg-accent-soft text-accent'"
          :title="lensTitle"
          :aria-pressed="pickerLens.showHidden.value"
          data-testid="show-hidden-toggle"
          @click="pickerLens.toggle()"
        >
          <Eye v-if="pickerLens.showHidden.value" />
          <EyeOff v-else />
        </IconButton>
      </div>
    </div>

    <!-- Engine error -->
    <main
      v-if="!resolved.ok"
      class="flex-1 min-h-0 overflow-y-auto p-6 text-danger"
    >
      <h2 class="text-lg font-semibold">The engine threw</h2>
      <p>{{ resolved.message }}</p>
      <pre class="overflow-x-auto rounded-md bg-surface p-3">{{
        resolved.stack
      }}</pre>
    </main>

    <!-- Build editor -->
    <main
      v-else
      ref="buildScrollEl"
      class="flex-1 min-h-0 overflow-y-auto"
      data-testid="editor-column"
      @scroll="onBuildScroll"
    >
      <!-- The list's padding lives here rather than on the scroll container: a scroll
             container does not clip inside its own padding, so section headers sticking at
             `top: 0` would have rows scrolling visibly through the band above them. -->
      <section
        ref="root"
        class="flex flex-col gap-1.5 p-3.5"
        data-testid="builder-content"
        @focusin="onFocusIn"
        @focusout="onFocusOut"
      >
        <BuildSection
          v-for="section in sections"
          :id="section.id"
          :key="section.id"
          :label="section.label"
          :slots="section.slots"
          :filled="section.filled"
          :total="section.total"
          :errors="section.errors"
          :warnings="section.warnings"
          :diffs="section.diffs"
          :expanded="sectionExpanded(section.id)"
          :on-arrow="moveCursor"
          :highlight-diff="highlightDiff"
          :other-builds="otherBuilds"
          :presets="section.presets"
          @toggle="toggle(section.id)"
          @copy="(fromId) => buildEditor.copySection(fromId, [section.id])"
          @apply-preset="(preset) => buildEditor.applyPreset(preset)"
          @create-preset="onCreatePreset(section.id, section.label)"
          @update-preset="onUpdatePreset"
          @clear="buildEditor.clearSection(section.id, section.label)"
        >
          <template #default="{ slotDef }: { slotDef: Slot }">
            <SeparatorRow
              v-if="slotDef.type === 'separator'"
              :slot-def="slotDef"
            />
            <TextRow v-else-if="slotDef.type === 'text'" :slot-def="slotDef" />
            <ItemPickerListRow
              v-else-if="slotDef.type === 'item_picker_list'"
              :slot-def="slotDef"
              :on-arrow="moveCursor"
            />
            <BuildSlot
              v-else
              :slot-def="slotDef"
              :build="build"
              :db="db"
              :compare-build="compareBuild"
              :highlight-diff="highlightDiff"
              :is-hovered="hover?.slotId === slotDef.id"
              :no-border="noBorderIds.has(slotDef.id)"
              :on-arrow="moveCursor"
              :item="itemIn(slotDef.id)"
              :items="itemsFor(slotDef.id)"
              :hidden-reasons="hiddenReasonsFor(slotDef.id)"
              :errors="errorsFor(slotDef.id)"
              :stat-summary="statSummary(slotDef.id)"
              :choice-differs="differs(slotDef.id)"
              :other-choice-label="otherChoiceLabel(slotDef.id)"
              :bonus-diffs="rowDiff(slotDef.id)?.bonuses"
              :value-diffs="rowDiff(slotDef.id)?.values ?? []"
              :occurrence-differs="
                occurrenceDiffers(itemIn(slotDef.id), build, compareBuild)
              "
              :other-occurrence-label="
                occurrenceDiffTitle(db, itemIn(slotDef.id), compareBuild)
              "
              :param-differs="
                slotDef.type === 'build_parameter'
                  ? paramDiffers(build, compareBuild, slotDef)
                  : false
              "
              :other-param-label="
                slotDef.type === 'build_parameter'
                  ? paramDiffTitle(compareBuild, slotDef)
                  : undefined
              "
              :assignment-differs="
                slotDef.type === 'item_picker' ||
                slotDef.type === 'point_assignment'
                  ? assignmentDiffers(db, build, compareBuild, slotDef)
                  : false
              "
              :other-assignment-label="
                slotDef.type === 'item_picker' ||
                slotDef.type === 'point_assignment'
                  ? assignmentDiffTitle(db, build, compareBuild, slotDef)
                  : undefined
              "
              @enter="(event, itemId) => onRowEnter(event, slotDef.id, itemId)"
              @leave="onRowLeave"
              @rowclick="
                (event, itemId) => onRowClick(event, slotDef.id, itemId)
              "
            />
          </template>
        </BuildSection>

        <!-- One card for the whole list, moved and refilled on hover. -->
        <BasePopover ref="tooltip" :width="320">
          <ItemCard
            v-if="hover && hoveredItem"
            :item="hoveredItem"
            :bonuses="hoveredBonuses"
            :occurrence-rows="hoveredOccurrenceRows"
            :scale="itemScaleFactor(hoveredItem)"
            :scale-notes="itemScaleNotes(hoveredItem)"
            :db="db"
            :slot-label="db.slotFor(hover.slotId)?.label ?? ''"
            @mouseenter="onCardEnter"
            @mouseleave="onCardLeave"
          />
        </BasePopover>
      </section>
    </main>
  </div>
</template>
