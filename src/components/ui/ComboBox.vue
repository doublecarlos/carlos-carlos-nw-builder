<script setup lang="ts">
// Typeable single-select dropdown over a fixed, small option list. Replaces a native <select>
// wherever the option list is short and known ahead of time (class, role, combat type,
// damage type, forte picks).
//
// Reuses ComboBoxMenu/ComboBoxMenuRow primitives for the floating dropdown.
import { ref, computed, watch, nextTick, useTemplateRef } from "vue";
import { onKeyStroke } from "@vueuse/core";
import { blurToRowAnchor } from "../../lib/row-cursor";
import { matchesQuery } from "../../lib/text-filter";
import ComboBoxMenu from "./ComboBoxMenu.vue";
import ComboBoxMenuRow from "./ComboBoxMenuRow.vue";

const props = withDefaults(
  defineProps<{
    /** [{ value, label }], in the order they should list. */
    options: { value: string; label: string }[];
    placeholder?: string;
    /** Red border while the current choice fails validation. */
    invalid?: boolean;
    /** Offer "clear the slot" as the first, highlightable row. */
    showEmptyOption?: boolean;
    /** Cap on rendered rows -- filters run to 40+ entries and nobody scrolls past the
     *  first screenful, so rendering everything for every keystroke is wasted work. */
    maxRows?: number;
    /** Override the closed-box display when the model value doesn't match any option
     *  (e.g. the equipped item was removed from the catalogue). */
    closedDisplay?: string;
    /** Forwarded to ComboBoxMenu -- grows the dropdown past the input's own width for callers
     *  whose row content needs more room than a plain option label does. */
    wide?: boolean;
    /** Add title properties to input and/or selection rows */
    titleInput?: boolean;
    titleRows?: boolean;
  }>(),
  {
    placeholder: "—",
    invalid: false,
    showEmptyOption: false,
    maxRows: 60,
    closedDisplay: "",
    wide: false,
    titleInput: true,
    titleRows: true,
  },
);

const emit = defineEmits<{
  /** Mirrors `open` outward -- callers that need to know without polling the exposed ref
   *  (e.g. ItemPicker.vue gating its own expensive per-candidate work to only run while the
   *  dropdown is actually open, same reasoning as this component's own `filtered` below). */
  "update:open": [value: boolean];
}>();

const model = defineModel<string>({ default: "" });

const open = ref(false);
watch(open, (value) => emit("update:open", value));
const query = ref("");
const highlight = ref(0);
const input = useTemplateRef("input");
const list = ref<InstanceType<typeof ComboBoxMenu> | null>(null);

const selected = computed(
  () => props.options.find((option) => option.value === model.value) ?? null,
);

const filtered = computed(() => {
  if (!open.value) return [];
  const source = props.options.filter((option) =>
    matchesQuery(option.label, query.value),
  );
  return source.slice(0, props.maxRows);
});

/** Rows cut by `maxRows`, reported in the menu's footer so filtering feels bounded. */
const hiddenCount = computed(() =>
  Math.max(props.options.length - filtered.value.length, 0),
);

/** "clear the slot" is only offered on a plain, untyped open -- once the user is
 * filtering, defaulting the highlight onto "empty" would put a stray Enter one keystroke
 * away from wiping the slot instead of picking the thing just typed. */
const showEmpty = computed(() => props.showEmptyOption && !query.value.trim());

/** Index 0 is "clear the slot" whenever it's offered, so highlight indices line up with
 * the DOM either way. */
const rowOptions = computed(() =>
  showEmpty.value ? [null, ...filtered.value] : filtered.value,
);

/** How far a `filtered` index sits from its `rowOptions`/`highlight` index -- 1 while "clear
 * the slot" occupies slot 0, 0 once it's hidden. */
const matchOffset = computed(() => (showEmpty.value ? 1 : 0));

watch(highlight, () => {
  nextTick(() => list.value?.scrollToHighlighted());
});

/** Skips the reset when already open: `focusAndSeed` below pre-sets `open` before the
 *  native focus event fires, and this must not stomp the query it just seeded. */
function onFocus() {
  if (open.value) return;
  open.value = true;
  query.value = "";
  // Start on whatever is already selected, not on "empty" -- `rowOptions` reflects the
  // now-open (unfiltered) list since `open` was just set above.
  const current = rowOptions.value.findIndex(
    (option) => option && option.value === model.value,
  );
  highlight.value = current === -1 ? 0 : current;
}

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
  query.value = "";
}

/** `blur: false` for the Tab case below -- the browser's own Tab-forward looks at
 * whatever element is currently focused, so blurring here first (before that runs) would
 * make it tab from nowhere instead of continuing from this input. */
function choose(
  option: { value: string; label: string } | null,
  { blur = true }: { blur?: boolean } = {},
) {
  model.value = option ? option.value : "";
  close();
  // Blur to the row's cursor anchor when this input sits in one (see blurToRowAnchor):
  // choosing with Enter or clicking an option must keep the row cursor alive, not drop
  // focus to <body> where arrow keys die until the user clicks a row again.
  if (blur) blurToRowAnchor(input.value);
}

/** Called imperatively by BuildEditor's keyboard cursor (via a template ref): typing a
 *  character on a row with no input focused opens this picker pre-filtered, like Sheets
 *  overwriting a cell. Exposed explicitly -- `<script setup>` components are closed by
 *  default. */
function focusAndSeed(char: string) {
  open.value = true;
  query.value = char;
  highlight.value = 0;
  nextTick(() => input.value?.focus());
}

defineExpose({ focusAndSeed });

// --- keyboard handling via onKeyStroke (scoped to the input ref) ------------------------

/**
 * Every branch here except plain Tab stops propagation so the picker's keys stay isolated
 * from whatever else is listening further up the tree. With the native-focus cursor (#62)
 * this is purely defensive -- the row's cursor anchor is a *sibling* of this input, not an
 * ancestor, so its keydown listeners can't receive these events anyway -- but no other
 * window-level listener should see Enter/arrows that belong to an open dropdown either.
 * Tab is the exception because it never calls `blur()` itself (see `choose` above) -- this
 * input is still focused when the browser's own Tab-forward runs.
 */

onKeyStroke(
  "Escape",
  (e) => {
    e.preventDefault();
    e.stopPropagation();
    close();
    // Same blur-to-anchor as choose: Escape closes the picker but keeps the row cursor.
    blurToRowAnchor(input.value);
  },
  { target: input },
);

onKeyStroke(
  ["ArrowDown", "ArrowUp"],
  (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!open.value) {
      onFocus();
      return;
    }
    const step = e.key === "ArrowDown" ? 1 : -1;
    const last = rowOptions.value.length - 1;
    highlight.value = Math.min(Math.max(highlight.value + step, 0), last);
  },
  { target: input },
);

onKeyStroke(
  "Enter",
  (e) => {
    if (!open.value) return;
    e.preventDefault();
    e.stopPropagation();
    choose(rowOptions.value[highlight.value] ?? null);
  },
  { target: input },
);

onKeyStroke(
  "Tab",
  (e) => {
    if (!open.value) return;
    if (e.shiftKey) {
      // Browsing backward -- just close, don't commit a highlight the user was
      // arrowing away from.
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    // Commit the highlighted choice, same as Enter, then let the browser's own Tab
    // move focus on to whatever's next -- no preventDefault, and no stopPropagation
    // (see the block comment above).
    choose(rowOptions.value[highlight.value] ?? null, { blur: false });
  },
  { target: input },
);
</script>

<template>
  <div class="relative">
    <input
      ref="input"
      data-testid="picker-input"
      class="w-full rounded-md border bg-surface py-0.5 pl-1.5 pr-6 placeholder:text-muted focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
      :class="invalid ? 'border-danger' : 'border-line'"
      type="text"
      autocomplete="off"
      spellcheck="false"
      :value="open ? query : closedDisplay || (selected ? selected.label : '')"
      :title="titleInput ? (selected?.label ?? '') : ''"
      :placeholder="placeholder"
      @focus="onFocus"
      @input="onInput"
      @blur="onBlur"
    />
    <!-- Sits in the same right-hand gutter the input's padding reserves -- the only hint
         this text input is actually a fixed-choice dropdown. -->
    <span
      class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-sm text-muted"
      >▾</span
    >

    <ComboBoxMenu v-if="open" ref="list" :wide="wide">
      <ComboBoxMenuRow
        v-if="showEmpty"
        muted
        :highlighted="highlight === 0"
        @mousedown.prevent="choose(null)"
        @mouseenter="highlight = 0"
      >
        <slot name="empty">— empty —</slot>
      </ComboBoxMenuRow>

      <ComboBoxMenuRow
        v-for="(option, index) in filtered"
        :key="option.value"
        :title="titleRows && option.label"
        :highlighted="highlight === index + matchOffset"
        @mousedown.prevent="choose(option)"
        @mouseenter="highlight = index + matchOffset"
      >
        <slot
          v-if="$slots.option"
          name="option"
          :option="option"
          :highlighted="highlight === index + matchOffset"
        />
        <div v-else class="flex items-baseline gap-1.5">
          <span
            class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
            >{{ option.label }}</span
          >
        </div>
      </ComboBoxMenuRow>

      <ComboBoxMenuRow v-if="!filtered.length" muted>
        <slot name="no-match">no match</slot>
      </ComboBoxMenuRow>
      <ComboBoxMenuRow v-if="hiddenCount" muted>
        <slot name="more" :count="hiddenCount"
          >{{ hiddenCount }} more — keep typing</slot
        >
      </ComboBoxMenuRow>
    </ComboBoxMenu>
  </div>
</template>
