<script setup lang="ts">
// Single-value creatable combobox: type-to-filter over known options, with free text for a
// value that doesn't exist yet. Same "show what exists, allow typing something new" contract
// as TokenInput, but for one scalar field (e.g. an item's filter) instead of a tag list.
//
// Like ComboBox, the field shows a live `query` while open (starting blank, so focusing an
// already-filled field still browses the full option list, with the current pick as its
// placeholder) and the committed `model` once closed. Unlike ComboBox, committing isn't limited to picking a listed option -- typing
// something new and blurring or pressing Enter/Tab commits the typed text itself.
//
// Options are `{ value, label }` and a row is an OptionRow, so a labeled value is found by its
// label or its value. The closed field shows the value, or with `showValue` its label with the
// value after it, small and muted, as ComboBox does.
//
// An untyped open highlights the current value, so Enter or Tab through the field keeps it.
// `showEmptyOption` adds an "- empty -" row on that open, the keyboard way to clear the
// field, and a clear button kept out of the tab order while it is filled. A closed field
// showing a value has a tooltip with the label and the full value, wrapping the whole field so
// the input keeps its own `aria-describedby`.
import { X } from "@lucide/vue";
import { computed, watch, useId, useTemplateRef } from "vue";
import { onKeyStroke } from "@vueuse/core";
import { filterAndRank } from "../../lib/text-filter";
import { useMenuNavigation } from "../../composables/useMenuNavigation";
import { useFormFieldControl } from "../../composables/useFormField";
import ComboBoxMenu from "./ComboBoxMenu.vue";
import ComboBoxMenuRow from "./ComboBoxMenuRow.vue";
import ComboBoxValueId from "./ComboBoxValueId.vue";
import OptionRow from "./OptionRow.vue";
import IconButton from "./IconButton.vue";
import BaseTooltip from "./BaseTooltip.vue";
import type { ComboBoxOption } from "./ComboBox.vue";

const MAX_SUGGESTIONS = 40;

const props = withDefaults(
  defineProps<{
    options?: ComboBoxOption[];
    placeholder?: string;
    testid?: string;
    /** Offer "- empty -" as the first row of an untyped open, to clear the field. */
    showEmptyOption?: boolean;
    /** Show the label in the closed field, with the value beside it. */
    showValue?: boolean;
  }>(),
  {
    options: () => [],
    placeholder: "",
    testid: undefined,
    showEmptyOption: false,
    showValue: false,
  },
);

// The caller's classes and attributes belong on the field, not on the tooltip's wrapper.
defineOptions({ inheritAttrs: false });

const model = defineModel<string>({ default: "" });
const { id: controlId, describedBy } = useFormFieldControl();

const input = useTemplateRef("input");
const menu = useTemplateRef("menu");

const { open, query, highlight, close, pointAt } = useMenuNavigation({
  target: input,
  entryCount: () => entries.value.length,
  onHighlightChange: () => menu.value?.scrollToHighlighted(),
});

const suggestions = computed(() => {
  if (!open.value) return [];
  return filterAndRank(
    props.options,
    query.value,
    (option) => [option.value, option.label, option.search ?? ""],
    (option) => option.value,
  ).slice(0, MAX_SUGGESTIONS);
});

/** Offering the typed text itself as a "new" entry when it isn't already a known option. */
const freeValue = computed(() => {
  const value = query.value.trim();
  if (
    !value ||
    props.options.some(
      (option) => option.value === value || option.label === value,
    )
  )
    return "";
  return value;
});

/** What the closed field reads: the value, or its label under `showValue`. */
const closedText = computed(() =>
  props.showValue
    ? (props.options.find((option) => option.value === model.value)?.label ??
      model.value)
    : model.value,
);

/** The value shown after the label, unless it would repeat it. */
const shownValue = computed(() =>
  props.showValue && model.value !== closedText.value ? model.value : "",
);

/** The label and full value, while the closed field shows a value that may be cut short. */
const valueTooltip = computed(() =>
  shownValue.value && !open.value
    ? `${closedText.value}
${shownValue.value}`
    : "",
);

const clearable = computed(() => props.showEmptyOption && Boolean(model.value));

/** While open, the current pick stands in as the placeholder, read like a value and shown as
 *  the closed field shows it. */
const shownPlaceholder = computed(() =>
  open.value && model.value ? closedText.value : props.placeholder,
);

/** Typed text naming an option by its label commits that option's value. */
const valueOf = (text: string) =>
  props.options.find((option) => option.label === text.trim())?.value ?? text;

/** The "- empty -" row, told apart by its value: no option or typed text commits as "". */
const EMPTY: ComboBoxOption = { value: "", label: "- empty -" };

const entries = computed<ComboBoxOption[]>(() => {
  if (freeValue.value)
    return [
      { value: freeValue.value, label: freeValue.value },
      ...suggestions.value,
    ];
  if (props.showEmptyOption && open.value && !query.value.trim())
    return [EMPTY, ...suggestions.value];
  return suggestions.value;
});

// Same accessible-combobox wiring as ComboBox.vue: focus stays on the input while `highlight`
// moves, so the active row is named by `aria-activedescendant` rather than focused.
const listboxId = useId();
const optionId = (index: number) => `${listboxId}-option-${index}`;
const menuOpen = computed(() => open.value && entries.value.length > 0);
const activeDescendant = computed(() =>
  menuOpen.value && highlight.value >= 0
    ? optionId(highlight.value)
    : undefined,
);

/** Typed text leads with its best match; an untyped open rests on the current value, or on
 *  nothing when it is not listed, so Enter and Tab never replace it unasked. */
function resetHighlight() {
  highlight.value = query.value.trim()
    ? 0
    : entries.value.findIndex((entry) => entry.value === model.value);
}

watch(entries, resetHighlight);

function commit(value: string) {
  model.value = valueOf(value).trim();
  close();
}

/** The clear button's action: empties the field, leaving focus alone. */
function clear() {
  query.value = "";
  model.value = "";
  close();
}

function onFocus() {
  open.value = true;
  query.value = "";
  resetHighlight();
}

/** Picking a row closes the menu but keeps focus, so a click on the field reopens it. */
function onClick() {
  if (!open.value) onFocus();
}

function onInput(event: Event) {
  query.value = (event.target as HTMLInputElement).value;
  open.value = true;
  resetHighlight();
}

/** A typed-but-uncommitted query is saved on blur (matching plain-input expectations --
 *  filling the field and clicking elsewhere shouldn't discard what was typed). Blurring an
 *  untouched, freshly-opened field leaves the existing value alone. */
function onBlur() {
  if (query.value.trim()) commit(query.value);
  else close();
}

onKeyStroke(
  ["Enter", "Tab"],
  (event) => {
    if (!open.value) return;
    const picked = entries.value[highlight.value];
    if (!picked && !query.value.trim()) return;
    if (event.key === "Enter") event.preventDefault();
    commit(picked ? picked.value : query.value);
  },
  { target: input },
);
</script>

<template>
  <BaseTooltip :text="valueTooltip">
    <div class="relative" v-bind="$attrs">
      <input
        :id="controlId"
        ref="input"
        :aria-describedby="describedBy"
        class="w-full rounded-md border border-line bg-surface py-0.5 pl-1.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
        :class="[
          model ? 'placeholder:text-text' : 'placeholder:text-muted',
          clearable
            ? 'pr-7 pointer-coarse:pr-[calc(var(--spacing-tap)+0.25rem)]'
            : 'pr-1.5',
        ]"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        :aria-expanded="menuOpen ? 'true' : 'false'"
        :aria-controls="menuOpen ? listboxId : undefined"
        :aria-activedescendant="activeDescendant"
        autocomplete="off"
        spellcheck="false"
        :value="open ? query : closedText"
        :placeholder="shownPlaceholder"
        :data-testid="testid"
        @focus="onFocus"
        @click="onClick"
        @input="onInput"
        @blur="onBlur"
      />
      <ComboBoxValueId
        v-if="shownValue && !open"
        :label="closedText"
        :value="shownValue"
        :class="
          clearable
            ? 'right-7 pointer-coarse:right-[calc(var(--spacing-tap)+0.25rem)]'
            : 'right-1.5'
        "
      />
      <IconButton
        v-if="clearable"
        class="absolute right-1 top-1/2 -translate-y-1/2"
        title="Clear"
        tabindex="-1"
        data-testid="combobox-clear"
        @mousedown.prevent
        @click="clear"
      >
        <X />
      </IconButton>

      <ComboBoxMenu v-if="menuOpen" ref="menu" :listbox-id="listboxId">
        <ComboBoxMenuRow
          v-for="(entry, index) in entries"
          :id="optionId(index)"
          :key="entry.value"
          :muted="entry === EMPTY"
          :highlighted="index === highlight"
          :selected="entry.value === model"
          @mousedown.prevent="commit(entry.value)"
          @mousemove="pointAt($event, index)"
        >
          <span class="flex items-center gap-2">
            <span v-if="entry === EMPTY">{{ entry.label }}</span>
            <span v-else class="min-w-0 flex-1"
              ><OptionRow :option="entry"
            /></span>
            <span
              v-if="freeValue && entry.value === freeValue"
              class="ml-auto rounded bg-ok/25 px-1.5 text-ok"
              >new</span
            >
          </span>
        </ComboBoxMenuRow>
      </ComboBoxMenu>
    </div>
  </BaseTooltip>
</template>
