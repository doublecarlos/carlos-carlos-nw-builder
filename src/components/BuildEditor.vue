<script setup lang="ts">
// The left column: 15 collapsible sections over 180 slots (plan §1.5, §Phase 3).
//
// Sections start collapsed except Gear (handoff §6). That keeps the mounted DOM at ~15 rows
// on load; expanding everything is ~180 rows, which the browser handles fine -- only one
// dropdown is ever open, and that is where the per-row cost actually lives. No virtualisation.
import { computed, reactive, ref, watch } from 'vue';
import ItemCard from './ItemCard.vue';
import BuildSection from './BuildSection.vue';
import BuildSlot from './BuildSlot.vue';
import Button from './ui/Button.vue';
import { NW_SCHEMA, NW_SLOTS } from '../data';
import { abbr, signedStat } from '../format';
import { useHoverCard } from '../composables/useHoverCard';
import { useKeyboardCursor } from '../composables/useKeyboardCursor';
import { useCompareDiff, paramDiffers, paramDiffTitle } from '../composables/useCompareDiff';
import { getPath } from '../build-path';
import * as storage from '../storage';
import * as router from '../router';
import * as library from '../stores/library';
import * as buildEditor from '../stores/buildEditor';
import * as compare from '../stores/compare';
import * as engine from '../stores/engine';
import * as ui from '../stores/ui';
import type { Item, EvaluatedBonus, EngineError, Slot, SlotSection } from '../types';

const root = ref<HTMLElement | null>(null);

const db = engine.db;
const build = library.build;
// Only ever mounted when `engine.resolved.value.ok` -- the throw documents that invariant
// instead of a defensive fallback for a state that can't happen.
const result = computed(() => {
  const r = engine.resolved.value;
  if (!r.ok) throw new Error('BuildEditor requires a resolved build');
  return r.result;
});
const compareBuild = compare.compareBuild;
const compareResult = computed(() => (engine.compareResolved.value?.ok ? engine.compareResolved.value.result : null));
const highlightDiff = computed(() => build.value.compare.highlight);
const onlyDiff = computed(() => build.value.compare.onlyDiff);
// The active build's last-saved snapshot -- a plain dot on any slot that differs from it,
// deliberately quieter than the compare-diff highlight below: this is "you haven't saved
// this yet", not "here is what's different and why".
const savedBuild = computed(() => library.savedById.value[library.activeId.value] ?? null);
// Other builds in the *active collection* -- feeds each section header's own "copy from"
// picker (SectionCopyMenu.vue).
const otherBuilds = library.otherBuildsInCollection;

// Which sections are open -- a UI preference, not a build edit, shared across every build
// rather than saved with one, persisted under its own key so it survives a reload. Every
// section starts collapsed except Gear. "options" is a real section like any other now (first
// in `NW_SLOTS.sections`), so it needs no separate seed.
const OPEN_BY_DEFAULT = new Set(['gear']);
const savedExpanded = storage.loadUiState().expanded;
const expanded = reactive<Record<string, boolean>>({});
for (const section of NW_SLOTS.sections) {
  expanded[section.id] = savedExpanded?.[section.id] ?? OPEN_BY_DEFAULT.has(section.id);
}
watch(expanded, () => { storage.saveUiState({ expanded: { ...expanded } }); }, { deep: true });

/** slotId -> the engine's resolved row, so the item object is never looked up twice. */
const rowBySlot = computed(() => new Map(result.value.rows.map((row) => [row.slotId, row])));

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
const bonusById = computed(() => new Map(result.value.bonuses.map((bonus) => [bonus.id, bonus])));

function itemIn(slotId: string): Item | null {
  return rowBySlot.value.get(slotId)?.item ?? null;
}

const {
  hover, onRowEnter, onRowLeave, onCardEnter, onCardLeave,
  onFocusIn: onHoverFocusIn, onFocusOut,
} = useHoverCard(root, (slotId) => itemIn(slotId) !== null);

const hoveredItem = computed(() => (hover.value ? itemIn(hover.value.slotId) : null));

/**
 * Every bonus the hovered item takes part in -- its own inline ones and its sets'.
 * Not `bonuses.filter(b => b.slotId === …)`: a set bonus is attributed to the single
 * slot that instanced it, so the other pieces of the set would show nothing.
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

const {
  differs, otherChoiceLabel, valueDiffers, rowDiff, rowHasDiff, optionsDiffCount,
} = useCompareDiff({
  db, build, result, compareBuild, compareResult, itemIn,
});

/** True if this slot's choice, typed value, or build_parameter value hasn't been saved yet. */
function unsaved(slotId: string) {
  const saved = savedBuild.value;
  if (!saved) return false;
  const slot = db.value.slotById.get(slotId);
  if (slot?.type === 'build_parameter') {
    return (getPath(build.value.context, slot.path) ?? null) !== (getPath(saved.context, slot.path) ?? null);
  }
  if ((build.value.choices[slotId] || '') !== (saved.choices[slotId] || '')) return true;
  return (build.value.values[slotId] ?? null) !== (saved.values[slotId] ?? null);
}

interface SectionRow extends SlotSection {
  slots: Slot[];
  filled: number;
  errors: number;
  diffs: number;
  unsaved: boolean;
  total: number;
}

/** True for a slot the section body actually renders -- a `quick` build_parameter slot lives
 * in the always-visible QuickOptions strip instead, so it never counts toward this section's
 * badge/diff/unsaved state (it's never hidden by a collapse the way a real row can be). */
function rowDiffers(slot: Slot) {
  return slot.type === 'build_parameter'
    ? paramDiffers(build.value, compareBuild.value, slot)
    : rowHasDiff(slot.id);
}

const sections = computed<SectionRow[]>(() => {
  const onlyDiffAndComparing = onlyDiff.value && compareBuild.value;
  return db.value.sections
    .map((section) => {
      const allSlots = db.value.slots.filter((slot) => (
        slot.section === section.id && !(slot.type === 'build_parameter' && slot.quick)
      ));
      // Counted off the section's full slot list, not the (possibly onlyDiff-filtered)
      // one below -- the badge's job is telling a *collapsed* section apart, where
      // `slots` would otherwise be invisible. Same reasoning for `unsaved`.
      const diffs = compareBuild.value ? allSlots.filter(rowDiffers).length : 0;
      const unsavedFlag = allSlots.some((slot) => unsaved(slot.id));
      const slots = onlyDiffAndComparing ? allSlots.filter(rowDiffers) : allSlots;
      // The fill-count badge only means anything for item_picker slots -- a build_parameter
      // always has *some* value, "filled" isn't a meaningful state for it. A section made
      // entirely of them (Options) ends up with total 0, so the badge just doesn't render.
      const pickerSlots = slots.filter((slot) => slot.type === 'item_picker');
      let filled = 0;
      let errors = 0;
      for (const slot of pickerSlots) {
        if (rowBySlot.value.get(slot.id)?.item) filled += 1;
        errors += errorsBySlot.value.get(slot.id)?.length ?? 0;
      }
      return { ...section, slots, filled, errors, diffs, unsaved: unsavedFlag, total: pickerSlots.length };
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
    for (const slot of section.slots) {
      const item = itemIn(slot.id);
      if (!item) continue;
      const entries: EvaluatedBonus[] = [];
      for (const raw of db.value.bonusesFor(item)) {
        const resolved = bonusById.value.get(raw.bonus.id);
        if (!resolved?.active || shown.has(resolved.id)) continue;
        shown.add(resolved.id);
        entries.push(resolved);
      }
      if (entries.length) map.set(slot.id, entries);
    }
  }
  return map;
});

/**
 * Flattens exactly what the template renders -- a header per section, then (if expanded) its
 * slot rows -- so keyboard movement always matches what is actually on screen. Collapsed
 * sections simply contribute no slot entries, the same way a spreadsheet skips hidden rows.
 */
const visibleRows = computed(() => {
  const rows: { type: string; id: string; kind?: "item_picker" | "build_parameter" }[] = [];
  for (const section of sections.value) {
    rows.push({ type: 'header', id: section.id });
    if (expanded[section.id]) {
      for (const slot of section.slots) rows.push({ type: 'slot', id: slot.id, kind: slot.type });
    }
  }
  return rows;
});

function itemsFor(slotId: string) {
  const cls = build.value.context.class;
  return db.value.forSlot(slotId)
    .filter((item) => !item.allowedClass || item.allowedClass.includes(cls));
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

/** A plain click just moves the cursor here, same as an arrow key would. Ctrl+click on a
 * filled slot jumps straight to that item in the data editor -- a no-op on an empty slot,
 * since there is nothing there to edit. */
function onRowClick(event: MouseEvent, slotId: string) {
  const slotType = db.value.slotById.get(slotId)?.type as 'item_picker' | 'build_parameter' | undefined;
  setCursor('slot', slotId, slotType);
  if (!event.ctrlKey) return;
  const item = itemIn(slotId);
  if (!item) return;
  router.apply({ item: item.id });
  ui.openEditor();
}

/**
 * Condensed, single-line stat summary for a row: the item's own stats plus whatever
 * active bonuses are credited to this slot (`bonusesBySlot`), summed together key by key
 * rather than attributed separately -- one number per stat, not a name-tagged breakdown.
 */
function statSummary(slotId: string) {
  const item = itemIn(slotId);
  if (!item) return '';
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
  return parts.join(' • ');
}

const {
  isCursor, setCursor, setPickerRef, setParamRef, onFocusIn: onCursorFocusIn,
} = useKeyboardCursor(root, visibleRows, {
  onToggleHeader: toggle,
  // Backspace-to-clear only makes sense for an item choice -- a build_parameter always has
  // some value, there's nothing to "clear" it back to that isn't already its own control.
  onClearSlot: (slotId) => {
    if (db.value.slotById.get(slotId)?.type === 'item_picker') buildEditor.setChoice(slotId, '');
  },
  onResetParam: (slotId) => {
    const slot = db.value.slotById.get(slotId);
    if (slot?.type === 'build_parameter') buildEditor.resetParamToDefault(slot);
  },
});

/** Forwards the list's own `focusin` to both composables -- see `useHoverCard`'s own doc
 *  comment for why hover suppression can't just register its own listener. */
function onFocusIn(event: FocusEvent) {
  onHoverFocusIn(event);
  onCursorFocusIn(event);
}
</script>

<template>
  <section class="flex flex-col gap-1.5" data-testid="builder-content" ref="root" @focusin="onFocusIn" @focusout="onFocusOut">
    <div class="flex gap-1.5">
      <Button variant="link" @click="setAll(true)">expand all</Button>
      <Button variant="link" @click="setAll(false)">collapse all</Button>
      <span class="flex-1"></span>
      <span class="text-sm text-muted">Ctrl+click a filled slot to edit that item</span>
    </div>

    <BuildSection
      v-for="section in sections" :key="section.id"
      :id="section.id" :label="section.label" :slots="section.slots"
      :filled="section.filled" :total="section.total" :errors="section.errors" :diffs="section.diffs"
      :unsaved="section.unsaved" :expanded="expanded[section.id]" :is-cursor="isCursor('header', section.id)"
      :highlight-diff="highlightDiff" :other-builds="otherBuilds"
      @toggle="toggle(section.id); setCursor('header', section.id)"
      @copy="(fromId) => buildEditor.copySection(fromId, [section.id])"
      @revert="buildEditor.revertSection(section.id)">
      <template #default="{ slot }: { slot: Slot }">
        <BuildSlot
          :slot="slot" :build="build" :compare-build="compareBuild" :highlight-diff="highlightDiff"
          :is-hovered="hover?.slotId === slot.id" :is-cursor="isCursor('slot', slot.id)" :unsaved="unsaved(slot.id)"
          :item="itemIn(slot.id)" :items="itemsFor(slot.id)" :errors="errorsFor(slot.id)"
          :stat-summary="statSummary(slot.id)" :choice-differs="differs(slot.id)"
          :other-choice-label="otherChoiceLabel(slot.id)" :bonus-diffs="rowDiff(slot.id)?.bonuses"
          :value-differs="!!rowDiff(slot.id)?.value" :other-value="compareBuild?.values?.[slot.id]"
          :param-differs="slot.type === 'build_parameter' ? paramDiffers(build, compareBuild, slot) : false"
          :other-param-label="slot.type === 'build_parameter' ? paramDiffTitle(compareBuild, slot) : undefined"
          @enter="onRowEnter($event, slot.id)" @leave="onRowLeave" @rowclick="onRowClick($event, slot.id)"
          @picker-ref="el => setPickerRef(slot.id, el)" />
      </template>
    </BuildSection>

    <!-- One card for the whole list, moved and refilled on hover. -->
    <ItemCard
      v-if="hover && hoveredItem"
      :item="hoveredItem"
      :bonuses="hoveredBonuses"
      :db="db"
      :slot-label="db.slotById.get(hover.slotId)?.label ?? ''"
      :style="{ left: hover.left + 'px', top: hover.top + 'px' }"
      @mouseenter="onCardEnter"
      @mouseleave="onCardLeave" />
  </section>
</template>
