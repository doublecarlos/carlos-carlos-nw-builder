<script setup lang="ts">
// The left column: 15 collapsible sections over 180 slots (plan §1.5, §Phase 3).
//
// Sections start collapsed except Gear (handoff §6). That keeps the mounted DOM at ~15 rows
// on load; expanding everything is ~180 rows, which the browser handles fine -- only one
// dropdown is ever open, and that is where the per-row cost actually lives. No virtualisation.
import { computed, reactive, ref, watch } from 'vue';
import ItemPicker from './ItemPicker.vue';
import ItemCard from './ItemCard.vue';
import Options from './Options.vue';
import IconButton from './IconButton.vue';
import SectionCopyMenu from './SectionCopyMenu.vue';
import Button from './ui/Button.vue';
import Badge from './ui/Badge.vue';
import UnsavedDot from './ui/UnsavedDot.vue';
import { NW_SCHEMA, NW_SLOTS } from '../data';
import { label as statLabelFmt, abbr, signedStat } from '../format';
import { useHoverCard } from '../composables/useHoverCard';
import { useKeyboardCursor } from '../composables/useKeyboardCursor';
import { useCompareDiff } from '../composables/useCompareDiff';
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
  if (!r.ok) throw new Error('SlotList requires a resolved build');
  return r.result;
});
const context = computed(() => build.value.context);
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
// section starts collapsed except Gear, plus the Options header (not a real section, so it
// isn't in `NW_SLOTS.sections`).
const OPEN_BY_DEFAULT = new Set(['gear']);
const savedExpanded = storage.loadUiState().expanded;
const expanded = reactive<Record<string, boolean>>({ options: savedExpanded?.options ?? false });
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

const { differs, otherChoice, valueDiffers, rowDiff, rowHasDiff, optionsDiffCount } = useCompareDiff({
  db, build, result, compareBuild, compareResult, itemIn,
});

/** True if this slot's choice or typed value hasn't been saved yet. */
function unsaved(slotId: string) {
  const saved = savedBuild.value;
  if (!saved) return false;
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

const sections = computed<SectionRow[]>(() => {
  const onlyDiffAndComparing = onlyDiff.value && compareBuild.value;
  return db.value.sections
    .map((section) => {
      const allSlots = db.value.slots.filter((slot) => slot.section === section.id);
      // Counted off the section's full slot list, not the (possibly onlyDiff-filtered)
      // one below -- the badge's job is telling a *collapsed* section apart, where
      // `slots` would otherwise be invisible. Same reasoning for `unsaved`. A "diff" here is
      // the combined choice/value/bonus-outcome check (`rowHasDiff`), not just a differing
      // choice, so the badge also catches a same-item slot whose bonus or typed value differs.
      const diffs = compareBuild.value ? allSlots.filter((slot) => rowHasDiff(slot.id)).length : 0;
      const unsavedFlag = allSlots.some((slot) => unsaved(slot.id));
      const slots = onlyDiffAndComparing ? allSlots.filter((slot) => rowHasDiff(slot.id)) : allSlots;
      let filled = 0;
      let errors = 0;
      for (const slot of slots) {
        if (rowBySlot.value.get(slot.id)?.item) filled += 1;
        errors += errorsBySlot.value.get(slot.id)?.length ?? 0;
      }
      return { ...section, slots, filled, errors, diffs, unsaved: unsavedFlag, total: slots.length };
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
 * Flattens exactly what the template renders -- the Options header, then per section a
 * header and (if expanded) its slot rows -- so keyboard movement always matches what is
 * actually on screen. Collapsed sections simply contribute no slot entries, the same way
 * a spreadsheet skips hidden rows.
 */
const visibleRows = computed(() => {
  const rows: { type: string; id: string }[] = [{ type: 'header', id: 'options' }];
  for (const section of sections.value) {
    rows.push({ type: 'header', id: section.id });
    if (expanded[section.id]) {
      for (const slot of section.slots) rows.push({ type: 'slot', id: slot.id });
    }
  }
  return rows;
});

const statLabel = (key: string) => statLabelFmt(key);

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
  expanded.options = open;
}

/** A plain click just moves the cursor here, same as an arrow key would. Ctrl+click on a
 * filled slot jumps straight to that item in the data editor -- a no-op on an empty slot,
 * since there is nothing there to edit. */
function onRowClick(event: MouseEvent, slotId: string) {
  setCursor('slot', slotId);
  if (!event.ctrlKey) return;
  const item = itemIn(slotId);
  if (!item) return;
  router.apply({ item: item.name });
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
  isCursor, setCursor, setPickerRef, onFocusIn: onCursorFocusIn,
} = useKeyboardCursor(root, visibleRows, {
  onToggleHeader: toggle,
  onClearSlot: (slotId) => buildEditor.setChoice(slotId, ''),
});

/** Forwards the list's own `focusin` to both composables -- see `useHoverCard`'s own doc
 *  comment for why hover suppression can't just register its own listener. */
function onFocusIn(event: FocusEvent) {
  onHoverFocusIn(event);
  onCursorFocusIn(event);
}
</script>

<template>
  <div class="flex flex-col gap-1.5" ref="root" @focusin="onFocusIn" @focusout="onFocusOut">
    <div class="flex gap-1.5">
      <Button variant="link" @click="setAll(true)">expand all</Button>
      <Button variant="link" @click="setAll(false)">collapse all</Button>
      <span class="flex-1"></span>
      <span class="text-sm text-muted">Ctrl+click a filled slot to edit that item</span>
    </div>

    <section class="rounded-md border border-line">
      <!-- The revert icon (shown only when the section has unsaved slots) has to sit outside
           the toggle button -- a <button> can't nest another one. -->
      <div class="flex items-center">
        <button type="button"
                class="bg-surface-2 flex flex-1 items-center gap-2 min-w-0 px-2.5 py-1.5 text-left font-semibold hover:bg-surface-2"
                :class="isCursor('header', 'options') && 'is-cursor outline-2 -outline-offset-1 outline-accent'"
                data-cursor-key="header:options"
                @click="toggle('options'); setCursor('header', 'options')">
          <span class="w-2.5 text-muted">{{ expanded.options ? '▾' : '▸' }}</span>
          <span class="flex-1 truncate">Options</span>
          <Badge v-if="highlightDiff && optionsDiffCount" variant="diff">{{ optionsDiffCount }}</Badge>
        </button>
      </div>
      <div v-if="expanded.options" class="bg-surface border-t border-line px-2.5 pb-2 pt-1">
        <Options :context="context"
                :compare-context="compareBuild?.context ?? null"
                :compare-name="compareBuild?.name ?? ''"
                :highlight-diff="highlightDiff"
                @set="buildEditor.setContext"
                @set-forte="buildEditor.setForte" />
      </div>
    </section>

    <section v-for="section in sections" :key="section.id" class="rounded-md border border-line">
      <div class="bg-surface-2 flex items-center">
        <button type="button"
                class="flex flex-1 items-center gap-2 min-w-0 px-2.5 py-1.5 text-left font-semibold hover:bg-surface-2"
                :class="isCursor('header', section.id) && 'is-cursor outline-2 -outline-offset-1 outline-accent'"
                :data-cursor-key="'header:' + section.id"
                @click="toggle(section.id); setCursor('header', section.id)">
          <span class="w-2.5 text-muted">{{ expanded[section.id] ? '▾' : '▸' }}</span>
          <span class="truncate">{{ section.label }}</span>
          <span class="section-count ml-auto font-normal text-muted">{{ section.filled }}/{{ section.total }}</span>
          <Badge v-if="section.errors" variant="error">{{ section.errors }}</Badge>
          <Badge v-if="highlightDiff && section.diffs" variant="diff">{{ section.diffs }}</Badge>
          <UnsavedDot v-if="section.unsaved" title="Unsaved changes in this section" />
        </button>
        <SectionCopyMenu v-if="otherBuilds.length" :section-id="section.id" :other-builds="otherBuilds"
                         @copy="(fromId) => buildEditor.copySection(fromId, [section.id])" />
        <IconButton v-if="section.unsaved" icon="undo-2" title="Revert this section to saved"
                    class="mr-1.5 flex-none" @click="buildEditor.revertSection(section.id)" />
      </div>

      <div v-if="expanded[section.id]" class="bg-surface border-t border-line px-2.5 pb-2 pt-1">
        <div v-for="slot in section.slots" :key="slot.id"
             class="flex items-baseline gap-2.5 border-b border-line/45 py-1 last:border-b-0" tabindex="-1"
             :class="[
               hover?.slotId === slot.id && 'is-hovered bg-accent-soft/40',
               isCursor('slot', slot.id) && 'is-cursor outline-2 -outline-offset-1 outline-accent',
               highlightDiff && rowHasDiff(slot.id) && 'is-diff bg-diff/20',
             ]"
             :data-cursor-key="'slot:' + slot.id"
             @mouseenter="onRowEnter($event, slot.id)"
             @mouseleave="onRowLeave"
             @click="onRowClick($event, slot.id)">
          <div class="flex w-36 shrink-0 items-center justify-between min-w-0">
            <label class="slot-label min-w-0 flex-1 truncate text-muted" :for="slot.id">{{ slot.label }}</label>
            <span v-if="unsaved(slot.id)" class="flex flex-none items-center gap-0.5">
              <UnsavedDot title="Unsaved change" />
              <IconButton icon="undo-2" title="Revert to saved" @click="buildEditor.revertSlot(slot.id)" />
            </span>
          </div>

          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2.5">
              <ItemPicker
                :ref="el => setPickerRef(slot.id, el)"
                class="grow-0 basis-80 min-w-40"
                :items="itemsFor(slot.id)"
                :model-value="build.choices[slot.id] ?? ''"
                :invalid="errorsFor(slot.id).length > 0"
                @update:model-value="buildEditor.setChoice(slot.id, $event)" />
              <span v-if="itemIn(slot.id)" class="min-w-0 flex-1 truncate text-sm text-text">{{ statSummary(slot.id) }}</span>
            </div>

            <p v-if="highlightDiff && differs(slot.id)" class="slot-diff-note mt-0.5 text-sm text-muted">
              {{ compareBuild?.name }}: {{ otherChoice(slot.id) || '(empty)' }}
              <Button variant="link" class="ml-0.5 text-accent" @click.stop="buildEditor.applyFromCompare(slot.id)">
                apply
              </Button>
            </p>

            <!-- Same item both sides, but the bonus(es) it grants resolve differently --
                 e.g. a `when` gate reading class/role/toggles/duration/other slots. No apply
                 action: there is no single field to copy, the difference lives elsewhere in
                 the build. -->
            <template v-if="highlightDiff">
              <p v-for="bonusDiff in rowDiff(slot.id)?.bonuses ?? []" :key="bonusDiff.id"
                 class="mt-0.5 text-sm font-semibold text-diff">
                {{ bonusDiff.message }}
              </p>
            </template>

            <!-- Dynamic weapon modifications carry a user-typed magnitude. Driven by the
                 item's own `dynamicStat`, not by a hard-coded slot id, so a second
                 dynamic modification would work with no UI change. -->
            <div v-if="itemIn(slot.id)?.dynamicStat" class="mt-1 flex items-center gap-1.5">
              <input
                type="number"
                class="w-20 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
                :min="itemIn(slot.id)?.dynamicMin"
                :max="itemIn(slot.id)?.dynamicMax"
                :value="build.values[slot.id] ?? ''"
                :placeholder="String(itemIn(slot.id)?.dynamicMin ?? '')"
                @input="buildEditor.setValue(slot.id, ($event.target as HTMLInputElement).value)">
              <span class="text-sm text-muted">
                {{ statLabel(itemIn(slot.id)?.dynamicStat as string) }}
                {{ itemIn(slot.id)?.dynamicMin }}–{{ itemIn(slot.id)?.dynamicMax }}
              </span>
            </div>

            <p v-if="highlightDiff && rowDiff(slot.id)?.value" class="slot-diff-note mt-0.5 text-sm text-muted">
              {{ compareBuild?.name }}: {{ compareBuild?.values?.[slot.id] ?? '(none)' }}
              <Button variant="link" class="ml-0.5 text-accent" @click.stop="buildEditor.applyValueFromCompare(slot.id)">
                apply
              </Button>
            </p>

            <p v-for="error in errorsFor(slot.id)" :key="error.kind + error.choice"
               class="mt-0.5 text-sm text-danger">{{ error.message }}</p>
          </div>
        </div>
      </div>
    </section>

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
  </div>
</template>
