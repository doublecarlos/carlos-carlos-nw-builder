<script lang="ts">
export interface ComboBoxOption {
  value: string;
  label: string;
  search?: string;
  /** Heading this option sits under. A heading row is drawn wherever the group changes from
   *  one listed option to the next, so options must arrive already grouped -- which lets a
   *  caller keep its own order (BuildComboBox lists builds in sidebar order, folders and
   *  ungrouped builds interleaved exactly as the sidebar draws them). Matched by the query
   *  like `search` is, so typing a group's name narrows the list to it. */
  group?: string;
}

/** What a template ref on this component can call. Spelled out rather than derived with
 *  `InstanceType<typeof ComboBox>`, which a generic component has no constructor to give. */
export interface ComboBoxExposed {
  focusInput: () => void;
  focusAndSeed: (char: string) => void;
}
</script>

<script setup lang="ts" generic="T extends ComboBoxOption">
// Typeable single-select dropdown over a fixed, small option list. Replaces a native <select>
// wherever the option list is short and known ahead of time (class, role, combat type,
// damage type, forte picks).
//
// Reuses ComboBoxMenu/ComboBoxMenuRow primitives for the floating dropdown.
import { ref, computed, watch, nextTick, useId, useTemplateRef } from "vue";
import { onKeyStroke } from "@vueuse/core";
import { blurToRowAnchor } from "../../lib/row-cursor";
import { matchesQuery } from "../../lib/text-filter";
import ComboBoxMenu from "./ComboBoxMenu.vue";
import ComboBoxMenuRow from "./ComboBoxMenuRow.vue";

const props = withDefaults(
  defineProps<{
    /** [{ value, label }], in the order they should list. `search` is optional extra haystack
     *  a query may match on besides the visible label -- ItemPicker fills it with an item's
     *  stats and bonuses so "severity" finds gear that never spells it in the name. Matched
     *  against, never displayed. Generic over the option type so a caller's own extra fields
     *  (BuildComboBox's folder name) reach the `option` slot with their types intact. */
    options: T[];
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
    /** Forwarded to ComboBoxMenu*/
    menuClass?: string;
    /** Add title properties to input and/or selection rows */
    titleInput?: boolean;
    titleRows?: boolean;
    /** The input's own DOM id, so a `<label for>` written by an ancestor can point at it.
     *  Passed in rather than generated here, since that ancestor needs the same value. */
    inputId?: string;
  }>(),
  {
    placeholder: "-",
    invalid: false,
    showEmptyOption: false,
    maxRows: 60,
    closedDisplay: "",
    menuClass: "inset-x-0",
    titleInput: true,
    titleRows: true,
    inputId: undefined,
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
    matchesQuery(
      [option.label, option.search ?? "", option.group ?? ""],
      query.value,
    ),
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

type Row<O> =
  | { kind: "empty" }
  | { kind: "group"; label: string }
  | { kind: "option"; option: O };

/**
 * Every row the menu draws, in order, `highlight`'s index space and the DOM's alike -- so the
 * id under `aria-activedescendant` and the row wearing `data-highlighted` can never drift
 * apart, whatever mix of choosable and heading rows the list ends up with.
 *
 * A heading is emitted wherever the group changes between consecutive listed options, so one
 * whose options all filtered out never appears, and a group the caller lists twice (a folder
 * with an ungrouped build between it and the next) gets a heading each time -- both of which
 * fall out of the caller's own ordering rather than needing to be reasoned about here.
 */
const rows = computed<Row<T>[]>(() => {
  const out: Row<T>[] = [];
  if (showEmpty.value) out.push({ kind: "empty" });
  let group: string | undefined;
  for (const option of filtered.value) {
    if (option.group !== group) {
      group = option.group;
      if (group) out.push({ kind: "group", label: group });
    }
    out.push({ kind: "option", option });
  }
  return out;
});

/** Where in `rows` the keyboard cursor is allowed to land -- headings are passed over rather
 *  than stopped on, so arrowing down a grouped list never rests somewhere Enter does nothing. */
const stops = computed(() =>
  rows.value.flatMap((row, index) => (row.kind === "group" ? [] : [index])),
);

// --- accessible combobox wiring ----------------------------------------------------------
// The input is a real text box that happens to drive a list, so it carries the combobox role
// itself and the menu below is its listbox. Focus never leaves the input -- arrow keys move
// `highlight`, not focus -- which is exactly the case `aria-activedescendant` exists for:
// it names the row the cursor is on without moving the focus ring off the input.

const listboxId = useId();

/** Row ids index `rows`, so they cover heading rows too and stay stable as the list filters. */
const optionId = (index: number) => `${listboxId}-option-${index}`;

const activeDescendant = computed(() =>
  open.value && rows.value.length ? optionId(highlight.value) : undefined,
);

watch(highlight, () => {
  nextTick(() => list.value?.scrollToHighlighted());
});

/** The first row the cursor may rest on -- past a heading when the list opens on one. */
const firstStop = () => stops.value[0] ?? 0;

/** Skips the reset when already open: `focusAndSeed` below pre-sets `open` before the
 *  native focus event fires, and this must not stomp the query it just seeded. */
function onFocus() {
  if (open.value) return;
  open.value = true;
  query.value = "";
  // Start on whatever is already selected, not on "empty" -- `rows` reflects the
  // now-open (unfiltered) list since `open` was just set above.
  const current = rows.value.findIndex(
    (row) => row.kind === "option" && row.option.value === model.value,
  );
  highlight.value = current === -1 ? firstStop() : current;
}

function onInput(event: Event) {
  query.value = (event.target as HTMLInputElement).value;
  open.value = true;
  highlight.value = firstStop();
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
function chooseRow(row: Row<T> | undefined, options: { blur?: boolean } = {}) {
  if (!row || row.kind === "group") return;
  choose(row.kind === "option" ? row.option : null, options);
}

function choose(option: T | null, { blur = true }: { blur?: boolean } = {}) {
  model.value = option ? option.value : "";
  close();
  // Blur to the row's cursor anchor when this input sits in one (see blurToRowAnchor):
  // choosing with Enter or clicking an option must keep the row cursor alive, not drop
  // focus to <body> where arrow keys die until the user clicks a row again.
  if (blur) blurToRowAnchor(input.value);
}

/** Focuses the input, which opens the list on a fresh query the same way a click does (see
 *  `onFocus`). Exposed so the keyboard cursor's owners never have to reach through `$el` for
 *  an input this component should be the only one to know the shape of. */
function focusInput() {
  input.value?.focus();
}

/** Called imperatively by BuildEditor's keyboard cursor (via a template ref): typing a
 *  character on a row with no input focused opens this picker pre-filtered, like Sheets
 *  overwriting a cell. Exposed explicitly -- `<script setup>` components are closed by
 *  default. */
function focusAndSeed(char: string) {
  open.value = true;
  query.value = char;
  highlight.value = firstStop();
  nextTick(() => input.value?.focus());
}

defineExpose({ focusInput, focusAndSeed });

// --- keyboard handling via onKeyStroke (scoped to the input ref) ------------------------

/**
 * Every branch here except plain Tab stops propagation so the picker's keys stay isolated
 * from whatever else is listening further up the tree. With the native-focus cursor
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
    // Stepping through `stops` rather than through `rows` is what skips headings, and it
    // stops at either end rather than wrapping -- same as it always did.
    const step = e.key === "ArrowDown" ? 1 : -1;
    const at = stops.value.indexOf(highlight.value);
    const next = Math.min(
      Math.max((at === -1 ? 0 : at) + step, 0),
      stops.value.length - 1,
    );
    highlight.value = stops.value[next] ?? highlight.value;
  },
  { target: input },
);

onKeyStroke(
  "Enter",
  (e) => {
    if (!open.value) return;
    e.preventDefault();
    e.stopPropagation();
    chooseRow(rows.value[highlight.value]);
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
    chooseRow(rows.value[highlight.value], { blur: false });
  },
  { target: input },
);
</script>

<template>
  <div class="relative">
    <input
      :id="inputId"
      ref="input"
      data-testid="picker-input"
      class="w-full rounded-md border bg-surface py-0.5 pl-1.5 pr-6 placeholder:text-muted focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
      :class="invalid ? 'border-danger' : 'border-line'"
      type="text"
      role="combobox"
      aria-autocomplete="list"
      :aria-expanded="open ? 'true' : 'false'"
      :aria-controls="open ? listboxId : undefined"
      :aria-activedescendant="activeDescendant"
      :aria-invalid="invalid ? 'true' : undefined"
      autocomplete="off"
      spellcheck="false"
      :value="open ? query : closedDisplay || (selected ? selected.label : '')"
      :title="titleInput ? closedDisplay || (selected?.label ?? '') : ''"
      :placeholder="placeholder"
      @focus="onFocus"
      @input="onInput"
      @blur="onBlur"
    />
    <!-- Sits in the same right-hand gutter the input's padding reserves -- the only hint
         this text input is actually a fixed-choice dropdown. -->
    <span
      class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted"
      >▾</span
    >

    <ComboBoxMenu
      v-if="open"
      ref="list"
      :menu-class="menuClass"
      :listbox-id="listboxId"
    >
      <template
        v-for="(row, index) in rows"
        :key="row.kind === 'option' ? row.option.value : `${row.kind}:${index}`"
      >
        <!-- A heading: named for assistive tech, but not an option and never a cursor stop. -->
        <ComboBoxMenuRow
          v-if="row.kind === 'group'"
          presentational
          testid="picker-group"
        >
          <slot name="group" :label="row.label">
            <span class="text-xs font-semibold uppercase text-muted">{{
              row.label
            }}</span>
          </slot>
        </ComboBoxMenuRow>

        <ComboBoxMenuRow
          v-else-if="row.kind === 'empty'"
          :id="optionId(index)"
          muted
          :highlighted="highlight === index"
          :selected="model === ''"
          @mousedown.prevent="choose(null)"
          @mouseenter="highlight = index"
        >
          <slot name="empty">- empty -</slot>
        </ComboBoxMenuRow>

        <ComboBoxMenuRow
          v-else
          :id="optionId(index)"
          :title="titleRows && row.option.label"
          :highlighted="highlight === index"
          :selected="row.option.value === model"
          @mousedown.prevent="choose(row.option)"
          @mouseenter="highlight = index"
        >
          <slot
            v-if="$slots.option"
            name="option"
            :option="row.option"
            :highlighted="highlight === index"
          />
          <div v-else class="flex items-baseline gap-1.5">
            <span
              class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
              >{{ row.option.label }}</span
            >
          </div>
        </ComboBoxMenuRow>
      </template>

      <ComboBoxMenuRow v-if="!filtered.length" muted presentational>
        <slot name="no-match">no match</slot>
      </ComboBoxMenuRow>
      <ComboBoxMenuRow v-if="hiddenCount" muted presentational>
        <slot name="more" :count="hiddenCount"
          >{{ hiddenCount }} more - keep typing</slot
        >
      </ComboBoxMenuRow>
    </ComboBoxMenu>
  </div>
</template>
