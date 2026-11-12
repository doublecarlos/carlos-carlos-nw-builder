<script setup lang="ts">
// The left column: the composed catalog's collapsible sections, some 180 slots in all.
// No virtualization: only one dropdown is ever open, and that is where the per-row cost lives.
import {
  computed,
  reactive,
  ref,
  watch,
  useTemplateRef,
  nextTick,
  onBeforeUnmount,
} from "vue";
import { useActiveElement } from "@vueuse/core";
import ItemCard from "./game/ItemCard.vue";
import BasePopover from "./ui/BasePopover.vue";
import BuildSection from "./game/BuildSection.vue";
import BuildSlot from "./game/BuildSlot.vue";
import SeparatorRow from "./game/SeparatorRow.vue";
import ItemPickerListRow from "./game/ItemPickerListRow.vue";
import TextRow from "./game/TextRow.vue";
import CompareOnlyRow from "./game/CompareOnlyRow.vue";
import BaseButton from "./ui/BaseButton.vue";
import BaseInput from "./ui/BaseInput.vue";
import BaseBadge from "./ui/BaseBadge.vue";
import FilterChip from "./ui/FilterChip.vue";
import ComboBox from "./ui/ComboBox.vue";
import CheckMenu from "./ui/CheckMenu.vue";
import HistoryButtons from "./ui/HistoryButtons.vue";
import IconButton from "./ui/IconButton.vue";
import QuickOptions from "./game/QuickOptions.vue";
import QuickOptionsBand from "./game/QuickOptionsBand.vue";
import BaseTooltip from "./ui/BaseTooltip.vue";
import EditorActionsMenu from "./game/EditorActionsMenu.vue";
import BaseSheet from "./ui/BaseSheet.vue";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Crosshair,
  Replace,
  SlidersHorizontal,
  FilterX,
} from "@lucide/vue";
import { slotCandidateContext, slotCandidateList } from "../data/db";
import { statPickerOptions } from "../lib/format";
import { matchesQuery } from "../lib/text-filter";
import { slotStablePlaceholder, slotStatSummary } from "../lib/slot-summary";
import { slotsSupplying } from "../lib/bonus-slots";
import { bonusesForItem } from "../lib/candidate-preview";
import { itemStatAddress, readInput } from "../lib/build-inputs";
import * as insignia from "../engine/insignia";
import * as stableBrowser from "../stores/stableBrowser";
import { slotsWithCompare } from "../lib/slot-availability";
import { keepArray, keepEqual, keepMap, keepSet } from "../lib/keep-identity";
import {
  nestedParentId,
  parentOf,
  type NestPosition,
} from "../lib/slot-parent";
import { useHoverCard, type HoverPosition } from "../composables/useHoverCard";
import { useFoldSlide } from "../composables/useFoldSlide";
import { useKeyedCache } from "../composables/useKeyedCache";
import { useReorderMotion } from "../composables/useReorderMotion";
import {
  dragSource,
  reorderIndex,
  useDragHandles,
  useDropList,
} from "../composables/useDragAndDrop";
import { listRowCount, rowSlotId } from "../lib/item-picker-list";
import * as viewport from "../stores/viewport";
import { itemScalers } from "../composables/useItemScale";
import { useCompareDiff, type SlotDiff } from "../composables/useCompareDiff";
import { useItemUndoRedo } from "../composables/useUndoRedo";
import * as storage from "../storage/storage";
import * as builds from "../stores/builds";
import * as buildEditor from "../stores/buildEditor";
import { ringRow } from "../lib/row-slide";
import * as compare from "../stores/compare";
import * as slotFilter from "../stores/slotFilter";
import * as pickerLens from "../stores/pickerLens";
import * as engine from "../stores/resolved";
import * as editorScroll from "../stores/editorScroll";
import * as selection from "../stores/selection";
import * as layers from "../stores/layers";
import * as layerEditorUi from "../stores/layerEditorUi";
import * as goTo from "../stores/goTo";
import * as details from "../stores/details";
import { isMac } from "../lib/platform";
import { animateScrollTop, type CancelScroll } from "../lib/animate-scroll";
import { anyPickerOpen } from "../composables/useOpenPickers";
import type {
  Build,
  Item,
  ItemPickerListSlot,
  EvaluatedBonus,
  EngineError,
  Slot,
  SlotSection,
  SectionPreset,
  SupplyNeed,
} from "../types";

const root = useTemplateRef("root");
const activeElement = useActiveElement();
const tooltip = ref<InstanceType<typeof BasePopover> | null>(null);

const db = engine.db;
const props = defineProps<{ build: Build }>();
const build = computed(() => props.build);
const resolved = engine.resolved;
const bonusById = engine.bonusById;

/** Each retired item and its replacement, one per line. */
const retiredTitle = computed(() =>
  buildEditor.retired.value
    .map(({ from, to }) => `${from} → ${to ?? "no replacement"}`)
    .join("\n"),
);
const retiredReplaceable = computed(() =>
  buildEditor.retired.value.some(({ to }) => to),
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

// Which sections are open: a UI preference shared across builds and persisted on its own.
// A section with no saved entry, such as one a layer just added, starts on its `defaultOpen`.
// Entries for sections that are gone are kept, so toggling a layer remembers its state.
const savedExpanded = storage.loadUiState().expanded;
const expanded = reactive<Record<string, boolean>>({});
watch(
  () => db.value.sections,
  (sections) => {
    for (const section of sections) {
      if (section.id in expanded) continue;
      expanded[section.id] =
        savedExpanded?.[section.id] ?? section.defaultOpen !== false;
    }
  },
  { immediate: true },
);
watch(
  expanded,
  () => {
    storage.saveUiState({ expanded: { ...expanded } });
  },
  { deep: true },
);

/** How many sections the manual preference has open, for the toolbar buttons' enable state. */
const expandedSectionCount = computed(
  () => db.value.sections.filter((section) => expanded[section.id]).length,
);
const allSectionsExpanded = computed(
  () => expandedSectionCount.value === db.value.sections.length,
);
const noSectionsExpanded = computed(() => expandedSectionCount.value === 0);

// --- undo/redo ---------------------------------------------------------------------------

/** The build's own history. The buttons act on it whatever has focus; only the keyboard
 *  follows the undo scope. */
const { canUndo, canRedo, undoLabel, redoLabel, undo, redo } =
  useItemUndoRedo();

// --- slot filter -------------------------------------------------------------------------

const modKey = isMac ? "Cmd" : "Ctrl";

// The filter lives in a store because it has other authors: the Bonuses tab narrows this list
// to the slots that could supply a near miss, and the retired notice to the retired picks.
const filterText = slotFilter.text;
const filterStat = slotFilter.stat;

/** A filter set from outside the bar's own controls, shown in it as a chip. */
interface ChipFilter {
  /** Suffix of the chip's test id, `slot-filter-<key>`. */
  key: string;
  active: () => boolean;
  label: () => string;
  clearLabel: string;
  clear: () => void;
  /** Whether a row survives this filter. */
  keeps: (slotDef: Slot) => boolean;
}

const CHIP_FILTERS: ChipFilter[] = [
  {
    key: "need",
    active: () => !!slotFilter.need.value,
    label: () => `could supply ${slotFilter.label.value}`,
    clearLabel: "Clear the supply filter",
    clear: slotFilter.clearNeed,
    keeps: suppliesNeed,
  },
  // Saved with the build as part of its compare setup, unlike the others.
  {
    key: "only-diff",
    active: () => onlyDiff.value && !!compareBuild.value,
    label: () => `only changes vs ${compareBuild.value?.name}`,
    clearLabel: "Show all slots again",
    clear: () => compare.setCompareFlag("onlyDiff", false),
    keeps: rowDiffers,
  },
  {
    key: "retired",
    active: () => slotFilter.retired.value,
    label: () => "only retired items",
    clearLabel: "Clear the retired filter",
    clear: () => (slotFilter.retired.value = false),
    keeps: (slotDef) => buildEditor.retiredBySlot.value.has(slotDef.id),
  },
];

const activeChips = computed(() =>
  CHIP_FILTERS.filter((filter) => filter.active()),
);
const anyFilterActive = computed(
  () =>
    !!filterText.value.trim() ||
    !!filterStat.value ||
    activeChips.value.length > 0,
);

// The retired filter has nothing left to show once every retired item is gone.
watch(
  () => buildEditor.retired.value.length,
  (count) => {
    if (!count) slotFilter.retired.value = false;
  },
);

function clearAllFilters() {
  slotFilter.clear();
  for (const filter of activeChips.value) filter.clear();
}

const pickerOptionItems = computed(() =>
  pickerLens.OPTIONS.map((option) => ({
    key: option.key,
    label: option.label,
    checked: option.value.value,
  })),
);

const statFilterOptions = [
  { value: "", label: "All stats" },
  ...statPickerOptions,
];

/** Slots that could supply the need being filtered on, or null when none is. Off the
 *  catalog, memoized per db; see lib/bonus-slots.ts on why this can afford to ask about
 *  candidates when the stat filter below cannot. */
const supplierSlots = computed(() =>
  slotFilter.need.value
    ? slotsSupplying(db.value, slotFilter.need.value)
    : null,
);

/** Whether this slotDef's *current choice* grants the given stat -- read straight off the
 *  engine's own resolved row vector (`rowBySlot`, `EngineRow.stats`), which already sums the
 *  row's item stats (fixed and dynamic), its point_assignment items' stats (scaled by count),
 *  and any active bonus attributed to it (engine.ts's `rowVectors`) -- the same numbers the
 *  row's own stat summary is built from, untouched by any later pipeline stage. Deliberately
 *  not "could some other, not-yet-chosen candidate item grant this instead" -- that would mean
 *  re-running the engine per candidate item per slot (see ItemPicker.vue's
 *  `previewBonusStats`), and would defeat the filter's own point: finding where a stat is
 *  actually coming from in *this* build. */
function slotGrantsStat(slotDef: Slot, statKey: string): boolean {
  return !!rowBySlot.value.get(slotDef.id)?.stats[statKey];
}

/** Whether this slotDef could supply the need being filtered on. A list's rows are indexed
 *  under the container (lib/bonus-slots.ts), not under each row. The container itself
 *  counts too: the answer to "where could this come from" can be a row not added yet. */
function suppliesNeed(slotDef: Slot): boolean {
  const suppliers = supplierSlots.value;
  if (!suppliers) return false;
  if (suppliers.has(slotDef.id)) return true;
  return slotDef.type === "item_picker" && !!slotDef.list
    ? suppliers.has(slotDef.list)
    : false;
}

/** A slotDef is kept when every active chip filter keeps it and the text and stat filters
 *  match. Text matches its own label, the section's header (which pulls in every slot
 *  underneath it), its current choice's (or linked item's) name, or its rendered stat
 *  summary (`statSummary`). The stat filter and the chips always narrow the result further. */
function slotMatchesFilters(section: SlotSection, slotDef: Slot): boolean {
  if (slotDef.type === "separator" || slotDef.type === "text") return false;
  if (!activeChips.value.every((filter) => filter.keeps(slotDef))) return false;
  // A list's container is its "Add" row: no choice or stats for the text and stat filters to
  // match, so it only survives a chip that keeps it explicitly.
  if (slotDef.type === "item_picker_list") {
    if (filterStat.value || !activeChips.value.length) return false;
    return matchesQuery([section.label, slotDef.label], filterText.value);
  }
  if (filterStat.value && !slotGrantsStat(slotDef, filterStat.value))
    return false;
  return matchesQuery(
    [
      section.label,
      slotDef.label,
      itemIn(slotDef.id)?.name ?? "",
      rowDataFor(slotDef.id).statSummary,
    ],
    filterText.value,
  );
}

/** While filtering, a section with any surviving slot is forced open so its matches are
 *  actually visible -- otherwise a match inside a collapsed section would never show. The
 *  manually-toggled `expanded` state underneath is left untouched, so clearing the filter
 *  restores whatever the user had before. A section the filter hides keeps its own state, so
 *  a collapsed one does not mount its body for nothing. */
function sectionExpanded(sectionId: string) {
  if (!anyFilterActive.value) return expanded[sectionId];
  return shownSectionIds.value.has(sectionId) || expanded[sectionId];
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

function itemIn(slotId: string): Item | null {
  return rowBySlot.value.get(slotId)?.item ?? null;
}

/** The hover card's own item resolution: an item_picker/build_parameter row hovers as a
 * whole (`itemIn`, the row's single resolved item), but a point_assignment row has no
 * single item -- `itemId` names which of its rows was hovered instead (looked up straight
 * off the catalog, not off `build.assignments`, since the card should preview any row's
 * item whether or not points are currently spent on it). */
function itemForHover(slotId: string, itemId?: string): Item | null {
  return itemId ? db.value.get(itemId) : itemIn(slotId);
}

const {
  hover,
  pinned,
  fadeIn: hoverCardFadeIn,
  pin,
  togglePinned,
  onRowEnter,
  onRowLeave,
  onCardEnter,
  onCardLeave,
  onFocusIn: onHoverFocusIn,
  onFocusOut,
  closeCard,
  suppressUntilPointerMoves,
} = useHoverCard<HoverPosition>(
  tooltip,
  ({ slotId, itemId }) => itemForHover(slotId, itemId) !== null,
  { disabled: viewport.coarsePointer },
);

/** The row whose item the sheet shows, opened from that row's info button. The touch stand-in
 *  for the hover card, which a tap never opens. */
const sheetTarget = ref<HoverPosition | null>(null);

/** The row either card is about. Both read everything below off this, so the sheet and the
 *  hover card cannot show the same item differently. The sheet wins while open. */
const cardTarget = computed(() => sheetTarget.value ?? hover.value);

const cardItem = computed(() =>
  cardTarget.value
    ? itemForHover(cardTarget.value.slotId, cardTarget.value.itemId)
    : null,
);

/** The values the engine resolves for the card's item's own dynamic stats, read off the build
 *  the same way engine.ts does, so the card's typed rows show what was typed rather than the
 *  config's default. Per copy, like the card's fixed rows: the engine's own row total is this
 *  times the item's repetitions. Only for the slot's own pick; a point_assignment candidate
 *  has no typed value of its own. */
const cardDynamicValues = computed(() => {
  const item = cardItem.value;
  const slotId = cardTarget.value?.slotId;
  if (!item || !slotId || itemIn(slotId) !== item) return {};
  return dynamicValuesFor(slotId, item);
});

/** A row's info button: the sheet on a touch screen, else the card pinned under the button.
 *  It sits at the row's far right, so the card opens leftward, over the editor rather than
 *  over the stat panel. */
function onRowInfo(button: HTMLElement, slotId: string) {
  if (viewport.coarsePointer.value) {
    closeCard();
    sheetTarget.value = { slotId };
  } else togglePinned({ slotId }, button, "before");
}

/** A pinned card is about its slot, so it closes once that slot has no item left to show. */
watch(cardItem, (item) => {
  if (!item && pinned.value) closeCard();
});

/** Dismisses whichever card is showing. */
function closeCards() {
  closeCard();
  sheetTarget.value = null;
}

/** stat -> one copy's value for each of `item`'s own dynamic stats at `slotId`. */
function dynamicValuesFor(slotId: string, item: Item): Record<string, number> {
  return Object.fromEntries(
    (item.dynamicStats ?? []).map((config) => [
      config.stat,
      readInput(
        build.value,
        itemStatAddress(slotId, config.stat),
        config.default,
      ),
    ]),
  );
}

/**
 * Every bonus the card's item takes part in. A point_assignment candidate at 0 points still
 * has a (reachable, inactive) entry here -- `collect()`'s `collectAttachments` walks every
 * candidate in the slot regardless of its own count, not just the ones with points spent
 * (bonus.ts's own comment on why).
 */
const cardBonuses = computed(() => {
  const item = cardItem.value;
  return item ? bonusesForItem(db.value, item, bonusById.value) : [];
});

/** Everything ItemCard takes, for either card, or null when there is nothing to show. */
const cardProps = computed(() => {
  const item = cardItem.value;
  const target = cardTarget.value;
  if (!item || !target) return null;
  return {
    item,
    bonuses: cardBonuses.value,
    scalers: itemScalers(item),
    dynamicValues: cardDynamicValues.value,
    db: db.value,
    slotLabel: db.value.slotFor(target.slotId)?.label ?? "",
    editLabel: editLabel.value,
    stableGroup: cardStableGroup.value,
    bonusById: bonusById.value,
    context: result.value.context,
  };
});

// --- quick compare ---------------------------------------------------------------------

const { rowDiff, rowHasDiff } = useCompareDiff({
  db,
  build,
  result,
  compareBuild,
  compareResult,
  itemIn,
});

interface SectionRow extends SlotSection {
  /** Every row the section renders. Rows the filter drops stay mounted, hidden. */
  slots: Slot[];
  /** The rows the filter leaves on screen, in order: matches plus their context parents. */
  shown: Slot[];
  shownIds: ReadonlySet<string>;
  filled: number;
  errors: number;
  warnings: number;
  diffs: number;
  total: number;
  presets: SectionPreset[];
  /** Parents shown only because a nested slot of theirs matches the filter. */
  context: ReadonlySet<string>;
  /** How many point-assignment stepper columns a row can hold at most, or 0 when the section
   *  has none. BuildSection.vue gives the section one shared content track per column. */
  assignmentColumns: number;
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
  // Not a real editable row: expandSlots keeps the container alongside the rows it
  // generates, and it never gets an entry of its own in `rowHasDiff`'s map.
  if (slotDef.type === "item_picker_list") return false;
  return rowHasDiff(slotDef.id);
}

/** Whether the editor is looking at differences, which is when a slot this build hides, or a
 *  list row past its own count, gets a read-only row for what the compare build holds there. */
const showsCompareRows = computed(
  () => !!compareBuild.value && (highlightDiff.value || onlyDiff.value),
);

/** Every slotDef in canonical order, unaffected by the active text/stat filter or the
 *  only-diff toggle, unlike `sections.value`'s own per-section lists. Unavailable slots are
 *  left out, so no badge, diff or count downstream sees them, except as compare-only rows. */
const comparedSlots = computed(() =>
  slotsWithCompare(
    db.value.slots,
    build.value,
    engine.hiddenSlots.value,
    showsCompareRows.value ? compareBuild.value : null,
  ),
);
const editorSlots = computed(() => comparedSlots.value.slots);
const compareOnly = computed(() => comparedSlots.value.compareOnly);

const allSlotsBySection = computed(() =>
  db.value.sections.map((section) => ({
    section,
    slots: editorSlots.value.filter(
      (slotDef) => slotDef.section === section.id && !isQuick(slotDef),
    ),
  })),
);

/** Every section with every row, so typing in the filter flips `hidden` instead of
 *  unmounting and remounting rows. A section with no shown row is hidden the same way. Its
 *  row sets and presets keep their previous identity while unchanged, so a keystroke
 *  re-renders only the sections whose rows it changed. */
const sections = computed<SectionRow[]>((previous) =>
  allSlotsBySection.value.map(({ section, slots: allSlots }) => {
    const before = previous?.find((row) => row.id === section.id);
    // Counted off the section's full slotDef list, not the (possibly onlyDiff/filter-
    // narrowed) one below -- the badge's job is telling a *collapsed* section apart, where
    // `slots` would otherwise be invisible. Same reasoning for `unsaved`.
    const diffs = compareBuild.value ? allSlots.filter(rowDiffers).length : 0;
    const matched = allSlots.filter(
      (slotDef) =>
        !anyFilterActive.value || slotMatchesFilters(section, slotDef),
    );
    // A matching nested slot keeps its parent on screen, as context.
    const matchedIds = new Set(matched.map((slotDef) => slotDef.id));
    const wanted = new Set(matched.map((slotDef) => parentOf(slotDef)));
    const context = keepSet(
      before?.context,
      new Set(
        allSlots
          .filter(
            (slotDef) => wanted.has(slotDef.id) && !matchedIds.has(slotDef.id),
          )
          .map((slotDef) => slotDef.id),
      ),
    );
    const shown = keepArray(
      before?.shown,
      anyFilterActive.value
        ? allSlots.filter(
            (slotDef) => matchedIds.has(slotDef.id) || context.has(slotDef.id),
          )
        : allSlots,
    );
    // The fill-count badge only means anything for item_picker slots -- a build_parameter
    // always has *some* value, "filled" isn't a meaningful state for it. A section made
    // entirely of build_parameter slots ends up with total 0, so the badge just doesn't render.
    // A compare-only row is not this build's to fill.
    const pickerSlots = matched.filter(
      (slotDef) =>
        slotDef.type === "item_picker" && !compareOnly.value.has(slotDef.id),
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
    for (const slotDef of matched) {
      if (slotDef.type !== "point_assignment") continue;
      for (const error of errorsBySlot.value.get(slotDef.id) ?? []) {
        if (error.severity === "warning") warnings += 1;
        else errors += 1;
      }
    }
    const pointSlots = allSlots.filter(
      (slotDef) => slotDef.type === "point_assignment",
    );
    return {
      ...section,
      slots: allSlots,
      shown,
      shownIds: keepSet(
        before?.shownIds,
        new Set(shown.map((slotDef) => slotDef.id)),
      ),
      filled,
      errors,
      warnings,
      diffs,
      total: pickerSlots.length,
      context,
      assignmentColumns: pointSlots.length
        ? Math.max(
            ...pointSlots.map((slotDef) => db.value.forSlot(slotDef.id).length),
          )
        : 0,
      presets: keepArray(
        before?.presets,
        db.value.presets.filter((preset) => preset.section === section.id),
      ),
    };
  }),
);

/** Sections with any row on screen: all of them unless a filter is active. */
const shownSections = computed(() =>
  sections.value.filter(
    (section) => section.shown.length > 0 || !anyFilterActive.value,
  ),
);
const shownSectionIds = computed(
  () => new Set(shownSections.value.map((section) => section.id)),
);

// Opening or closing a section slides the ones below instead of jumping them.
useFoldSlide(root, () => ({
  folds: shownSections.value.map((section) => section.id),
  open: shownSections.value
    .filter((section) => sectionExpanded(section.id))
    .map((section) => section.id),
}));

/** Total rendered slots across every visible section, for the "N matches" indicator next to
 *  the filter controls. */
const filteredSlotCount = computed(() =>
  shownSections.value.reduce(
    (sum, section) => sum + section.shown.length - section.context.size,
    0,
  ),
);

/** Ids of rows whose bottom border BuildSlot.vue suppresses: those followed by a separator in
 *  the shown list, so a border and the separator's bar never double up, and each section's
 *  last shown row, which `last:` misses while hidden rows still follow it. A separator the
 *  filter hides stops suppressing its neighbour's border. */
const noBorderIds = computed(() => {
  const ids = new Set<string>();
  for (const { shown } of shownSections.value) {
    for (let i = 0; i < shown.length - 1; i += 1) {
      if (shown[i + 1].type === "separator") ids.add(shown[i].id);
    }
    const last = shown.at(-1);
    if (last) ids.add(last.id);
  }
  return ids;
});

/** Parents rendered only as context for a matching nested slot, across every section. */
const contextIds = computed(
  () => new Set(shownSections.value.flatMap((section) => [...section.context])),
);

/** Shown rows nested under a parent shown in the same section, by id, with where each sits
 *  among its siblings. A position that did not move keeps its previous object. */
const nestById = computed<Map<string, NestPosition>>((previous) => {
  const nest = new Map<string, NestPosition>();
  for (const { shown, shownIds } of shownSections.value) {
    const parents = shown.map((slotDef) => {
      const parentId = nestedParentId(slotDef, db.value.slotById);
      return parentId && shownIds.has(parentId) ? parentId : undefined;
    });
    parents.forEach((parentId, i) => {
      if (!parentId) return;
      const id = shown[i].id;
      nest.set(
        id,
        keepEqual(previous?.get(id), {
          first: parents[i - 1] !== parentId,
          last: parents[i + 1] !== parentId,
        }),
      );
    });
  }
  return nest;
});

/** slotId -> the active bonuses the engine credits to that row (`EvaluatedBonus.slotId`), the
 *  same attribution its stats follow. A bonus fed by several rows is listed on one of them only. */
const bonusesBySlot = computed(() => {
  const map = new Map<string, EvaluatedBonus[]>();
  for (const entry of result.value.bonuses) {
    if (!entry.active) continue;
    const list = map.get(entry.slotId);
    if (list) list.push(entry);
    else map.set(entry.slotId, [entry]);
  }
  return map;
});

// Withheld candidates come back too: the picker decides which to draw, so it needs both lists.
//
// An unset class/race constrains nothing: with both fields defaulting to empty, a fresh build
// would otherwise hide every restricted item with no explanation. Equipping one still flags
// the `requires X` error once a class/race is (not) chosen.
const NO_ERRORS: EngineError[] = [];

function errorsFor(slotId: string) {
  return errorsBySlot.value.get(slotId) ?? NO_ERRORS;
}

const derivedBonuses = computed(() => {
  const map = new Map<number, { name: string; counted: boolean }>();
  for (const entry of insignia.derivedBonuses(db.value, build.value)) {
    map.set(entry.group, { name: entry.item.name, counted: entry.counted });
  }
  return map;
});

/** Gates the card's way into the browser, which has nothing to apply to without a group. */
const cardStableGroup = computed(() => {
  const slotId = cardTarget.value?.slotId;
  return slotId ? (insignia.stableRef(db.value, slotId)?.group ?? null) : null;
});

/** Lands on the side the card was already showing, filtered to the item it was about. */
function openStableFromCard() {
  const group = cardStableGroup.value;
  const item = cardItem.value;
  if (!group || !item) return;
  // The sheet would trap focus away from the browser opening over it, and a pinned card would
  // sit above it.
  closeCards();
  stableBrowser.openFor(group, {
    tab: item.insigniaSlots ? "mount" : "bonus",
    query: item.name,
  });
}

/** What an insignia row reads as instead of "Insignia N.M": the shape its mount's slot takes. */
function stableLabel(slotId: string): string | undefined {
  if (insignia.stableRef(db.value, slotId)?.role !== "insignia")
    return undefined;
  const spec = insignia.specForSlot(db.value, build.value, slotId);
  return spec ? insignia.describeSlotSpec(spec) : undefined;
}

function stablePlaceholder(slotId: string): string | undefined {
  return slotStablePlaceholder(
    db.value,
    build.value,
    slotId,
    derivedBonuses.value,
  );
}

/** Everything a BuildSlot row needs, gathered once per slot instead of ~9 calls per render
 *  (`slotCandidateList` and `statSummary` aren't cheap). Covers every row, whatever the filter:
 *  collapsed bodies and filtered rows stay mounted, hidden, so they stay current, and typing in
 *  the filter never recomputes this. A field whose contents did not change keeps its previous
 *  identity, so an edit re-renders only the rows it actually changed. */
interface SlotRowData {
  item: Item | null;
  items: Item[];
  hiddenReasons: ReadonlyMap<string, string> | null;
  errors: EngineError[];
  statSummary: string;
  /** A new item can be seeded for this row (`newItemSeedFor`). */
  canCreateItem: boolean;
  placeholder: string | undefined;
  labelOverride: string | undefined;
  diff: SlotDiff | undefined;
}

const EMPTY_ROW_DATA: SlotRowData = {
  item: null,
  items: [],
  hiddenReasons: null,
  errors: [],
  statSummary: "",
  canCreateItem: false,
  placeholder: undefined,
  labelOverride: undefined,
  diff: undefined,
};

const rowDataBySlot = computed<Map<string, SlotRowData>>((previous) => {
  const map = new Map<string, SlotRowData>();
  // One context for the whole pass: the copy tally and published class are the same for every
  // row.
  const candidateContext = slotCandidateContext(db.value, build.value);
  for (const { slots } of allSlotsBySection.value) {
    for (const slotDef of slots) {
      if (
        slotDef.type === "separator" ||
        slotDef.type === "text" ||
        slotDef.type === "item_picker_list"
      )
        continue;
      const before = previous?.get(slotDef.id);
      const diff = keepEqual(before?.diff, rowDiff(slotDef.id));
      if (compareOnly.value.has(slotDef.id)) {
        map.set(slotDef.id, { ...EMPTY_ROW_DATA, diff });
        continue;
      }
      const candidates = slotCandidateList(
        db.value,
        slotDef.id,
        build.value,
        candidateContext,
      );
      map.set(slotDef.id, {
        item: itemIn(slotDef.id),
        items: keepArray(before?.items, candidates.items),
        hiddenReasons: keepMap(
          before?.hiddenReasons ?? undefined,
          candidates.reasons,
        ),
        errors: keepEqual(before?.errors, errorsFor(slotDef.id)),
        statSummary: statSummary(slotDef.id),
        canCreateItem: newItemSeedFor(slotDef.id) !== null,
        placeholder: stablePlaceholder(slotDef.id),
        labelOverride: stableLabel(slotDef.id),
        diff,
      });
    }
  }
  return map;
});

function rowDataFor(slotId: string): SlotRowData {
  return rowDataBySlot.value.get(slotId) ?? EMPTY_ROW_DATA;
}

function toggle(sectionId: string) {
  if (expanded[sectionId] && !anyFilterActive.value) {
    keepCollapsedInPlace(sectionEl(sectionId));
  }
  expanded[sectionId] = !expanded[sectionId];
}

function setAll(open: boolean) {
  if (!open && !anyFilterActive.value) keepCollapsedInPlace(stuckSectionEl());
  for (const section of db.value.sections) expanded[section.id] = open;
}

/** The section whose header is currently stuck at the top of the editor, if any. */
function stuckSectionEl() {
  const container = buildScrollEl.value;
  if (!container) return null;
  const top = container.getBoundingClientRect().top + container.clientTop;
  for (const el of container.querySelectorAll<HTMLElement>(
    "[data-section-id]",
  )) {
    const rect = el.getBoundingClientRect();
    if (rect.top < top && rect.bottom > top) return el;
  }
  return null;
}

/** Collapsing a section whose header is stuck removes rows above the viewport, and the same
 *  scrollTop would then land midway into a later section. Once collapsed, the section's top
 *  is put back at the editor's top so the next section follows right below it. */
function keepCollapsedInPlace(el: HTMLElement | null | undefined) {
  const container = buildScrollEl.value;
  if (!el || !container) return;
  const offsetFromTop = () =>
    el.getBoundingClientRect().top -
    container.getBoundingClientRect().top -
    container.clientTop;
  if (offsetFromTop() >= 0) return;
  cancelJumpScroll();
  void nextTick(() => {
    container.scrollTop += offsetFromTop();
  });
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

/** "Overwrite a preset" in a section's menu: re-snapshots the section into that preset's
 *  identity and writes it back to the layer that defines it (or, for a shipped preset, an
 *  overlay edit over it). `layers.updatePreset` posts the undo notice. */
function onUpdatePreset(preset: SectionPreset) {
  layers.updatePreset(buildEditor.presetUpdatedFromSection(preset));
}

function onRowClick(event: MouseEvent, slotId: string, itemId?: string) {
  if (!(isMac ? event.metaKey : event.ctrlKey)) return;
  const item = itemId ? db.value.get(itemId) : itemIn(slotId);
  if (item) return openInLayerEditor(item.id);
  openNewItemFor(slotId);
}

/** Opens the layer editor on a new item seeded for `slotId`, when the row has a seed. Ctrl+click
 *  on an empty row, or the picker's "New item". */
function openNewItemFor(slotId: string) {
  const seed = newItemSeedFor(slotId);
  if (seed) void layerEditorUi.openNewItem(seed);
}

/** One set of BuildSlot listeners per row, kept across renders: a fresh closure is a changed
 *  prop, which would re-render every row whenever the editor renders. */
/** The same for each BuildSection. The label is read at call time: a layer can rename the
 *  section after its handlers were cached. */
const sectionHandlers = useKeyedCache((sectionId: string) => {
  const label = () =>
    sections.value.find((section) => section.id === sectionId)?.label ?? "";
  return {
    toggle: () => toggle(sectionId),
    copy: (fromId: string) => buildEditor.copySection(fromId, [sectionId]),
    copyTo: (toIds: string[]) =>
      buildEditor.copySectionTo(toIds, [sectionId], label()),
    createPreset: () => onCreatePreset(sectionId, label()),
    clear: () => buildEditor.clearSection(sectionId, label()),
  };
});

const rowHandlers = useKeyedCache((slotId: string) => ({
  enter: (event: MouseEvent, itemId?: string) =>
    onRowEnter(event, { slotId, itemId }),
  info: (button: HTMLElement) => onRowInfo(button, slotId),
  newItem: () => openNewItemFor(slotId),
  rowclick: (event: MouseEvent, itemId?: string) =>
    onRowClick(event, slotId, itemId),
}));

// --- reordering list rows -----------------------------------------------------------------
// An item_picker_list's rows move by their grip or by Alt+arrow on the row cursor. Row ids are
// positional, so the rows a motion follows are keyed by the store's row identities instead.

const LIST_ROW_DRAG = "list-row";

interface ListRow {
  list: ItemPickerListSlot;
  /** 0-based position in the list. */
  index: number;
  /** Identity for the row motion. Carries the build id, so a build switch reads as another
   *  list and stays instant. */
  flipKey: string;
}

const listRows = computed(() => {
  const rows = new Map<string, ListRow>();
  for (const list of db.value.slots) {
    if (list.type !== "item_picker_list") continue;
    buildEditor.listRowKeys(build.value, list).forEach((key, index) =>
      rows.set(rowSlotId(list.id, index + 1), {
        list,
        index,
        flipKey: `${build.value.id}:${list.id}:${key}`,
      }),
    );
  }
  return rows;
});

// Moved rows slide to their new place and a removed row's neighbours close the gap.
useReorderMotion(root, () =>
  [...listRows.value.values()].map((row) => row.flipKey),
);

/** One drop list per section body, taking rows of the lists in that section. A row only ever
 *  moves within its own list, which the drag source names as its container. */
const sectionDrop = useKeyedCache((sectionId: string) =>
  useDropList({
    accepts: (source) =>
      source.kind === LIST_ROW_DRAG &&
      db.value.slotById.get(source.containerId)?.section === sectionId,
    onDrop: (source, gap) =>
      buildEditor.moveListRow(
        rowSlotId(source.containerId, source.index + 1),
        reorderIndex(source.index, gap) + 1,
      ),
  }),
);

/** What each section holding a list hands its body for dropping. */
const sectionDrops = computed(() => {
  const drops = new Map<
    string,
    { list: Record<string, string>; indicator: { top: string } | null }
  >();
  for (const slot of db.value.slots) {
    if (slot.type !== "item_picker_list" || drops.has(slot.section)) continue;
    const drop = sectionDrop(slot.section);
    drops.set(slot.section, {
      list: drop.listProps(),
      indicator: drop.separatorStyle.value,
    });
  }
  return drops;
});

const dragHandle = useDragHandles();

/** A list row's grip, or undefined for any other row. */
function listRowHandle(slotId: string) {
  const row = listRows.value.get(slotId);
  return (
    row &&
    dragHandle({
      kind: LIST_ROW_DRAG,
      containerId: row.list.id,
      key: row.flipKey,
      index: row.index,
    })
  );
}

/** The drop target a row of the list being dragged binds. Only rows on screen count, so a row
 *  the filter hides never stands in the way. `end` is the list's add row, the gap after its
 *  last row. */
function listDropProps(slotId: string, shown: boolean, end = false) {
  const source = dragSource.value;
  if (!shown || source?.kind !== LIST_ROW_DRAG) return undefined;
  const slot = db.value.slotById.get(slotId);
  if (end) {
    if (slot?.type !== "item_picker_list" || slot.id !== source.containerId)
      return undefined;
    return sectionDrop(slot.section).rowProps(listRowCount(build.value, slot));
  }
  const row = listRows.value.get(slotId);
  if (row?.list.id !== source.containerId) return undefined;
  return sectionDrop(row.list.section).rowProps(row.index);
}

/** Alt+arrow on a list row: moves it one step, and the cursor along with it. Focus stays put
 *  while the motion scrolls the row into view. */
const listRowMove = useKeyedCache((slotId: string) => async (dir: 1 | -1) => {
  const row = listRows.value.get(slotId);
  if (!row) return;
  const to = row.index + 1 + dir;
  if (to < 1 || to > listRowCount(build.value, row.list)) return;
  buildEditor.moveListRow(slotId, to);
  await nextTick();
  const target = root.value?.querySelector(
    `[data-cursor-key="slot:${CSS.escape(rowSlotId(row.list.id, to))}"]`,
  );
  if (target) focusRow(target, true);
});

function openInLayerEditor(itemId: string) {
  layerEditorUi.openItem(itemId);
}

/** The card is dismissed first: it would otherwise hang over the editor it just opened. */
function onCardEdit() {
  const item = cardItem.value;
  if (!item) return;
  closeCards();
  openInLayerEditor(item.id);
}

/** Dismisses a card that is not pinned, which a pinned one outlasts on purpose. */
function closeUnpinnedCards() {
  if (!pinned.value) closeCards();
}

/** Same dismissal: the row the jump lands on may be the one the card is hanging over. */
function onCardGoToSlot(slotId: string) {
  closeUnpinnedCards();
  goTo.requestJump({ slotId });
}

/** On a phone the inspector is in the other pane, so Back from there jumps to the card's row. */
function onCardInspect(bonusId: string) {
  const slotId = cardTarget.value?.slotId;
  closeUnpinnedCards();
  details.inspectBonus(
    bonusId,
    slotId ? () => goTo.requestJump({ slotId }) : undefined,
  );
}

/** Same dismissal: the filter rewrites the list under the card, likely dropping its own row. */
function onCardLocate(need: SupplyNeed, label: string) {
  closeUnpinnedCards();
  slotFilter.showSuppliersOf(need, label);
}

/** Names the destination off the same resolution `ensureTargetLayer` commits to, so the two
 *  cannot drift. Unnamed when there is no layer yet: it gets its name only once created. */
const editLabel = computed(() => {
  const target = layers.targetLayer.value;
  const where = target ? `“${target.name}”` : "a new layer";
  return viewport.coarsePointer.value
    ? `Edit this item in ${where}`
    : `Edit this item in ${where} (${modKey}+Click the row)`;
});

// A row that contributes nothing (switched off, or 0 copies) shows no summary at all, the way a
// row whose bonus is inactive already does.
function statSummary(slotId: string) {
  const row = rowBySlot.value.get(slotId);
  if (!row?.item || !row.repetitions) return "";
  return slotStatSummary(
    row.item,
    row.stats,
    bonusesBySlot.value.get(slotId) ?? [],
  );
}

/**
 * Arrow-key row navigation. There is no virtual cursor -- real focus IS the cursor, so
 * "move" means focusing the next/previous row's focus target: a header's own button, or a
 * slot row's invisible cursor anchor (BuildSlot.vue). Rows of a collapsed section stay
 * mounted but hidden, so `cursorRows` skips anything not visible.
 *
 * Held with the platform modifier, the same arrows step a whole section per press instead.
 */
/** Applies a compare-only row, which turns it into an ordinary row under the same cursor key,
 *  and keeps the cursor on it. */
async function applyCompareOnly(slotId: string) {
  buildEditor.applyFromCompare(slotId);
  await nextTick();
  const row = root.value?.querySelector(
    `[data-cursor-key="slot:${CSS.escape(slotId)}"]`,
  );
  if (row) focusRow(row);
}

function moveCursor(dir: 1 | -1, bySection = false) {
  if (bySection) moveCursorBySection(dir);
  else moveCursorByRow(dir);
}

/** Focuses a cursor row: its invisible anchor when it has one, the row itself otherwise.
 *  `preventScroll` is for callers that place the scroll themselves -- letting focus do its own
 *  minimal scroll first would show a jump, then the real one.
 *
 *  All programmatic cursor moves (arrow keys, Mod+arrow, palette and link jumps) go through
 *  here, so this is where the hover card is suppressed until the pointer moves. A mouse click
 *  focuses its row natively and skips this. */
function focusRow(row: Element, preventScroll = false) {
  const target =
    row.querySelector<HTMLElement>("[data-cursor-anchor]") ??
    (row as HTMLElement);
  target.focus({ preventScroll });
  suppressUntilPointerMoves();
}

/** Cursor rows under `scope`, minus those inside a collapsed (hidden) section body. */
function cursorRows(scope: ParentNode | null | undefined) {
  return Array.from(scope?.querySelectorAll("[data-cursor-key]") ?? []).filter(
    (row) => row.checkVisibility(),
  );
}

function moveCursorByRow(dir: 1 | -1) {
  const rows = cursorRows(root.value);
  if (!rows.length) return;
  const current = activeElement.value?.closest("[data-cursor-key]");
  const idx = current ? rows.indexOf(current) : -1;
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
  // A section the filter hides stays mounted, so it is skipped like a hidden row.
  const sectionEls = Array.from(
    root.value?.querySelectorAll("[data-section-id]") ?? [],
  ).filter((el) => el.checkVisibility());
  if (!sectionEls.length) return;
  const current = activeElement.value?.closest("[data-section-id]");
  const idx = current ? sectionEls.indexOf(current) : -1;
  const target =
    sectionEls[Math.min(Math.max(idx + dir, 0), sectionEls.length - 1)];
  // A section's own cursor rows in order: its header first, then whatever slots it renders.
  const rows = cursorRows(target);
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

/** The jump scroll in flight, if any. A new jump replaces it and teardown stops it, so no
 *  late frame ever writes to a stale container. Started by `scrollIntoEditor` below. */
let cancelJumpScroll: CancelScroll = () => {};

onBeforeUnmount(() => cancelJumpScroll());

watch(buildScrollEl, async (el) => {
  cancelJumpScroll();
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

/** How many viewport heights of a long jump are animated; the rest is snapped over first. */
const JUMP_ANIMATED_SCREENS = 2.5;

/**
 * Scrolls `el` to rest just inside the editor's top edge. `clearance` is what has to stay above
 * it: the section's own sticky header, when the target is a row underneath one.
 *
 * Measured against the scroll area's content edge rather than its border box: the list is
 * padded, and a sticky header comes to rest past that padding, so anything landing at the
 * border box top would end up underneath it.
 *
 * Animated over a constant quarter second whatever the distance, never with native smooth
 * scrolling: that is duration-by-distance, and the list is ~8000px tall, so end to end would
 * take about two seconds. A fixed beat keeps the palette's "typed its name, want it now" case
 * cheap, while a jump from a link still shows which way the list moved instead of teleporting.
 * A long jump snaps to within a screen and a half first and glides only that last stretch, so
 * it reads as arriving from the right direction rather than rows blurring past.
 */
function scrollIntoEditor(el: HTMLElement, clearance = 0) {
  const container = buildScrollEl.value;
  if (!container) return;
  const style = getComputedStyle(container);
  const inset =
    (parseFloat(style.borderTopWidth) || 0) +
    (parseFloat(style.paddingTop) || 0);
  const target =
    container.scrollTop +
    el.getBoundingClientRect().top -
    container.getBoundingClientRect().top -
    inset -
    clearance -
    SECTION_TOP_GAP;
  cancelJumpScroll();
  cancelJumpScroll = animateScrollTop(container, target, {
    maxDistance: container.clientHeight * JUMP_ANIMATED_SCREENS,
  });
}

function sectionEl(sectionId: string) {
  return buildScrollEl.value?.querySelector<HTMLElement>(
    `[data-section-id="${CSS.escape(sectionId)}"]`,
  );
}

/** Whether `row` shows in full in the editor, below its section's sticky header. */
function showsInEditor(row: HTMLElement, clearance: number) {
  const container = buildScrollEl.value;
  if (!container) return false;
  const box = container.getBoundingClientRect();
  const rect = row.getBoundingClientRect();
  return rect.top >= box.top + clearance && rect.bottom <= box.bottom;
}

// An undo or redo shows what it changed: the sections holding its rows open, the topmost row
// is scrolled into view unless it already shows, and every changed row is ringed. Several
// rows at once (a section copy undone) are all ringed; the scroll goes to the first.
watch(buildEditor.historyStep, async (step) => {
  if (!step?.slotIds.length) return;
  for (const slotId of step.slotIds) {
    const sectionId = db.value.slotFor(slotId)?.section;
    if (sectionId && !sectionExpanded(sectionId)) expanded[sectionId] = true;
  }
  await nextTick();
  const container = buildScrollEl.value;
  const rows = step.slotIds
    .map((slotId) =>
      container?.querySelector<HTMLElement>(
        `[data-cursor-key="slot:${CSS.escape(slotId)}"]`,
      ),
    )
    // A row the filter hides stays mounted but has nothing to show.
    .filter((row): row is HTMLElement => !!row?.checkVisibility())
    .sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
  const first = rows[0];
  if (!first) return;
  const header = first
    .closest("[data-section-id]")
    ?.querySelector<HTMLElement>("[data-cursor-key^='header:']");
  const clearance = header?.offsetHeight ?? 0;
  if (!showsInEditor(first, clearance)) scrollIntoEditor(first, clearance);
  rows.forEach(ringRow);
});

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
  const sectionId =
    target.sectionId ?? db.value.slotFor(target.slotId)?.section;
  if (!sectionId) return;
  if (target.slotId) {
    // A row a filter hides has nowhere to land, and "take me to this row" outranks
    // a filter left behind.
    if (anyFilterActive.value) clearAllFilters();
    expanded[sectionId] = true;
    await nextTick();
  }
  const section = sectionEl(sectionId);
  // A section the filter hides stays mounted, with nowhere to land.
  if (!section?.checkVisibility()) return;
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
  <div class="flex min-w-0 flex-1 flex-col min-h-0" data-undo-scope="editor">
    <!-- Above the section headers below, which are sticky at `z-sticky` of their own: this bar
         is positioned, so its dropdowns are stacked within it and cannot outrank a later sibling
         on their own -- the bar has to win the comparison for them. -->
    <div
      class="sticky top-0 z-toolbar flex flex-col gap-2 border-b border-line bg-surface px-3.5 py-2"
    >
      <!-- A phone has no room to keep these on screen: they scroll with the list instead. -->
      <QuickOptions
        v-if="!viewport.isPhone.value"
        class="flex-1"
        :build="build"
      />
      <div class="flex flow-wrap items-center gap-1.5">
        <BaseInput
          v-model="filterText"
          type="search"
          data-testid="slot-filter-text"
          class="slot-filter-text min-w-40 max-md:basis-full"
          :placeholder="
            viewport.coarsePointer.value
              ? 'Filter slots…'
              : `Filter slots… (${modKey}+/)`
          "
        />
        <ComboBox
          class="w-52 max-md:w-auto max-md:min-w-0 max-md:flex-1"
          data-testid="slot-filter-stat"
          :options="statFilterOptions"
          phone-screen
          screen-label="Filter by stat"
          :model-value="filterStat"
          @update:model-value="(v) => (filterStat = v)"
        />
        <BaseButton
          :disabled="!anyFilterActive"
          data-testid="slot-filter-clear"
          @click="clearAllFilters"
          ><FilterX />clear filters</BaseButton
        >
        <EditorActionsMenu
          v-if="viewport.isPhone.value"
          :can-undo="canUndo"
          :can-redo="canRedo"
          :undo-label="undoLabel"
          :redo-label="redoLabel"
          :all-expanded="allSectionsExpanded"
          :none-expanded="noSectionsExpanded"
          @undo="undo()"
          @redo="redo()"
          @set-all="setAll"
        />
        <BaseBadge
          v-if="buildEditor.retired.value.length"
          variant="warn"
          class="inline-flex items-center gap-2"
          data-testid="retired-items"
        >
          <!-- The list of what is retired lives only in the tooltip, so a tap shows it too. -->
          <BaseTooltip :text="retiredTitle" tappable>
            <span tabindex="0" data-testid="retired-items-count"
              >{{ buildEditor.retired.value.length }} retired item{{
                buildEditor.retired.value.length === 1 ? "" : "s"
              }}</span
            >
          </BaseTooltip>
          <!-- Touch has no hover to explain an icon, so these name themselves there. -->
          <BaseTooltip
            v-if="!slotFilter.retired.value"
            text="Show only the slots holding them"
          >
            <button
              type="button"
              class="tap-area flex cursor-pointer items-center gap-1"
              aria-label="Show only the slots holding retired items"
              data-testid="retired-items-show"
              @click="slotFilter.retired.value = true"
            >
              <Crosshair class="h-3.5 w-3.5" /><span
                class="hidden pointer-coarse:inline"
                >Show</span
              >
            </button>
          </BaseTooltip>
          <BaseTooltip
            v-if="retiredReplaceable"
            text="Replace every retired item that has a replacement"
          >
            <button
              type="button"
              class="tap-area flex cursor-pointer items-center gap-1"
              aria-label="Replace every retired item that has a replacement"
              data-testid="retired-items-apply"
              @click="buildEditor.applyRetiredItems()"
            >
              <Replace class="h-3.5 w-3.5" /><span
                class="hidden pointer-coarse:inline"
                >Replace all</span
              >
            </button>
          </BaseTooltip>
        </BaseBadge>
        <!-- Filters set from elsewhere (the Bonuses tab, the hover card, the compare menu,
             the retired notice) have no control here, so each says it is on and how to drop
             it. -->
        <FilterChip
          v-for="filter in activeChips"
          :key="filter.key"
          :testid="`slot-filter-${filter.key}`"
          :clear-label="filter.clearLabel"
          @clear="filter.clear()"
          >{{ filter.label() }}</FilterChip
        >
        <BaseBadge
          v-if="anyFilterActive"
          variant="near"
          data-testid="slot-filter-count"
          >{{ filteredSlotCount }} match{{
            filteredSlotCount === 1 ? "" : "es"
          }}</BaseBadge
        >
        <span
          v-if="!viewport.isPhone.value"
          class="ml-auto flex flex-wrap items-center gap-1.5 text-[16px]"
        >
          <HistoryButtons
            testid="editor"
            :can-undo="canUndo"
            :can-redo="canRedo"
            :undo-label="undoLabel"
            :redo-label="redoLabel"
            @undo="undo()"
            @redo="redo()"
          />
          <span class="mx-1 h-4 w-px bg-line"></span>
          <IconButton
            data-testid="editor-expand-all"
            title="Expand all"
            :disabled="allSectionsExpanded"
            @click="setAll(true)"
            ><ChevronsUpDown
          /></IconButton>
          <IconButton
            data-testid="editor-collapse-all"
            title="Collapse all"
            :disabled="noSectionsExpanded"
            @click="setAll(false)"
            ><ChevronsDownUp
          /></IconButton>
          <span class="mx-1 h-4 w-px bg-line"></span>
          <!-- Lenses, not filters: "clear filters" leaves them alone. -->
          <CheckMenu
            label="Picker options"
            icon-only
            title="Picker options"
            testid="picker-options"
            :items="pickerOptionItems"
            @toggle="pickerLens.toggle"
          >
            <template #icon><SlidersHorizontal /></template>
          </CheckMenu>
        </span>
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
      <QuickOptionsBand
        v-if="viewport.isPhone.value"
        class="mx-3.5 mt-3.5 w-[calc(100%-1.75rem)] rounded-md border border-line"
        :build="build"
      />
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
          :hidden="!shownSectionIds.has(section.id)"
          :label="section.label"
          :slots="section.slots"
          :shown-ids="section.shownIds"
          :filled="section.filled"
          :total="section.total"
          :errors="section.errors"
          :warnings="section.warnings"
          :diffs="section.diffs"
          :expanded="sectionExpanded(section.id)"
          :assignment-columns="section.assignmentColumns"
          :on-arrow="moveCursor"
          :highlight-diff="highlightDiff"
          :other-builds="otherBuilds"
          :presets="section.presets"
          :drop="sectionDrops.get(section.id)"
          @toggle="sectionHandlers(section.id).toggle"
          @copy="sectionHandlers(section.id).copy"
          @copy-to="sectionHandlers(section.id).copyTo"
          @apply-preset="(preset) => buildEditor.applyPreset(preset)"
          @create-preset="sectionHandlers(section.id).createPreset"
          @update-preset="onUpdatePreset"
          @clear="sectionHandlers(section.id).clear"
        >
          <template
            #default="{ slotDef, shown }: { slotDef: Slot; shown: boolean }"
          >
            <SeparatorRow
              v-if="slotDef.type === 'separator'"
              :hidden="!shown"
              :slot-def="slotDef"
              class="col-span-full"
            />
            <TextRow
              v-else-if="slotDef.type === 'text'"
              :hidden="!shown"
              :slot-def="slotDef"
              class="col-span-full"
            />
            <ItemPickerListRow
              v-else-if="slotDef.type === 'item_picker_list'"
              :hidden="!shown"
              :slot-def="slotDef"
              class="col-span-full"
              :on-arrow="moveCursor"
              v-bind="listDropProps(slotDef.id, shown, true)"
            />
            <CompareOnlyRow
              v-else-if="compareOnly.has(slotDef.id)"
              :hidden="!shown"
              :slot-def="slotDef"
              :reason="compareOnly.get(slotDef.id) ?? 'unavailable'"
              :compare-name="compareBuild?.name ?? ''"
              :other-choice-label="
                rowDataFor(slotDef.id).diff?.otherChoiceLabel ?? ''
              "
              :other-choice-quality="
                rowDataFor(slotDef.id).diff?.otherChoiceQuality
              "
              :highlight-diff="highlightDiff"
              :no-border="noBorderIds.has(slotDef.id)"
              :nest="nestById.get(slotDef.id)"
              :on-arrow="moveCursor"
              @apply="applyCompareOnly(slotDef.id)"
            />
            <BuildSlot
              v-else
              :hidden="!shown"
              :slot-def="slotDef"
              :build="build"
              :db="db"
              :compare-build="compareBuild"
              :highlight-diff="highlightDiff && !!rowDataFor(slotDef.id).diff"
              :is-hovered="hover?.slotId === slotDef.id"
              :no-border="noBorderIds.has(slotDef.id)"
              :nest="nestById.get(slotDef.id)"
              :class="[
                contextIds.has(slotDef.id) && 'opacity-60',
                dragSource &&
                  dragSource.key === listRows.get(slotDef.id)?.flipKey &&
                  'is-drag-source opacity-50',
              ]"
              :data-filter-context="contextIds.has(slotDef.id) || undefined"
              :data-flip-key="listRows.get(slotDef.id)?.flipKey"
              v-bind="listDropProps(slotDef.id, shown)"
              :on-arrow="moveCursor"
              :on-move="
                listRows.has(slotDef.id) ? listRowMove(slotDef.id) : undefined
              "
              :drag-handle="listRowHandle(slotDef.id)"
              :item="rowDataFor(slotDef.id).item"
              :items="rowDataFor(slotDef.id).items"
              :hidden-reasons="rowDataFor(slotDef.id).hiddenReasons"
              :errors="rowDataFor(slotDef.id).errors"
              :stat-summary="rowDataFor(slotDef.id).statSummary"
              :can-create-item="rowDataFor(slotDef.id).canCreateItem"
              :placeholder="rowDataFor(slotDef.id).placeholder"
              :label-override="rowDataFor(slotDef.id).labelOverride"
              :diff="rowDataFor(slotDef.id).diff"
              @enter="rowHandlers(slotDef.id).enter"
              @leave="onRowLeave"
              @info="rowHandlers(slotDef.id).info"
              @new-item="rowHandlers(slotDef.id).newItem"
              @rowclick="rowHandlers(slotDef.id).rowclick"
            />
          </template>
        </BuildSection>

        <!-- One card for the whole list, moved and refilled on hover. A pinned one steps aside
             while a picker is open, so it never covers the menu or its preview, and returns
             where it was. -->
        <BasePopover ref="tooltip" :width="320" :animate="hoverCardFadeIn">
          <ItemCard
            v-if="
              hover && !sheetTarget && cardProps && !(pinned && anyPickerOpen)
            "
            v-bind="cardProps"
            pinnable
            :pinned="pinned"
            @pin="pin"
            @close="closeCard"
            @edit="onCardEdit"
            @go-to-slot="onCardGoToSlot"
            @locate="onCardLocate"
            @inspect="onCardInspect"
            @open-stable="openStableFromCard"
            @mouseenter="onCardEnter"
            @mouseleave="onCardLeave"
          />
        </BasePopover>

        <!-- The same card for a touch screen, opened from a row's info button. -->
        <BaseSheet
          v-if="sheetTarget && cardProps"
          side="bottom"
          title="Item details"
          data-testid="item-card-sheet"
          @close="sheetTarget = null"
        >
          <div class="flex min-h-0 flex-1 flex-col p-2">
            <ItemCard
              v-bind="cardProps"
              @edit="onCardEdit"
              @go-to-slot="onCardGoToSlot"
              @locate="onCardLocate"
              @inspect="onCardInspect"
              @open-stable="openStableFromCard"
            />
          </div>
        </BaseSheet>
      </section>
    </main>
  </div>
</template>
