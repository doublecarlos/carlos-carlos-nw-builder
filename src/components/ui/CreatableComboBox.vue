<script setup lang="ts">
// Single-value creatable combobox: type-to-filter over known options, with free text for a
// value that doesn't exist yet. Same "show what exists, allow typing something new" contract
// as TokenInput, but for one scalar field (e.g. an item's filter) instead of a tag list.
//
// Like ComboBox, the field shows a live `query` while open (starting blank, so focusing an
// already-filled field still browses the full option list) and the committed `model` once
// closed. Unlike ComboBox, committing isn't limited to picking a listed option -- typing
// something new and blurring or pressing Enter/Tab commits the typed text itself.
import { ref, computed, watch, nextTick, useId, useTemplateRef } from "vue";
import { onKeyStroke } from "@vueuse/core";
import { matchesQuery } from "../../lib/text-filter";
import ComboBoxMenu from "./ComboBoxMenu.vue";
import ComboBoxMenuRow from "./ComboBoxMenuRow.vue";

const MAX_SUGGESTIONS = 40;

const props = withDefaults(
  defineProps<{
    options?: string[];
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

const query = ref("");
const open = ref(false);
const highlight = ref(0);
const input = useTemplateRef("input");
const menu = useTemplateRef("menu");

const suggestions = computed(() => {
  if (!open.value) return [];
  return props.options
    .filter((option) => matchesQuery(option, query.value))
    .slice(0, MAX_SUGGESTIONS);
});

/** Offering the typed text itself as a "new" entry when it isn't already a known option. */
const freeValue = computed(() => {
  const value = query.value.trim();
  if (!value || props.options.includes(value)) return "";
  return value;
});

const entries = computed(() =>
  freeValue.value ? [freeValue.value, ...suggestions.value] : suggestions.value,
);

// Same accessible-combobox wiring as ComboBox.vue: focus stays on the input while `highlight`
// moves, so the active row is named by `aria-activedescendant` rather than focused.
const listboxId = useId();
const optionId = (index: number) => `${listboxId}-option-${index}`;
const menuOpen = computed(() => open.value && entries.value.length > 0);
const activeDescendant = computed(() =>
  menuOpen.value ? optionId(highlight.value) : undefined,
);

watch(highlight, () => {
  nextTick(() => menu.value?.scrollToHighlighted());
});

watch(entries, () => {
  highlight.value = 0;
});

function commit(value: string) {
  model.value = value.trim();
  close();
}

function close() {
  open.value = false;
  query.value = "";
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
  ["ArrowDown", "ArrowUp"],
  (event) => {
    event.preventDefault();
    open.value = true;
    const step = event.key === "ArrowDown" ? 1 : -1;
    highlight.value = Math.min(
      Math.max(highlight.value + step, 0),
      entries.value.length - 1,
    );
  },
  { target: input },
);

onKeyStroke(
  ["Enter", "Tab"],
  (event) => {
    if (!open.value) return;
    const picked = entries.value[highlight.value];
    const value = picked ?? query.value;
    if (!value.trim()) return;
    if (event.key === "Enter") event.preventDefault();
    commit(value);
  },
  { target: input },
);

onKeyStroke(
  "Escape",
  () => {
    close();
  },
  { target: input },
);
</script>

<template>
  <div class="relative">
    <input
      ref="input"
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
        :key="entry"
        :highlighted="index === highlight"
        :selected="entry === model"
        @mousedown.prevent="commit(entry)"
        @mouseenter="highlight = index"
      >
        <span class="flex items-center gap-2">
          <span
            class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
            >{{ entry }}</span
          >
          <span
            v-if="entry === freeValue"
            class="ml-auto rounded bg-ok/25 px-1.5 text-ok"
            >new</span
          >
        </span>
      </ComboBoxMenuRow>
    </ComboBoxMenu>
  </div>
</template>
