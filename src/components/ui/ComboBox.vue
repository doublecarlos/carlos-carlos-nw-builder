<script setup lang="ts">
// Typeable single-select dropdown over a fixed, small option list -- the same interaction as
// ItemPicker.vue (type to filter, arrow keys, Enter, Escape), stripped of the item-specific
// stat preview. Replaces a native <select> wherever the option list is short and known ahead
// of time (class, role, combat type, location, damage type, forte picks).
//
// Reuses ItemPicker's PickerMenu/PickerRow primitives rather than inventing a second look for
// the same interaction.
import { ref, computed, watch, nextTick } from "vue";
import { onKeyStroke } from "@vueuse/core";
import PickerMenu from "./PickerMenu.vue";
import PickerRow from "./PickerRow.vue";

const MAX_ROWS = 60;

const props = withDefaults(
  defineProps<{
    /** [{ value, label }], in the order they should list. */
    options: { value: string; label: string }[];
    placeholder?: string;
  }>(),
  {
    placeholder: "—",
  },
);

const model = defineModel<string>({ default: "" });

const open = ref(false);
const query = ref("");
const highlight = ref(0);
const input = ref<HTMLInputElement | null>(null);
const list = ref<InstanceType<typeof PickerMenu> | null>(null);

const selected = computed(
  () => props.options.find((option) => option.value === model.value) ?? null,
);

const filtered = computed(() => {
  if (!open.value) return [];
  const q = query.value.trim().toLowerCase();
  const source = q
    ? props.options.filter((option) => option.label.toLowerCase().includes(q))
    : props.options;
  return source.slice(0, MAX_ROWS);
});

watch(highlight, () => {
  nextTick(() => list.value?.scrollToHighlighted());
});

function onFocus() {
  open.value = true;
  query.value = "";
  const current = props.options.findIndex(
    (option) => option.value === model.value,
  );
  highlight.value = Math.max(current, 0);
}

function onInput(event: Event) {
  query.value = (event.target as HTMLInputElement).value;
  open.value = true;
  highlight.value = 0;
}

function onBlur() {
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
  option: { value: string; label: string },
  { blur = true }: { blur?: boolean } = {},
) {
  model.value = option.value;
  close();
  if (blur) input.value?.blur();
}

// --- keyboard handling via onKeyStroke (scoped to the input ref) ------------------------

onKeyStroke(
  "Escape",
  (e) => {
    e.preventDefault();
    e.stopPropagation();
    close();
    input.value?.blur();
  },
  { target: input },
);

onKeyStroke(
  (e) => e.key === "ArrowDown" || e.key === "ArrowUp",
  (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!open.value) {
      onFocus();
      return;
    }
    const step = e.key === "ArrowDown" ? 1 : -1;
    const last = filtered.value.length - 1;
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
    choose(filtered.value[highlight.value]);
  },
  { target: input },
);

onKeyStroke(
  "Tab",
  (e) => {
    if (!open.value) return;
    if (e.shiftKey) {
      // Browsing backward -- just close.
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    // Stat-key pickers only: commit the highlighted stat before the
    // browser's own Tab moves focus to the value field right after this one in the DOM.
    // No preventDefault -- the browser still does the actual tabbing.
    if ((e.target as HTMLElement).closest(".stat-row")) {
      choose(filtered.value[highlight.value], { blur: false });
      return;
    }
    // Tab forwards, no stat-row: commit the highlighted choice then let the
    // browser's own Tab move focus on -- no preventDefault (no stopPropagation
    // either -- the input is still focused for the window-level listener's
    // synchronous gate).
    choose(filtered.value[highlight.value], { blur: false });
  },
  { target: input },
);
</script>

<template>
  <div class="relative">
    <input
      ref="input"
      data-testid="picker-input"
      class="w-full rounded-md border border-line bg-surface py-0.5 pl-1.5 pr-6 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
      type="text"
      autocomplete="off"
      spellcheck="false"
      :value="open ? query : selected ? selected.label : ''"
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

    <PickerMenu v-if="open" ref="list">
      <PickerRow
        v-for="(option, index) in filtered"
        :key="option.value"
        :highlighted="highlight === index"
        @mousedown.prevent="choose(option)"
        @mouseenter="highlight = index"
      >
        <slot
          v-if="$slots.option"
          name="option"
          :option="option"
          :highlighted="highlight === index"
        />
        <div v-else class="flex items-baseline gap-1.5">
          <span
            class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
            >{{ option.label }}</span
          >
        </div>
      </PickerRow>

      <PickerRow v-if="!filtered.length" muted>no match</PickerRow>
    </PickerMenu>
  </div>
</template>
