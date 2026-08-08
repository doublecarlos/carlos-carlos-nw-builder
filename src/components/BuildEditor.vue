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
import BaseButton from "./ui/BaseButton.vue";
import { ChevronsDownUp, ChevronsUpDown } from "@lucide/vue";
import { NW_SCHEMA, NW_SLOTS } from "../data/data";
import { abbr, signedStat } from "../lib/format";
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

const sections = computed<SectionRow[]>(() => {
  const onlyDiffAndComparing = onlyDiff.value && compareBuild.value;
  return db.value.sections
    .map((section) => {
      const allSlots = db.value.slots.filter(
        (slotDef) =>
          slotDef.section === section.id &&
          !(slotDef.type === "build_parameter" && slotDef.quick),
      );
      // Counted off the section's full slotDef list, not the (possibly onlyDiff-filtered)
      // one below -- the badge's job is telling a *collapsed* section apart, where
      // `slots` would otherwise be invisible. Same reasoning for `unsaved`.
      const diffs = compareBuild.value ? allSlots.filter(rowDiffers).length : 0;
      const slots = onlyDiffAndComparing
        ? allSlots.filter(rowDiffers)
        : allSlots;
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
    .filter((section) => !onlyDiffAndComparing || section.slots.length > 0);
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
  for (const section of sections.value) {
    for (const slotDef of section.slots) {
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
  // An unset class constrains nothing: with the class slot now defaulting to empty, a
  // fresh build would otherwise hide every class-restricted item with no explanation.
  // Equipping one still flags the `requires X` error once a class is (not) chosen.
  return db.value
    .forSlot(slotId)
    .filter(
      (item) => !item.allowedClass || !cls || item.allowedClass.includes(cls),
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
 *  since there is nothing there to edit. The platform's own modifier exclusively (decision 46). */
function onRowClick(event: MouseEvent, slotId: string) {
  if (!(isMac ? event.metaKey : event.ctrlKey)) return;
  const item = itemIn(slotId);
  if (!item) return;
  const layer = layers.ensureTargetLayer();
  router.apply({ item: item.id });
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
  for (const entry of bonusesBySlot.value.get(slotId) ?? []) {
    for (const [key, value] of Object.entries(entry.appliedStats ?? {})) {
      totals[key] = (totals[key] ?? 0) + (value as number);
    }
  }
  const parts = [];
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
    <div class="flex gap-1.5">
      <BaseButton @click="setAll(true)"
        ><ChevronsUpDown />expand all</BaseButton
      >
      <BaseButton @click="setAll(false)"
        ><ChevronsDownUp />collapse all</BaseButton
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
      :expanded="expanded[section.id]"
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
        <BuildSlot
          :slot-def="slotDef"
          :build="build"
          :compare-build="compareBuild"
          :highlight-diff="highlightDiff"
          :is-hovered="hover?.slotId === slotDef.id"
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
          @rowclick="onRowClick($event, slotDef.id)"
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
