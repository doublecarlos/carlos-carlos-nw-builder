<script setup lang="ts">
// Token / chip input: committed values become badges, with autocomplete over known options and
// free text allowed for values that do not exist yet.
//
// Used for an item's tags, where both halves matter: you usually want an existing tag (so
// autocomplete), but coining a new one by typing it is a normal thing to do (so free text).
// `allowFree` turns the second half off for closed vocabularies (a condition's
// toggle/role/class/damage-type values, a bonus's `excludes`).
//
// Options are ComboBox's `{ value, label, search }` and the menu is ComboBox's own shell and
// rows, so a chip picker and a single-value picker over one vocabulary list, match, rank and
// read alike, and a richer row goes into the same `#option` slot on either. Unlike ComboBox,
// the value is matched too: a token is committed by value, so typing one exactly has to find
// its row rather than offer it as "new".
import { computed, useId, useTemplateRef, watch } from "vue";
import { onKeyStroke } from "@vueuse/core";
import { filterAndRank } from "../../lib/text-filter";
import { useMenuNavigation } from "../../composables/useMenuNavigation";
import ComboBoxMenu from "./ComboBoxMenu.vue";
import ComboBoxMenuRow from "./ComboBoxMenuRow.vue";
import type { ComboBoxOption } from "./ComboBox.vue";

const MAX_SUGGESTIONS = 40;

const props = withDefaults(
  defineProps<{
    options?: ComboBoxOption[];
    placeholder?: string;
    allowFree?: boolean;
  }>(),
  {
    options: () => [],
    placeholder: "Type to search…",
    allowFree: true,
  },
);

defineSlots<{
  /** A row's content. Defaults to the option's label; the "new" badge on a free entry is
   *  drawn outside the slot either way. */
  option?(props: { option: ComboBoxOption }): unknown;
}>();

const model = defineModel<string[]>({ default: () => [] });

const optionByValue = computed(
  () => new Map(props.options.map((option) => [option.value, option])),
);

/** A committed value reads by its option's label; a free value is its own label. */
const labelFor = (value: string) =>
  optionByValue.value.get(value)?.label ?? value;

const input = useTemplateRef("input");
const menu = useTemplateRef("menu");

const { open, query, highlight } = useMenuNavigation({
  target: input,
  entryCount: () => entries.value.length,
  onHighlightChange: () => menu.value?.scrollToHighlighted(),
});

const suggestions = computed(() => {
  if (!open.value) return [];
  const chosen = new Set(model.value);
  return filterAndRank(
    props.options.filter((option) => !chosen.has(option.value)),
    query.value,
    (option) => [option.value, option.label, option.search ?? ""],
    (option) => option.value,
  ).slice(0, MAX_SUGGESTIONS);
});

/** The typed text offered as its own entry, when it is genuinely new. */
const freeValue = computed(() => {
  const value = query.value.trim();
  if (!props.allowFree || !value) return "";
  if (model.value.includes(value)) return "";
  return optionByValue.value.has(value) ? "" : value;
});

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

function add(value: string) {
  const token = value.trim();
  if (!token || model.value.includes(token)) return;
  model.value = [...model.value, token];
  query.value = "";
  highlight.value = 0;
}

function removeAt(index: number) {
  const next = [...model.value];
  next.splice(index, 1);
  model.value = next;
}

// --- keyboard handling via onKeyStroke (scoped to the input ref) --------------------

onKeyStroke(
  "Backspace",
  (event) => {
    if (query.value || !model.value.length) return;
    event.preventDefault();
    removeAt(model.value.length - 1);
  },
  { target: input },
);

// Comma and Enter both commit, so pasting "a, b, c" and typing behave alike.
// Tab also commits when there's a query or a highlighted entry.
onKeyStroke(
  ["Enter", ",", "Tab"],
  (event) => {
    const picked = entries.value[highlight.value];
    if (event.key === "Tab" && !query.value && !picked) return;
    if (picked || query.value.trim()) {
      event.preventDefault();
      add(picked?.value ?? query.value);
    }
  },
  { target: input },
);

function onPaste(event: ClipboardEvent) {
  const text = event.clipboardData?.getData("text") ?? "";
  if (!text.includes(",")) return;
  event.preventDefault();
  for (const part of text.split(",")) add(part);
}
</script>

<template>
  <div
    class="relative flex min-h-7 flex-wrap items-center gap-1 rounded-md border border-line bg-surface px-1.5 py-1 cursor-text focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-accent"
    @mousedown.self="input?.focus()"
  >
    <span
      v-for="(token, index) in model"
      :key="token"
      data-testid="token-chip"
      :data-value="token"
      class="inline-flex items-center gap-1 rounded-full bg-accent-soft py-0.5 pl-2 pr-1 text-text"
    >
      {{ labelFor(token) }}
      <button
        type="button"
        class="cursor-pointer border-0 bg-transparent px-1 leading-none text-muted hover:text-danger"
        aria-label="Remove"
        @mousedown.prevent="removeAt(index)"
      >
        ×
      </button>
    </span>

    <input
      ref="input"
      v-model="query"
      data-testid="token-query"
      class="min-w-20 flex-1 border-0 bg-transparent px-0.5 py-0.5 outline-none"
      type="text"
      role="combobox"
      aria-autocomplete="list"
      :aria-expanded="menuOpen ? 'true' : 'false'"
      :aria-controls="menuOpen ? listboxId : undefined"
      :aria-activedescendant="activeDescendant"
      autocomplete="off"
      spellcheck="false"
      :placeholder="model.length ? '' : placeholder"
      @focus="
        open = true;
        highlight = 0;
      "
      @blur="open = false"
      @paste="onPaste"
    />

    <ComboBoxMenu v-if="menuOpen" ref="menu" :listbox-id="listboxId">
      <ComboBoxMenuRow
        v-for="(entry, index) in entries"
        :id="optionId(index)"
        :key="entry.value"
        :highlighted="index === highlight"
        @mousedown.prevent="add(entry.value)"
        @mouseenter="highlight = index"
      >
        <span class="flex items-center gap-2">
          <span class="min-w-0 flex-1">
            <slot name="option" :option="entry">
              <span
                class="block overflow-hidden text-ellipsis whitespace-nowrap"
              >
                {{ entry.label }}
              </span>
            </slot>
          </span>
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
