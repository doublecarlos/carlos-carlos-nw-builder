<script setup lang="ts">
// Token / chip input: committed values become badges, with autocomplete over known options and
// free text allowed for values that do not exist yet.
//
// Used for an item's set membership, where both halves matter: you usually want to attach an
// existing set (so autocomplete), but creating a brand-new set id by typing it is a normal
// thing to do (so free text).
import { ref, computed, watch, nextTick } from "vue";

const MAX_SUGGESTIONS = 40;

const props = withDefaults(
  defineProps<{
    modelValue?: string[];
    options?: string[];
    placeholder?: string;
    allowFree?: boolean;
  }>(),
  {
    modelValue: () => [],
    options: () => [],
    placeholder: "Type to search…",
    allowFree: true,
  },
);

const emit = defineEmits<{ "update:modelValue": [value: string[]] }>();

const query = ref("");
const open = ref(false);
const highlight = ref(0);
const input = ref<HTMLInputElement | null>(null);
const menu = ref<HTMLElement | null>(null);

const suggestions = computed(() => {
  if (!open.value) return [];
  const q = query.value.trim().toLowerCase();
  const chosen = new Set(props.modelValue);
  return props.options
    .filter(
      (option) =>
        !chosen.has(option) && (!q || option.toLowerCase().includes(q)),
    )
    .slice(0, MAX_SUGGESTIONS);
});

/** Offering to create the typed value, when it is genuinely new. */
const freeValue = computed(() => {
  const value = query.value.trim();
  if (!props.allowFree || !value) return "";
  if (props.modelValue.includes(value)) return "";
  return props.options.includes(value) ? "" : value;
});

const entries = computed(() =>
  freeValue.value ? [freeValue.value, ...suggestions.value] : suggestions.value,
);

watch(highlight, () => {
  nextTick(() => {
    menu.value
      ?.querySelector("[data-highlighted]")
      ?.scrollIntoView({ block: "nearest" });
  });
});

function add(value: string) {
  const token = String(value ?? "").trim();
  if (!token || props.modelValue.includes(token)) return;
  emit("update:modelValue", [...props.modelValue, token]);
  query.value = "";
  highlight.value = 0;
}

function removeAt(index: number) {
  const next = [...props.modelValue];
  next.splice(index, 1);
  emit("update:modelValue", next);
}

function onKeydown(event: KeyboardEvent) {
  const { key } = event;

  // Backspace on an empty box eats the previous token -- the behaviour everyone expects
  // from an address field.
  if (key === "Backspace" && !query.value && props.modelValue.length) {
    event.preventDefault();
    removeAt(props.modelValue.length - 1);
    return;
  }

  if (key === "ArrowDown" || key === "ArrowUp") {
    event.preventDefault();
    open.value = true;
    const step = key === "ArrowDown" ? 1 : -1;
    highlight.value = Math.min(
      Math.max(highlight.value + step, 0),
      entries.value.length - 1,
    );
    return;
  }

  // Comma and Enter both commit, so pasting "a, b, c" and typing behave alike.
  if (key === "Enter" || key === "," || key === "Tab") {
    const picked = entries.value[highlight.value];
    if (key === "Tab" && !query.value && !picked) return;
    if (picked || query.value.trim()) {
      event.preventDefault();
      add(picked ?? query.value);
    }
    return;
  }

  if (key === "Escape") {
    open.value = false;
    query.value = "";
  }
}

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
      v-for="(token, index) in modelValue"
      :key="token"
      class="inline-flex items-center gap-1 rounded-full bg-accent-soft py-0.5 pl-2 pr-1 text-sm text-text"
    >
      {{ token }}
      <button
        type="button"
        class="cursor-pointer border-0 bg-transparent px-1 leading-none text-muted hover:text-danger"
        title="Remove"
        @mousedown.prevent="removeAt(index)"
      >
        ×
      </button>
    </span>

    <input
      ref="input"
      v-model="query"
      class="min-w-20 flex-1 border-0 bg-transparent px-0.5 py-0.5 outline-none"
      type="text"
      autocomplete="off"
      spellcheck="false"
      :placeholder="modelValue.length ? '' : placeholder"
      @focus="
        open = true;
        highlight = 0;
      "
      @blur="open = false"
      @keydown="onKeydown"
      @paste="onPaste"
    />

    <div
      v-if="open && entries.length"
      ref="menu"
      class="absolute inset-x-0 top-full z-30 mt-0.5 max-h-56 overflow-y-auto rounded-md border border-line bg-surface shadow-lg"
    >
      <div
        v-for="(entry, index) in entries"
        :key="entry"
        class="flex cursor-pointer gap-2 px-2 py-1"
        :class="index === highlight && 'bg-accent-soft'"
        :data-highlighted="index === highlight || undefined"
        @mousedown.prevent="add(entry)"
        @mouseenter="highlight = index"
      >
        <span>{{ entry }}</span>
        <span
          v-if="entry === freeValue"
          class="ml-auto rounded bg-ok/25 px-1.5 text-sm text-ok"
          >new</span
        >
      </div>
    </div>
  </div>
</template>
