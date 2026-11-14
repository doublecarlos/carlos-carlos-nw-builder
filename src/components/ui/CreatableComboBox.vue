<script setup lang="ts">
// Single-value creatable combobox: type-to-filter over known options, with free text for a
// value that doesn't exist yet. Same "show what exists, allow typing something new" contract
// as TokenInput, but for one scalar field (e.g. an item's filter) instead of a tag list.
//
// Like ComboBox, the field shows a live `query` while open (starting blank, so focusing an
// already-filled field still browses the full option list) and the committed `model` once
// closed. Unlike ComboBox, committing isn't limited to picking a listed option -- typing
// something new and blurring or pressing Enter/Tab commits the typed text itself.
//
// Options are `{ value, label }` and a row is an OptionRow, so a labeled value is found by its
// label or its value. The field itself holds the value.
import { computed, watch, useId, useTemplateRef } from "vue";
import { onKeyStroke } from "@vueuse/core";
import { filterAndRank } from "../../lib/text-filter";
import { useMenuNavigation } from "../../composables/useMenuNavigation";
import { useFormFieldControl } from "../../composables/useFormField";
import ComboBoxMenu from "./ComboBoxMenu.vue";
import ComboBoxMenuRow from "./ComboBoxMenuRow.vue";
import OptionRow from "./OptionRow.vue";
import type { ComboBoxOption } from "./ComboBox.vue";

const MAX_SUGGESTIONS = 40;

const props = withDefaults(
  defineProps<{
    options?: ComboBoxOption[];
    placeholder?: string;
    testid?: string;
  }>(),
  {
    options: () => [],
    placeholder: "",
    testid: undefined,
  },
);

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

/** Typed text naming an option by its label commits that option's value. */
const valueOf = (text: string) =>
  props.options.find((option) => option.label === text.trim())?.value ?? text;

const entries = computed<ComboBoxOption[]>(() =>
  freeValue.value
    ? [{ value: freeValue.value, label: freeValue.value }, ...suggestions.value]
    : suggestions.value,
);

// Same accessible-combobox wiring as ComboBox.vue: focus stays on the input while `highlight`
// moves, so the active row is named by `aria-activedescendant` rather than focused.
const listboxId = useId();
const optionId = (index: number) => `${listboxId}-option-${index}`;
const menuOpen = computed(() => open.value && entries.value.length > 0);
const activeDescendant = computed(() =>
  menuOpen.value ? optionId(highlight.value) : undefined,
);

watch(entries, () => {
  highlight.value = 0;
});

function commit(value: string) {
  model.value = valueOf(value).trim();
  close();
}

function onFocus() {
  open.value = true;
  query.value = "";
  highlight.value = 0;
}

function onInput(event: Event) {
  query.value = (event.target as HTMLInputElement).value;
  open.value = true;
  highlight.value = 0;
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
    const value = picked?.value ?? query.value;
    if (!value.trim()) return;
    if (event.key === "Enter") event.preventDefault();
    commit(value);
  },
  { target: input },
);
</script>

<template>
  <div class="relative">
    <input
      :id="controlId"
      ref="input"
      :aria-describedby="describedBy"
      class="w-full rounded-md border border-line bg-surface px-1.5 py-0.5 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
      type="text"
      role="combobox"
      aria-autocomplete="list"
      :aria-expanded="menuOpen ? 'true' : 'false'"
      :aria-controls="menuOpen ? listboxId : undefined"
      :aria-activedescendant="activeDescendant"
      autocomplete="off"
      spellcheck="false"
      :value="open ? query : model"
      :placeholder="placeholder"
      :data-testid="testid"
      @focus="onFocus"
      @input="onInput"
      @blur="onBlur"
    />

    <ComboBoxMenu v-if="menuOpen" ref="menu" :listbox-id="listboxId">
      <ComboBoxMenuRow
        v-for="(entry, index) in entries"
        :id="optionId(index)"
        :key="entry.value"
        :highlighted="index === highlight"
        :selected="entry.value === model"
        @mousedown.prevent="commit(entry.value)"
        @mousemove="pointAt($event, index)"
      >
        <span class="flex items-center gap-2">
          <span class="min-w-0 flex-1"><OptionRow :option="entry" /></span>
          <span
            v-if="entry.value === freeValue"
            class="ml-auto rounded bg-ok/25 px-1.5 text-ok"
            >new</span
          >
        </span>
      </ComboBoxMenuRow>
    </ComboBoxMenu>
  </div>
</template>
