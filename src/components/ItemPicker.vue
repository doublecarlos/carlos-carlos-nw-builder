<script setup lang="ts">
// Searchable item typeahead for one slot (plan §Phase 3, "Left").
//
// A native <datalist> was considered and rejected: it cannot show item level and a stat
// preview per row, and its keyboard behaviour is not controllable. This is ~120 lines instead.
//
// The component owns only its own transient UI state (open / query / highlight). The chosen
// value is `modelValue` and every change leaves via `update:modelValue`, so the single
// build document in App.vue stays the only source of truth (undo stack has a single place to
// hook into).
import { ref, computed, watch, nextTick } from 'vue';
import { itemPreview, hasBonuses, int as fmtInt } from '../format';
import type { Item } from '../types';
import PickerMenu from './ui/PickerMenu.vue';
import PickerRow from './ui/PickerRow.vue';

// Long filters (insignia, group buffs) run to 40+ entries. Rendering all of them for every
// keystroke is wasted work when nobody scrolls past the first screenful.
const MAX_ROWS = 60;

const props = withDefaults(defineProps<{
  modelValue?: string;
  items: Item[];
  invalid?: boolean;
}>(), {
  modelValue: '',
  invalid: false,
});

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const open = ref(false);
const query = ref('');
const highlight = ref(0);
const input = ref<HTMLInputElement | null>(null);
const list = ref<InstanceType<typeof PickerMenu> | null>(null);

const filtered = computed(() => {
  if (!open.value) return [];
  const q = query.value.trim().toLowerCase();
  return q
    ? props.items.filter((item) => item.name.toLowerCase().includes(q))
    : props.items;
});

/** Decorated once per filter change rather than once per render pass. */
const matches = computed(() => filtered.value.slice(0, MAX_ROWS).map((item) => ({
  item,
  preview: itemPreview(item, 3),
  flagged: hasBonuses(item),
})));

const hiddenCount = computed(() => Math.max(filtered.value.length - matches.value.length, 0));

/** "clear the slot" is only offered on a plain, untyped open -- once the user is
 * filtering, defaulting the highlight onto "empty" (see `onInput`) put a stray Enter one
 * keystroke away from wiping the slot instead of picking the thing just typed. */
const showEmptyOption = computed(() => !query.value.trim());

/** Index 0 is "clear the slot" whenever it's offered, so highlight indices line up with
 * the DOM either way. */
const options = computed(() => {
  const items = matches.value.map((entry) => entry.item);
  return showEmptyOption.value ? [null, ...items] : items;
});

/** How far a `matches` index sits from its `options`/`highlight` index -- 1 while "clear
 * the slot" occupies slot 0, 0 once it's hidden. */
const matchOffset = computed(() => (showEmptyOption.value ? 1 : 0));

watch(highlight, () => {
  nextTick(() => {
    (list.value?.$el as HTMLElement | undefined)?.querySelector('[data-highlighted]')?.scrollIntoView({ block: 'nearest' });
  });
});

const int = (value: unknown) => fmtInt(value);

/** Skips the reset when already open: `focusAndSeed` below pre-sets `open` before the
 *  native focus event fires, and this must not stomp the query it just seeded. */
function onFocus() {
  if (open.value) return;
  open.value = true;
  query.value = '';
  // Start on whatever is already equipped, not on "empty" -- `options` reflects the
  // now-open (unfiltered) list since `open` was just set above.
  const current = options.value.findIndex((item) => item?.name === props.modelValue);
  highlight.value = current === -1 ? 0 : current;
}

/** Called imperatively by BuildEditor's keyboard cursor (via a template ref): typing a
 *  character on a row with no input focused opens this picker pre-filtered, like Sheets
 *  overwriting a cell. Exposed explicitly -- `<script setup>` components are closed by
 *  default, unlike the old classic-object component whose methods were reachable from any
 *  $refs holder. */
function focusAndSeed(char: string) {
  open.value = true;
  query.value = char;
  highlight.value = 0;
  nextTick(() => input.value?.focus());
}

defineExpose({ focusAndSeed });

function onInput(event: Event) {
  query.value = (event.target as HTMLInputElement).value;
  open.value = true;
  highlight.value = 0;
}

function onBlur() {
  // Options use @mousedown.prevent, so a click never reaches this -- but Tab and
  // focus-stealing elsewhere do, and the dropdown must not survive them.
  close();
}

function close() {
  open.value = false;
  query.value = '';
}

/** `blur: false` for the Tab case below -- the browser's own Tab-forward looks at
 * whatever element is currently focused, so blurring here first (before that runs) would
 * make it tab from nowhere instead of continuing from this input. */
function choose(item: Item | null, { blur = true }: { blur?: boolean } = {}) {
  emit('update:modelValue', item ? item.name : '');
  close();
  if (blur) input.value?.blur();
}

/**
 * Every branch here except plain Tab also stops propagation: this input sits inside a
 * `.slot-row` that BuildEditor's own window-level keydown listener watches for its
 * passive row cursor. Without stopping propagation, the same Enter that this handler
 * uses to close the dropdown would go on to reach that listener too -- and since the
 * cursor is still parked on this row, it would immediately refocus (reopen) the very
 * picker that just closed. Relying on the listener's own focused-input gate to prevent
 * that is fragile: it depends on `blur()` having synchronously updated
 * `document.activeElement` before the bubbling event reaches `window`, which is not
 * guaranteed the same way in every browser. Tab is the exception because it never calls
 * `blur()` itself (see `choose` above) -- this input is still focused for that listener's
 * synchronous pass, so its own focused-input gate already covers it.
 */
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    event.stopPropagation();
    if (!open.value) {
      onFocus();
      return;
    }
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const last = options.value.length - 1;
    highlight.value = Math.min(Math.max(highlight.value + step, 0), last);
    return;
  }
  if (event.key === 'Enter') {
    if (!open.value) return;
    event.preventDefault();
    event.stopPropagation();
    choose(options.value[highlight.value] ?? null);
    return;
  }
  if (event.key === 'Tab') {
    if (!open.value) return;
    if (event.shiftKey) {
      // Browsing backward -- just close, don't commit a highlight the user was
      // arrowing away from.
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    // Commit the highlighted choice, same as Enter, then let the browser's own Tab
    // move focus on to whatever's next -- no preventDefault, and no stopPropagation
    // (see the block comment above `onKeydown`).
    choose(options.value[highlight.value] ?? null, { blur: false });
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    close();
    input.value?.blur();
  }
}
</script>

<template>
  <div class="relative">
    <input
      ref="input"
      data-testid="picker-input"
      class="w-full rounded-md border bg-surface py-0.5 px-1.5 placeholder:text-muted focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
      :class="invalid ? 'border-danger' : 'border-line'"
      type="text"
      autocomplete="off"
      spellcheck="false"
      :value="open ? query : (modelValue || '')"
      :placeholder="modelValue || '—'"
      @focus="onFocus"
      @input="onInput"
      @blur="onBlur"
      @keydown="onKeydown">

    <PickerMenu v-if="open" ref="list">
      <PickerRow
        v-if="showEmptyOption"
        muted
        :highlighted="highlight === 0"
        @mousedown.prevent="choose(null)"
        @mouseenter="highlight = 0">— empty —</PickerRow>

      <PickerRow
        v-for="(entry, index) in matches"
        :key="entry.item.name"
        :highlighted="highlight === index + matchOffset"
        @mousedown.prevent="choose(entry.item)"
        @mouseenter="highlight = index + matchOffset">
        <div class="flex items-baseline gap-1.5">
          <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{{ entry.item.name }}</span>
          <span v-if="entry.flagged" class="text-sm text-accent" title="has conditional bonuses">◈</span>
          <span v-if="entry.item.il" class="text-sm text-muted tabular-nums">iL {{ int(entry.item.il) }}</span>
        </div>
        <div class="flex flex-wrap gap-2 text-sm text-muted">
          <span v-for="part in entry.preview.parts" :key="part">{{ part }}</span>
          <span v-if="entry.preview.more" class="italic">+{{ entry.preview.more }} more</span>
        </div>
      </PickerRow>

      <PickerRow v-if="!matches.length" muted>no match</PickerRow>
      <PickerRow v-if="hiddenCount" muted>{{ hiddenCount }} more — keep typing</PickerRow>
    </PickerMenu>
  </div>
</template>
