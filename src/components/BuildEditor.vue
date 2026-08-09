<script setup lang="ts">
// The left column: 15 collapsible sections over 180 slots.
//
// Sections start collapsed except Gear. That keeps the mounted DOM at ~15 rows
// on load; expanding everything is ~180 rows, which the browser handles fine -- only one
// dropdown is ever open, and that is where the per-row cost actually lives. No virtualisation.
import { computed, reactive, ref, watch, useTemplateRef } from "vue";
import { useActiveElement } from "@vueuse/core";
import ItemCard from "./game/ItemCard.vue";
import BasePopover from "./ui/BasePopover.vue";
import BuildSection from "./game/BuildSection.vue";
import BuildSlot from "./game/BuildSlot.vue";
import SeparatorRow from "./game/SeparatorRow.vue";
import BaseButton from "./ui/BaseButton.vue";
import BaseBadge from "./ui/BaseBadge.vue";
import ComboBox from "./ui/ComboBox.vue";
import { ChevronsDownUp, ChevronsUpDown, FilterX } from "@lucide/vue";
import { NW_SCHEMA, NW_SLOTS } from "../data/data";
import { abbr, signedStat, statPickerOptions } from "../lib/format";
import { useHoverCard } from "../composables/useHoverCard";
import {
  useCompareDiff,
  paramDiffers,
  paramDiffTitle,
  assignmentDiffers,
  assignmentDiffTitle,
} from "../composables/useCompareDiff";
import * as storage from "../storage/storage";
import * as router from "../lib/router";
import * as builds from "../stores/builds";
import * as buildEditor from "../stores/buildEditor";
import * as compare from "../stores/compare";
import * as engine from "../stores/resolved";
import * as selection from "../stores/selection";
import * as layers from "../stores/layers";
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

const filterText = ref("");
const filterStat = ref("");
const filterActive = computed(
  () => !!filterText.value.trim() || !!filterStat.value,
);

const statFilterOptions = [
  { value: "", label: "All stats" },
  ...statPickerOptions,
];

function clearFilters() {
  filterText.value = "";
  filterStat.value = "";
}

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
  if (slotDef.type === "separator") return false;
  if (filterStat.value && !slotGrantsStat(slotDef, filterStat.value))
    return false;
  const q = filterText.value.trim().toLowerCase();
  if (!q) return true;
  return (
    section.label.toLowerCase().includes(q) ||
    slotDef.label.toLowerCase().includes(q) ||
    !!itemIn(slotDef.id)?.name.toLowerCase().includes(q) ||
    statSummary(slotDef.id).toLowerCase().includes(q)
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
 * slotDef that instanced it, so the other pieces of the set would show nothing.
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

/** True for a slotDef the section body actually renders -- a `quick` build_parameter slotDef lives
 * in the always-visible QuickOptions strip instead, so it never counts toward this section's
 * badge/diff/unsaved state (it's never hidden by a collapse the way a real row can be). */
function rowDiffers(slotDef: Slot) {
  if (slotDef.type === "build_parameter")
    return paramDiffers(build.value, compareBuild.value, slotDef);
  if (slotDef.type === "point_assignment")
    return assignmentDiffers(
      db.value,
      build.value,
      compareBuild.value,
      slotDef,
    );
  return rowHasDiff(slotDef.id);
}

/** Every non-quick slotDef in canonical order, grouped by section -- unaffected by the active
 *  text/stat filter or the only-diff toggle, unlike `sections.value`'s own per-section lists.
 *  `sections` and `bonusesBySlot` both read their slot lists off this rather than off each
 *  other: `slotMatchesFilters` (used by `sections`) matches against `statSummary`, which reads
 *  `bonusesBySlot` -- if that read `sections.value` back, the two computeds would cycle. */
const allSlotsBySection = computed(() =>
  db.value.sections.map((section) => ({
    section,
    slots: db.value.slots.filter(
      (slotDef) =>
        slotDef.section === section.id &&
        !(slotDef.type === "build_parameter" && slotDef.quick),
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
 * items (a set piece requirement, or a flat bonus two items both grant) would otherwise
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

function itemsFor(slotId: string) {
  const cls = build.value.context.class;
  const race = build.value.context.race;
  // An unset class/race constrains nothing: with both slots defaulting to empty, a
  // fresh build would otherwise hide every restricted item with no explanation.
  // Equipping one still flags the `requires X` error once a class/race is (not) chosen.
  return db.value
    .forSlot(slotId)
    .filter(
      (item) =>
        (!item.allowedClass || !cls || item.allowedClass.includes(cls)) &&
        (!item.allowedRace || !race || item.allowedRace.includes(race)),
    );
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

/** A plain click parks the cursor via BuildSlot's own anchor focus; Ctrl/Cmd+click on a
 *  filled slot jumps straight to that item in the layer editor -- a no-op on an empty slot,
 *  since there is nothing there to edit. The platform's own modifier exclusively (decision 46).
 *  `itemId` names which stepper was clicked on a point_assignment row, which has no single
 *  `itemIn` resolution of its own (BuildSlot.vue's own doc comment on `onRowClick`). */
function onRowClick(event: MouseEvent, slotId: string, itemId?: string) {
  if (!(isMac ? event.metaKey : event.ctrlKey)) return;
  const item = itemId ? db.value.get(itemId) : itemIn(slotId);
  if (!item) return;
  const layer = layers.ensureTargetLayer();
  router.apply({ item: item.id });
  selection.selectLayer(layer.id);
}

/** An item_picker/point_assignment row's own "+" button: jumps to the layer editor with a
 *  fresh item draft, its filter pre-filled from this row's own `slotDef.filter` -- same
 *  navigation `onRowClick` above uses, minus the modifier-key gate since this is an explicit
 *  button rather than a repurposed click. */
function onAddItem(filter: string) {
  const layer = layers.ensureTargetLayer();
  router.apply({ item: null, newItemFilter: filter });
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
  for (const key of NW_SCHEMA.statKeys) {
    if (item[key]) totals[key] = (totals[key] ?? 0) + (item[key] as number);
  }
  // The item's own shortDescription leads, followed by every active grant crediting this
  // row that carries one -- same "attributed to the first contributing row" set the stats
  // above already dedupe through (bonusesBySlot).
  const descriptions: string[] = [];
  if (item.shortDescription) descriptions.push(item.shortDescription as string);
  for (const entry of bonusesBySlot.value.get(slotId) ?? []) {
    for (const [key, value] of Object.entries(entry.appliedStats ?? {})) {
      totals[key] = (totals[key] ?? 0) + (value as number);
    }
    for (const grant of entry.grants ?? []) {
      if (grant.active && grant.raw.shortDescription) {
        descriptions.push(grant.raw.shortDescription);
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
 */
function moveCursor(dir: 1 | -1) {
  const rows = root.value?.querySelectorAll("[data-cursor-key]");
  if (!rows?.length) return;
  const current = activeElement.value?.closest("[data-cursor-key]");
  const idx = current ? Array.from(rows).indexOf(current) : -1;
  const next = rows[Math.min(Math.max(idx + dir, 0), rows.length - 1)];
  const target =
    next.querySelector<HTMLElement>("[data-cursor-anchor]") ??
    (next as HTMLElement);
  target.focus();
}

/** Forwards the list's own `focusin` to the hover card -- see `useHoverCard`'s own doc
 *  comment for why hover suppression can't just register its own listener. The keyboard
 *  cursor needs no such forwarding: with native focus, the rows own their own keys. */
function onFocusIn(event: FocusEvent) {
  onHoverFocusIn(event);
}
</script>

<template>
  <section
    ref="root"
    class="flex flex-col gap-1.5"
    data-testid="builder-content"
    @focusin="onFocusIn"
    @focusout="onFocusOut"
  >
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
        placeholder="Filter slots…"
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
        @click="clearFilters"
        ><FilterX />clear filters</BaseButton
      >
      <BaseBadge
        v-if="filterActive"
        variant="near"
        data-testid="slot-filter-count"
        >{{ filteredSlotCount }} match{{
          filteredSlotCount === 1 ? "" : "es"
        }}</BaseBadge
      >
      <span class="flex-1"></span>
      <span class="text-sm text-muted"
        >{{ isMac ? "Cmd" : "Ctrl" }}+click a filled slot to edit in a
        layer</span
      >
    </div>

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
      @clear="buildEditor.clearSection(section.id, section.label)"
    >
      <template #default="{ slotDef }: { slotDef: Slot }">
        <SeparatorRow v-if="slotDef.type === 'separator'" :slot-def="slotDef" />
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
          :errors="errorsFor(slotDef.id)"
          :stat-summary="statSummary(slotDef.id)"
          :choice-differs="differs(slotDef.id)"
          :other-choice-label="otherChoiceLabel(slotDef.id)"
          :bonus-diffs="rowDiff(slotDef.id)?.bonuses"
          :value-differs="!!rowDiff(slotDef.id)?.value"
          :other-value="compareBuild?.values?.[slotDef.id]"
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
            slotDef.type === 'point_assignment'
              ? assignmentDiffers(db, build, compareBuild, slotDef)
              : false
          "
          :other-assignment-label="
            slotDef.type === 'point_assignment'
              ? assignmentDiffTitle(db, compareBuild, slotDef)
              : undefined
          "
          @enter="(event, itemId) => onRowEnter(event, slotDef.id, itemId)"
          @leave="onRowLeave"
          @rowclick="(event, itemId) => onRowClick(event, slotDef.id, itemId)"
          @add-item="(filter) => onAddItem(filter)"
        />
      </template>
    </BuildSection>

    <!-- One card for the whole list, moved and refilled on hover. -->
    <BasePopover ref="tooltip" :width="320">
      <ItemCard
        v-if="hover && hoveredItem"
        :item="hoveredItem"
        :bonuses="hoveredBonuses"
        :db="db"
        :slot-label="db.slotById.get(hover.slotId)?.label ?? ''"
        @mouseenter="onCardEnter"
        @mouseleave="onCardLeave"
      />
    </BasePopover>
  </section>
</template>
