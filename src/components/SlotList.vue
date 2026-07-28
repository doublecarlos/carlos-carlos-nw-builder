<script setup lang="ts">
// The left column: 15 collapsible sections over 180 slots (plan §1.5, §Phase 3).
//
// Sections start collapsed except Gear (handoff §6). That keeps the mounted DOM at ~15 rows
// on load; expanding everything is ~180 rows, which the browser handles fine -- only one
// dropdown is ever open, and that is where the per-row cost actually lives. No virtualisation.
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue';
import ItemPicker from './ItemPicker.vue';
import ItemCard from './ItemCard.vue';
import Options from './Options.vue';
import IconButton from './IconButton.vue';
import ComboBox from './ComboBox.vue';
import { NW_SCHEMA } from '../data';
import { label as statLabelFmt, abbr, signedStat } from '../format';

const HOVER_DELAY_MS = 220;
// If the pointer lands on a new row this soon after the last card closed, treat it as still
// "in" the tooltip session and skip the opening delay -- sweeping down a list of items should
// feel like one continuous hover, not a fresh 220ms wait per row.
const HOVER_RESUME_MS = 400;
const HOVER_CLOSE_GRACE_MS = 100;
const CARD_W = 330;    // must match .itemcard width in app.css

const props = withDefaults(defineProps<{
  db: any;
  build: any;
  result: any;
  context: any;
  // sectionId (plus 'options') -> open/closed. Owned by App.vue (`build.expanded`, saved
  // with the build) so it survives a reload the same way the rest of the build does --
  // this component only reads it and asks for changes via `toggle-section`/`set-expanded`.
  expanded: Record<string, boolean>;
  // The quick-compare picker in App.vue. `compareBuild` alone (no highlight) still backs
  // the other-build note under a differing row; `highlightDiff` adds the row colour;
  // `onlyDiff` hides everything that agrees.
  compareBuild?: any;
  highlightDiff?: boolean;
  onlyDiff?: boolean;
  // The active build's last-saved snapshot (App.vue's `savedById[activeId]`) -- a plain dot
  // on any slot that differs from it, deliberately quieter than the compare-diff highlight
  // above: this is "you haven't saved this yet", not "here is what's different and why".
  savedBuild?: any;
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
  set: [key: string, value: any];
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

const hover = ref<{ slotId: string; left: number; top: number } | null>(null);   // the one hover card, or nothing
let hoverTimer: number | undefined;
let leaveTimer: number | undefined;   // grace period before a leave actually closes the card
let lastHideAt = 0;      // Date.now() of the last close, for the "resume" fast path
let editing = false;     // a picker has focus: suppress the card so it cannot cover a dropdown
const cursor = ref<{ type: 'header' | 'slot'; id: string } | null>(null);   // keyboard cursor, independent of the mouse
const copyFrom = ref<Record<string, string>>({});        // sectionId -> chosen source build id, defaults to `otherBuilds[0]`
const copyMenuFor = ref<string | null>(null);   // sectionId currently showing the "copy section from" popover, or null

/** Imperative ref bag for per-row ItemPickers (see `setPickerRef`) -- plain object, not
 *  `ref`/`reactive`, same as the old component's non-data `this.pickerRefs` (set up in its own
 *  `created()` hook precisely so it stayed outside Vue's reactivity). */
const pickerRefs: Record<string, any> = {};

/** slotId -> the engine's resolved row, so the item object is never looked up twice. */
const rowBySlot = computed(() => new Map(props.result.rows.map((row: any) => [row.slotId, row])));

/** slotId -> [error]. Errors are rare, so a Map beats filtering per row. */
const errorsBySlot = computed(() => {
  const map = new Map<string, any[]>();
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
const bonusById = computed(() => new Map(props.result.bonuses.map((bonus: any) => [bonus.id, bonus])));

function itemIn(slotId: string) {
  return (rowBySlot.value as Map<string, any>).get(slotId)?.item ?? null;
}

const hoveredItem = computed(() => (hover.value ? itemIn(hover.value.slotId) : null));

/**
 * Every bonus the hovered item takes part in -- its own inline ones and its sets'.
 * Not `bonuses.filter(b => b.slotId === …)`: a set bonus is attributed to the single
 * slot that instanced it, so the other pieces of the set would show nothing.
 */
const hoveredBonuses = computed(() => {
  const item = hoveredItem.value;
  if (!item) return [];
  const seen = new Set();
  const out: any[] = [];
  for (const entry of props.db.bonusesFor(item)) {
    const resolved = (bonusById.value as Map<string, any>).get(entry.bonus.id);
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

const sections = computed(() => {
  const onlyDiff = props.onlyDiff && props.compareBuild;
  return props.db.sections
    .map((section: any) => {
      const allSlots = props.db.slots.filter((slot: any) => slot.section === section.id);
      // Counted off the section's full slot list, not the (possibly onlyDiff-filtered)
      // one below -- the badge's job is telling a *collapsed* section apart, where
      // `slots` would otherwise be invisible. Same reasoning for `unsaved`.
      const diffs = props.compareBuild ? allSlots.filter((slot: any) => differs(slot.id)).length : 0;
      const unsavedFlag = allSlots.some((slot: any) => unsaved(slot.id));
      const slots = onlyDiff ? allSlots.filter((slot: any) => differs(slot.id)) : allSlots;
      let filled = 0;
      let errors = 0;
      for (const slot of slots) {
        if ((rowBySlot.value as Map<string, any>).get(slot.id)?.item) filled += 1;
        errors += errorsBySlot.value.get(slot.id)?.length ?? 0;
      }
      return { ...section, slots, filled, errors, diffs, unsaved: unsavedFlag, total: slots.length };
    })
    .filter((section: any) => !onlyDiff || section.slots.length > 0);
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
  const shown = new Set();
  const map = new Map<string, any[]>();
  for (const section of sections.value) {
    for (const slot of section.slots) {
      const item = itemIn(slot.id);
      if (!item) continue;
      const entries = [];
      for (const raw of props.db.bonusesFor(item)) {
        const resolved = (bonusById.value as Map<string, any>).get(raw.bonus.id);
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
    .filter((item: any) => !item.allowedClass || item.allowedClass.includes(cls));
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
    if (item[key]) totals[key] = (totals[key] ?? 0) + item[key];
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

// --- keyboard cursor -------------------------------------------------------------------

function isCursor(type: string, id: string) {
  return cursor.value?.type === type && cursor.value?.id === id;
}

function setCursor(type: 'header' | 'slot', id: string) {
  cursor.value = { type, id };
  syncCursorFocus();
}

function setPickerRef(slotId: string, el: any) {
  if (el) pickerRefs[slotId] = el;
  else delete pickerRefs[slotId];
}

/** Focusing the input reuses ItemPicker's own `onFocus` (opens, clears the query). Only
 *  the type-ahead case needs a seeded query, via ItemPicker's `focusAndSeed`. */
function focusPicker(slotId: string, seedChar?: string) {
  const picker = pickerRefs[slotId];
  if (!picker) return;
  if (seedChar) picker.focusAndSeed(seedChar);
  else picker.$el?.querySelector('input')?.focus();
}

/**
 * Scrolls the cursor row into view, and -- unless real focus is already somewhere inside
 * it (a click straight into the picker, say) -- moves native DOM focus to it too. Without
 * this, arrowing the visual cursor around leaves real focus stranded wherever it happened
 * to be last, and Tab from there jumps somewhere unrelated to what's highlighted; with it,
 * Tab naturally continues from the row the cursor is actually on (and, for a slot row,
 * lands on that row's own picker next, since it's tabindex="-1" and the picker input is
 * the next focusable thing after it in document order).
 */
function syncCursorFocus() {
  nextTick(() => {
    if (!cursor.value) return;
    const key = `${cursor.value.type}:${cursor.value.id}`;
    const el = root.value?.querySelector(`[data-cursor-key="${CSS.escape(key)}"]`) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ block: 'nearest' });
    if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });
  });
}

/**
 * The passive gate: arrow/type-to-edit only fires when nothing has already claimed the
 * keyboard for its own editing. This is deliberately not scoped to `.slots` -- Escape on
 * an open picker blurs its input, which sends focus to <body>, and the cursor (never
 * cleared) should be immediately live again with no extra click.
 */
function isPassiveTarget() {
  const el = document.activeElement;
  if (!el) return true;
  const tag = el.tagName;
  return tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && !(el as HTMLElement).isContentEditable;
}

function onNavKeydown(event: KeyboardEvent) {
  if (!isPassiveTarget()) return;

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    const rows = visibleRows.value;
    if (!rows.length) return;
    event.preventDefault();
    const dir = event.key === 'ArrowDown' ? 1 : -1;
    const idx = cursor.value
      ? rows.findIndex((r) => r.type === cursor.value!.type && r.id === cursor.value!.id)
      : -1;
    const next = idx === -1
      ? (dir === 1 ? 0 : rows.length - 1)
      : Math.min(Math.max(idx + dir, 0), rows.length - 1);
    setCursor(rows[next].type as 'header' | 'slot', rows[next].id);
    return;
  }

  if (!cursor.value) return;

  if (event.key === 'Enter') {
    event.preventDefault();
    if (cursor.value.type === 'header') toggle(cursor.value.id);
    else focusPicker(cursor.value.id);
    return;
  }

  if (cursor.value.type === 'slot' && (event.key === 'Backspace' || event.key === 'Delete')) {
    event.preventDefault();
    emit('choose', cursor.value.id, '');
    return;
  }

  if (cursor.value.type === 'slot' && event.key.length === 1
    && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    focusPicker(cursor.value.id, event.key);
  }
}

// --- hover card ----------------------------------------------------------------------

function onRowEnter(event: MouseEvent, slotId: string) {
  if (editing || !itemIn(slotId)) return;
  window.clearTimeout(hoverTimer);
  window.clearTimeout(leaveTimer);
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const x = event.clientX;
  // Delay: sweeping the pointer down a 180-row list should not strobe cards. But if a
  // card only just closed, this is the same sweep -- resume instantly instead of making
  // every row pay the delay again.
  const resuming = Date.now() - lastHideAt < HOVER_RESUME_MS;
  hoverTimer = window.setTimeout(
    () => place(slotId, rect, x),
    resuming ? 0 : HOVER_DELAY_MS,
  );
}

function onRowLeave() {
  window.clearTimeout(hoverTimer);
  // Grace period, not an instant close: the card sits outside the row's own bounds, so
  // reaching it always crosses this "gap" first. Without the grace period the card would
  // vanish the instant the pointer leaves the row, before it ever reaches the card.
  window.clearTimeout(leaveTimer);
  leaveTimer = window.setTimeout(() => close(), HOVER_CLOSE_GRACE_MS);
}

/** Entering the card itself cancels any pending close from leaving the row. */
function onCardEnter() {
  window.clearTimeout(leaveTimer);
}

function onCardLeave() {
  close();
}

function close() {
  window.clearTimeout(leaveTimer);
  if (hover.value) lastHideAt = Date.now();
  hover.value = null;
}

/**
 * Anchored to the pointer horizontally and to the row vertically. Anchoring to the row's
 * right edge instead would be tidier, but a slot row spans almost the full column, so
 * the card would always land on top of the stat panel.
 *
 * The vertical flip needs the card's real height, not its CSS max-height, or a short
 * card near the bottom of the screen flips for no reason -- so it is measured once the
 * card exists and nudged only if it actually overflows.
 */
function place(slotId: string, rect: DOMRect, pointerX: number) {
  const margin = 10;
  let left = pointerX + 18;
  if (left + CARD_W > window.innerWidth - margin) left = pointerX - CARD_W - 18;
  hover.value = { slotId, left: Math.max(left, margin), top: rect.bottom + 6 };

  nextTick(() => {
    const card = root.value?.querySelector('.itemcard') as HTMLElement | null;
    if (!card || !hover.value) return;
    const height = card.offsetHeight;
    if (hover.value.top + height <= window.innerHeight - margin) return;
    const flipped = Math.max(rect.top - height - 6, margin);
    hover.value = { ...hover.value, top: flipped };
  });
}

/**
 * The rect is viewport-relative, so any scroll of the page invalidates it -- close
 * immediately, skipping the leave grace period that exists only for reaching the card by
 * pointer. Registered on the capture phase (see `onMounted`) so a scroll anywhere reaches
 * it even inside a section body that stops propagation -- but capture-phase 'scroll'
 * fires for *every* scrollable element's own scrolling too, including the card's own
 * `overflow-y: auto`. Without this check, scrolling the long card's contents would look
 * indistinguishable from scrolling the page and close the card on its first wheel tick.
 */
function onScroll(event: Event) {
  if ((event.target as HTMLElement)?.closest?.('.itemcard')) return;
  window.clearTimeout(hoverTimer);
  if (hover.value) close();
}

/**
 * `setCursor`/`syncCursorFocus` push the keyboard cursor's position onto real DOM focus,
 * but focus can also move for reasons that never go through `setCursor` -- native Tab
 * order, or a click landing directly on a descendant like the picker input rather than
 * bubbling a `setCursor` call from the row div itself. Left alone, the cursor would go
 * stale and point somewhere real focus already isn't, so arrow keys from there would
 * jump from the wrong place. Syncing the other direction here -- real focus moving
 * updates the cursor to match -- keeps the two from ever disagreeing.
 */
function onFocusIn(event: FocusEvent) {
  editing = true;
  window.clearTimeout(hoverTimer);
  close();

  const key = (event.target as HTMLElement)?.closest?.('[data-cursor-key]')?.getAttribute('data-cursor-key');
  if (!key) return;
  const sep = key.indexOf(':');
  const type = key.slice(0, sep) as 'header' | 'slot';
  const id = key.slice(sep + 1);
  if (cursor.value?.type === type && cursor.value?.id === id) return;
  cursor.value = { type, id };
}

function onFocusOut() {
  editing = false;
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
  if (path.some((el: any) => el.classList?.contains?.('copy-popover') || el.classList?.contains?.('section-copy-btn'))) return;
  copyMenuFor.value = null;
}

onMounted(() => {
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('keydown', onNavKeydown);
  document.addEventListener('mousedown', onDocumentClick);
});

onUnmounted(() => {
  window.clearTimeout(hoverTimer);
  window.clearTimeout(leaveTimer);
  window.removeEventListener('scroll', onScroll, true);
  window.removeEventListener('keydown', onNavKeydown);
  document.removeEventListener('mousedown', onDocumentClick);
});
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
              {{ compareBuild.name }}: {{ otherChoice(slot.id) || '(empty)' }}
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
                :min="itemIn(slot.id).dynamicMin"
                :max="itemIn(slot.id).dynamicMax"
                :value="build.values[slot.id] ?? ''"
                :placeholder="itemIn(slot.id).dynamicMin"
                @input="$emit('set-value', slot.id, ($event.target as HTMLInputElement).value)">
              <span class="hint">
                {{ statLabel(itemIn(slot.id).dynamicStat) }}
                {{ itemIn(slot.id).dynamicMin }}–{{ itemIn(slot.id).dynamicMax }}
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
