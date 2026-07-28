<script setup lang="ts">
// The left column: 15 collapsible sections over 180 slots (plan §1.5, §Phase 3).
//
// Sections start collapsed except Gear (handoff §6). That keeps the mounted DOM at ~15 rows
// on load; expanding everything is ~180 rows, which the browser handles fine -- only one
// dropdown is ever open, and that is where the per-row cost actually lives. No virtualisation.
import { ref, computed, onMounted, onUnmounted } from 'vue';
import ItemPicker from './ItemPicker.vue';
import ItemCard from './ItemCard.vue';
import Options from './Options.vue';
import IconButton from './IconButton.vue';
import ComboBox from './ComboBox.vue';
import { NW_SCHEMA } from '../data';
import { label as statLabelFmt, abbr, signedStat } from '../format';
import { useHoverCard } from '../composables/useHoverCard';
import { useKeyboardCursor } from '../composables/useKeyboardCursor';
import type {
  Db, Build, ResolvedBuild, BuildContext, Item, EvaluatedBonus, EngineRow, EngineError, Slot, SlotSection,
} from '../types';

const props = withDefaults(defineProps<{
  db: Db;
  build: Build;
  result: ResolvedBuild;
  context: BuildContext;
  // sectionId (plus 'options') -> open/closed. Owned by App.vue (`build.expanded`, saved
  // with the build) so it survives a reload the same way the rest of the build does --
  // this component only reads it and asks for changes via `toggle-section`/`set-expanded`.
  expanded: Record<string, boolean>;
  // The quick-compare picker in App.vue. `compareBuild` alone (no highlight) still backs
  // the other-build note under a differing row; `highlightDiff` adds the row colour;
  // `onlyDiff` hides everything that agrees.
  compareBuild?: Build | null;
  highlightDiff?: boolean;
  onlyDiff?: boolean;
  // The active build's last-saved snapshot (App.vue's `savedById[activeId]`) -- a plain dot
  // on any slot that differs from it, deliberately quieter than the compare-diff highlight
  // above: this is "you haven't saved this yet", not "here is what's different and why".
  savedBuild?: Build | null;
  // Other builds in the *active collection* (App.vue's `otherBuildsInCollection`), [{value,
  // label}] -- feeds each section header's own "copy from" picker. Replaces the old
  // whole-panel "copy a section between builds" drawer: doing it per section, right where
  // the section lives, needs no build switcher of its own.
  otherBuilds?: { value: string; label: string }[];
}>(), {
  compareBuild: null,
  highlightDiff: false,
  onlyDiff: false,
  savedBuild: null,
  otherBuilds: () => [],
});

const emit = defineEmits<{
  choose: [slotId: string, value: string];
  'set-value': [slotId: string, value: string];
  set: [key: string, value: string | number | boolean];
  'set-forte': [slot: string, key: string];
  'apply-slot': [slotId: string];
  'toggle-section': [sectionId: string];
  'set-expanded': [open: boolean];
  'edit-item': [name: string];
  'revert-slot': [slotId: string];
  'revert-section': [sectionId: string];
  'copy-section': [payload: { fromId: string; sectionIds: string[] }];
}>();

const root = ref<HTMLElement | null>(null);

const copyFrom = ref<Record<string, string>>({});        // sectionId -> chosen source build id, defaults to `otherBuilds[0]`
const copyMenuFor = ref<string | null>(null);   // sectionId currently showing the "copy section from" popover, or null

/** slotId -> the engine's resolved row, so the item object is never looked up twice. */
const rowBySlot = computed(() => new Map(props.result.rows.map((row) => [row.slotId, row])));

/** slotId -> [error]. Errors are rare, so a Map beats filtering per row. */
const errorsBySlot = computed(() => {
  const map = new Map<string, EngineError[]>();
  for (const error of props.result.errors) {
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
const bonusById = computed(() => new Map(props.result.bonuses.map((bonus) => [bonus.id, bonus])));

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
  for (const entry of props.db.bonusesFor(item)) {
    const resolved = bonusById.value.get(entry.bonus.id);
    if (resolved && !seen.has(resolved.id)) {
      seen.add(resolved.id);
      out.push(resolved);
    }
  }
  return out;
});

// --- quick compare ---------------------------------------------------------------------

function otherChoice(slotId: string) {
  return props.compareBuild?.choices?.[slotId] || '';
}

function differs(slotId: string) {
  return Boolean(props.compareBuild)
    && (props.build.choices[slotId] || '') !== otherChoice(slotId);
}

/** True if this slot's choice or typed value hasn't been saved yet. */
function unsaved(slotId: string) {
  if (!props.savedBuild) return false;
  if ((props.build.choices[slotId] || '') !== (props.savedBuild.choices[slotId] || '')) return true;
  return (props.build.values[slotId] ?? null) !== (props.savedBuild.values[slotId] ?? null);
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
  const onlyDiff = props.onlyDiff && props.compareBuild;
  return props.db.sections
    .map((section) => {
      const allSlots = props.db.slots.filter((slot) => slot.section === section.id);
      // Counted off the section's full slot list, not the (possibly onlyDiff-filtered)
      // one below -- the badge's job is telling a *collapsed* section apart, where
      // `slots` would otherwise be invisible. Same reasoning for `unsaved`.
      const diffs = props.compareBuild ? allSlots.filter((slot) => differs(slot.id)).length : 0;
      const unsavedFlag = allSlots.some((slot) => unsaved(slot.id));
      const slots = onlyDiff ? allSlots.filter((slot) => differs(slot.id)) : allSlots;
      let filled = 0;
      let errors = 0;
      for (const slot of slots) {
        if (rowBySlot.value.get(slot.id)?.item) filled += 1;
        errors += errorsBySlot.value.get(slot.id)?.length ?? 0;
      }
      return { ...section, slots, filled, errors, diffs, unsaved: unsavedFlag, total: slots.length };
    })
    .filter((section) => !onlyDiff || section.slots.length > 0);
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
      for (const raw of props.db.bonusesFor(item)) {
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
    if (props.expanded[section.id]) {
      for (const slot of section.slots) rows.push({ type: 'slot', id: slot.id });
    }
  }
  return rows;
});

const statLabel = (key: string) => statLabelFmt(key);

function itemsFor(slotId: string) {
  const cls = props.build.context.class;
  return props.db.forSlot(slotId)
    .filter((item) => !item.allowedClass || item.allowedClass.includes(cls));
}

function errorsFor(slotId: string) {
  return errorsBySlot.value.get(slotId) ?? [];
}

function toggle(sectionId: string) {
  emit('toggle-section', sectionId);
}

/** Defaults to the first other build in the collection so the control is usable with a
 * single click, not "pick a build, then click copy". */
function copyFromFor(sectionId: string) {
  return copyFrom.value[sectionId] ?? props.otherBuilds[0]?.value ?? '';
}

function setCopyFrom(sectionId: string, value: string) {
  copyFrom.value = { ...copyFrom.value, [sectionId]: value };
}

/** The section header's copy icon: no permanent picker sitting in the header, just a
 * small "copy section from" popover with its own picker and confirm button. */
function toggleCopyMenu(sectionId: string) {
  copyMenuFor.value = copyMenuFor.value === sectionId ? null : sectionId;
}

function confirmCopy(sectionId: string) {
  const fromId = copyFromFor(sectionId);
  if (!fromId) return;
  emit('copy-section', { fromId, sectionIds: [sectionId] });
  copyMenuFor.value = null;
}

function setAll(open: boolean) {
  emit('set-expanded', open);
}

/** A plain click just moves the cursor here, same as an arrow key would. Ctrl+click on a
 * filled slot jumps straight to that item in the data editor -- a no-op on an empty slot,
 * since there is nothing there to edit. */
function onRowClick(event: MouseEvent, slotId: string) {
  setCursor('slot', slotId);
  if (!event.ctrlKey) return;
  const item = itemIn(slotId);
  if (item) emit('edit-item', item.name);
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
  onClearSlot: (slotId) => emit('choose', slotId, ''),
});

/** Forwards the list's own `focusin` to both composables -- see `useHoverCard`'s own doc
 *  comment for why hover suppression can't just register its own listener. */
function onFocusIn(event: FocusEvent) {
  onHoverFocusIn(event);
  onCursorFocusIn(event);
}

/**
 * Closes the "copy section from" popover when a click lands outside it -- the icon
 * button that opens it toggles its own state, so this only has to handle "elsewhere".
 *
 * `event.composedPath()`, not `event.target.closest(...)`: choosing the popover's own
 * ComboBox option closes *that* dropdown in the same mousedown (see `choose()` in
 * ComboBox.vue), which synchronously detaches the clicked row from `.copy-popover` before
 * this handler runs -- a live `closest()` walk from `event.target` at that point no longer
 * finds the popover as an ancestor, even though the click plainly landed inside it.
 * `composedPath()` is the path as it was at dispatch time, unaffected by DOM changes any
 * listener made along the way.
 */
function onDocumentClick(event: MouseEvent) {
  if (!copyMenuFor.value) return;
  const path = event.composedPath?.() ?? [];
  if (path.some((el) => (el as Element).classList?.contains?.('copy-popover')
    || (el as Element).classList?.contains?.('section-copy-btn'))) return;
  copyMenuFor.value = null;
}

onMounted(() => document.addEventListener('mousedown', onDocumentClick));
onUnmounted(() => document.removeEventListener('mousedown', onDocumentClick));
</script>

<template>
  <div class="slots" ref="root" @focusin="onFocusIn" @focusout="onFocusOut">
    <div class="slots-toolbar">
      <button type="button" class="link" @click="setAll(true)">expand all</button>
      <button type="button" class="link" @click="setAll(false)">collapse all</button>
      <span class="spacer"></span>
      <span class="hint">Ctrl+click a filled slot to edit that item</span>
    </div>

    <section class="section">
      <div class="section-head-row">
        <button type="button" class="section-head" :class="{ 'is-cursor': isCursor('header', 'options') }"
                data-cursor-key="header:options"
                @click="toggle('options'); setCursor('header', 'options')">
          <span class="section-chevron">{{ expanded.options ? '▾' : '▸' }}</span>
          <span class="section-label">Options</span>
        </button>
      </div>
      <div v-if="expanded.options" class="section-body">
        <Options :context="context"
                @set="(key, value) => $emit('set', key, value)"
                @set-forte="(slot, key) => $emit('set-forte', slot, key)" />
      </div>
    </section>

    <section v-for="section in sections" :key="section.id" class="section">
      <div class="section-head-row">
        <button type="button" class="section-head" :class="{ 'is-cursor': isCursor('header', section.id) }"
                :data-cursor-key="'header:' + section.id"
                @click="toggle(section.id); setCursor('header', section.id)">
          <span class="section-chevron">{{ expanded[section.id] ? '▾' : '▸' }}</span>
          <span class="section-label">{{ section.label }}</span>
          <span class="section-count">{{ section.filled }}/{{ section.total }}</span>
          <span v-if="section.errors" class="badge badge--error">{{ section.errors }}</span>
          <span v-if="highlightDiff && section.diffs" class="badge badge--diff">{{ section.diffs }}</span>
          <span v-if="section.unsaved" class="unsaved-dot" title="Unsaved changes in this section"></span>
        </button>
        <div v-if="otherBuilds.length" class="copy-popover-wrap">
          <IconButton icon="copy" title="Copy this section from another build" class="section-copy-btn"
                      @click="toggleCopyMenu(section.id)" />
          <div v-if="copyMenuFor === section.id" class="copy-popover">
            <span class="copy-popover-label">Copy section from</span>
            <ComboBox class="copy-popover-select" :model-value="copyFromFor(section.id)"
                      :options="otherBuilds" placeholder="choose a build…"
                      @update:model-value="setCopyFrom(section.id, $event)" />
            <button type="button" class="btn btn--primary" :disabled="!copyFromFor(section.id)"
                    @click="confirmCopy(section.id)">Copy</button>
          </div>
        </div>
        <IconButton v-if="section.unsaved" icon="undo-2" title="Revert this section to saved"
                    class="section-revert" @click="$emit('revert-section', section.id)" />
      </div>

      <div v-if="expanded[section.id]" class="section-body">
        <div v-for="slot in section.slots" :key="slot.id" class="slot-row" tabindex="-1"
             :class="{ 'is-hovered': hover?.slotId === slot.id, 'is-cursor': isCursor('slot', slot.id),
                       'is-diff': highlightDiff && differs(slot.id) }"
             :data-cursor-key="'slot:' + slot.id"
             @mouseenter="onRowEnter($event, slot.id)"
             @mouseleave="onRowLeave"
             @click="onRowClick($event, slot.id)">
          <div class="slot-label-col">
            <label class="slot-label" :for="slot.id">{{ slot.label }}</label>
            <span v-if="unsaved(slot.id)" class="slot-change">
              <span class="unsaved-dot" title="Unsaved change"></span>
              <IconButton icon="undo-2" title="Revert to saved" @click="$emit('revert-slot', slot.id)" />
            </span>
          </div>

          <div class="slot-control">
            <div class="slot-main">
              <ItemPicker
                :ref="el => setPickerRef(slot.id, el)"
                :items="itemsFor(slot.id)"
                :model-value="build.choices[slot.id] ?? ''"
                :invalid="errorsFor(slot.id).length > 0"
                @update:model-value="$emit('choose', slot.id, $event)" />
              <span v-if="itemIn(slot.id)" class="slot-summary">{{ statSummary(slot.id) }}</span>
            </div>

            <p v-if="highlightDiff && differs(slot.id)" class="slot-diff-note">
              {{ compareBuild?.name }}: {{ otherChoice(slot.id) || '(empty)' }}
              <button type="button" class="link" @click.stop="$emit('apply-slot', slot.id)">
                apply
              </button>
            </p>

            <!-- Dynamic weapon modifications carry a user-typed magnitude. Driven by the
                 item's own `dynamicStat`, not by a hard-coded slot id, so a second
                 dynamic modification would work with no UI change. -->
            <div v-if="itemIn(slot.id)?.dynamicStat" class="slot-value">
              <input
                type="number"
                class="num-input"
                :min="itemIn(slot.id)?.dynamicMin"
                :max="itemIn(slot.id)?.dynamicMax"
                :value="build.values[slot.id] ?? ''"
                :placeholder="String(itemIn(slot.id)?.dynamicMin ?? '')"
                @input="$emit('set-value', slot.id, ($event.target as HTMLInputElement).value)">
              <span class="hint">
                {{ statLabel(itemIn(slot.id)?.dynamicStat as string) }}
                {{ itemIn(slot.id)?.dynamicMin }}–{{ itemIn(slot.id)?.dynamicMax }}
              </span>
            </div>

            <p v-for="error in errorsFor(slot.id)" :key="error.kind + error.choice"
               class="slot-error">{{ error.message }}</p>
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

<style scoped>
.slots-toolbar { display: flex; gap: 6px; margin-bottom: 6px; }

.section {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  margin-bottom: 6px;
}

/* The revert icon (shown only when the section has unsaved slots) has to sit outside the
 * toggle button -- a <button> can't nest another one -- so the button no longer spans the
 * full row on its own; `.section-head-row` does that instead. */
.section-head-row { align-items: center; display: flex; }

.section-head {
  align-items: center;
  background: none;
  border: 0;
  color: inherit;
  cursor: pointer;
  display: flex;
  flex: 1;
  font: inherit;
  font-weight: 600;
  gap: 8px;
  min-width: 0;
  padding: 7px 10px;
  text-align: left;
}
.section-head:hover { background: var(--surface-2); }
.section-chevron { color: var(--muted); width: 10px; }
.section-count { color: var(--muted); font-weight: 400; margin-left: auto; }
.section-revert { flex: none; margin-right: 6px; }

/* The section header's "copy this section from…" control -- an icon button, not a permanent
 * picker, so the header row (which already carries the label, counts and badges) stays quiet
 * until it's actually needed. Opens to the side (left) of the button rather than below it,
 * since the row itself has plenty of width and dropping down would sit awkwardly over the
 * section's own body. */
.copy-popover-wrap { flex: none; margin-right: 2px; position: relative; }
.copy-popover {
  align-items: center;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: 0 8px 24px rgba(0, 0, 0, .18);
  display: flex;
  gap: 6px;
  padding: 7px 9px;
  position: absolute;
  right: calc(100% + 6px);
  top: 50%;
  transform: translateY(-50%);
  white-space: nowrap;
  z-index: 25;
}
.copy-popover-label { color: var(--muted); font-size: 1rem; }
.copy-popover-select { width: 170px; }

.section-body { border-top: 1px solid var(--line); padding: 4px 10px 8px; }

.slot-row {
  align-items: baseline;
  border-bottom: 1px solid color-mix(in srgb, var(--line) 45%, transparent);
  display: grid;
  gap: 10px;
  grid-template-columns: 150px minmax(0, 1fr);
  padding: 4px 0;
}
.slot-row:last-child { border-bottom: 0; }

/* The change marker (dot + revert icon) sits pinned to the right of this column, close to
 * where the picker starts, rather than right after the label text -- so it lines up in the
 * same spot on every row regardless of how long that row's label is. */
.slot-label-col { align-items: center; display: flex; justify-content: space-between; min-width: 0; }
.slot-label {
  color: var(--muted);
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.slot-change { align-items: center; display: flex; flex: none; gap: 2px; }

/* Keyboard cursor: independent of mouse hover (`.is-hovered`) -- the two can point at different
 * rows at once, same as a spreadsheet's selection vs. hover state. */
.slot-row.is-cursor, .section-head.is-cursor {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
}
/* `.slot-row` is tabindex="-1" so real DOM focus can follow the keyboard cursor (see
 * `syncCursorFocus` above) -- normally focus and `.is-cursor` land together, so this only
 * suppresses the native ring for the rare moment they don't (e.g. a row losing `.is-cursor`
 * a tick before the browser actually moves focus off it). `:not(.is-cursor)` -- not just source
 * order -- keeps this from ever tying with (and winning over, being the same specificity and
 * later) the `.is-cursor` rule above when both apply to the same row at once. */
.slot-row:focus:not(.is-cursor) { outline: none; }

.slot-control { min-width: 0; }
/* The picker is capped, not stretched to fill the column -- the freed space carries a condensed
 * stat summary instead of sitting empty. */
.slot-main { align-items: center; display: flex; flex-wrap: wrap; gap: 10px; }
.slot-main .picker { flex: 0 1 320px; min-width: 160px; }
.slot-summary {
  color: var(--text);
  flex: 1;
  font-size: 1rem;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.slot-value { align-items: center; display: flex; gap: 6px; margin-top: 4px; }
.slot-error { color: var(--danger); margin: 3px 0 0; font-size: 1rem; }

.slot-diff-note { color: var(--muted); font-size: 1rem; margin: 2px 0 0; }
.slot-diff-note button.link { color: var(--accent); margin-left: 2px; padding: 0; }

.slot-row.is-hovered { background: color-mix(in srgb, var(--accent-soft) 40%, transparent); }

/* Quick-compare: a row whose choice differs from the compare build, per App.vue's picker. Same
 * specificity as `.is-hovered` above -- this comes later in source order so the diff cue stays
 * visible on hover instead of the two backgrounds fighting row-for-row. */
.slot-row.is-diff { background: color-mix(in srgb, var(--diff) 20%, transparent); }

@media (max-width: 480px) {
  /* The fixed 150px label column plus the picker's own 160px minimum no longer both fit --
   * stack the label above the control instead of forcing a horizontal scrollbar per row. */
  .slot-row { grid-template-columns: minmax(0, 1fr); gap: 2px; }
  .slot-main .picker { min-width: 0; }
}
</style>
