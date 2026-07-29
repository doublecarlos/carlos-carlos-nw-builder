<script setup lang="ts">
// Typeable single-select dropdown over a fixed, small option list -- the same interaction as
// ItemPicker.vue (type to filter, arrow keys, Enter, Escape), stripped of the item-specific
// stat preview. Replaces a native <select> wherever the option list is short and known ahead
// of time (class, role, combat type, location, damage type, forte picks).
//
// Reuses ItemPicker's PickerMenu/PickerRow primitives rather than inventing a second look for
// the same interaction.
import { ref, computed, watch, nextTick } from 'vue';
import PickerMenu from './ui/PickerMenu.vue';
import PickerRow from './ui/PickerRow.vue';

const MAX_ROWS = 60;

const props = withDefaults(defineProps<{
  modelValue?: string;
  /** [{ value, label }], in the order they should list. */
  options: { value: string; label: string }[];
  placeholder?: string;
}>(), {
  modelValue: '',
  placeholder: '—',
});

const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const open = ref(false);
const query = ref('');
const highlight = ref(0);
const input = ref<HTMLInputElement | null>(null);
const list = ref<InstanceType<typeof PickerMenu> | null>(null);

const selected = computed(() => props.options.find((option) => option.value === props.modelValue) ?? null);

const filtered = computed(() => {
  if (!open.value) return [];
  const q = query.value.trim().toLowerCase();
  const source = q
    ? props.options.filter((option) => option.label.toLowerCase().includes(q))
    : props.options;
  return source.slice(0, MAX_ROWS);
});

watch(highlight, () => {
  nextTick(() => {
    (list.value?.$el as HTMLElement | undefined)?.querySelector('[data-highlighted]')?.scrollIntoView({ block: 'nearest' });
  });
});

function onFocus() {
  open.value = true;
  query.value = '';
  const current = props.options.findIndex((option) => option.value === props.modelValue);
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
  query.value = '';
}

/** `blur: false` for the Tab case below -- the browser's own Tab-forward looks at
 * whatever element is currently focused, so blurring here first (before that runs) would
 * make it tab from nowhere instead of continuing from this input. */
function choose(option: { value: string; label: string }, { blur = true }: { blur?: boolean } = {}) {
  emit('update:modelValue', option.value);
  close();
  if (blur) input.value?.blur();
}

/**
 * Enter has no native "move to the next field" behaviour the way Tab does. Only meaningful
 * for a stat-key picker (rendered inside `.stat-row`, one per stat: id/remove buttons, this
 * combo, then the value field) -- elsewhere there's no adjacent value input to jump to, and
 * `row` comes back null so this is a no-op.
 */
function focusStatValue(el: HTMLElement) {
  const row = el.closest('.stat-row');
  const value = row?.querySelector<HTMLElement>('input[type="number"], input[inputmode="decimal"]');
  value?.focus();
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!open.value) {
      onFocus();
      return;
    }
    const step = event.key === 'ArrowDown' ? 1 : -1;
    const last = filtered.value.length - 1;
    highlight.value = Math.min(Math.max(highlight.value + step, 0), last);
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    if (open.value && filtered.value[highlight.value]) {
      choose(filtered.value[highlight.value]);
      focusStatValue(event.target as HTMLElement);
    }
    return;
  }
  // Stat-key pickers only (see `focusStatValue`): commit the highlighted stat before the
  // browser's own Tab moves focus to the value field right after this one in the DOM.
  // No preventDefault -- the browser still does the actual tabbing.
  if (event.key === 'Tab' && !event.shiftKey && open.value && filtered.value[highlight.value]
    && (event.target as HTMLElement).closest('.stat-row')) {
    choose(filtered.value[highlight.value], { blur: false });
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
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
      class="w-full rounded-md border border-line bg-surface py-0.5 pl-1.5 pr-6 focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
      type="text"
      autocomplete="off"
      spellcheck="false"
      :value="open ? query : (selected ? selected.label : '')"
      :placeholder="placeholder"
      @focus="onFocus"
      @input="onInput"
      @blur="onBlur"
      @keydown="onKeydown">
    <!-- Sits in the same right-hand gutter the input's padding reserves -- the only hint
         this text input is actually a fixed-choice dropdown. -->
    <span class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-sm text-muted">▾</span>

    <PickerMenu v-if="open" ref="list">
      <PickerRow
        v-for="(option, index) in filtered"
        :key="option.value"
        :highlighted="highlight === index"
        @mousedown.prevent="choose(option)"
        @mouseenter="highlight = index">
        <div class="flex items-baseline gap-1.5">
          <span class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{{ option.label }}</span>
        </div>
      </PickerRow>

      <PickerRow v-if="!filtered.length" muted>no match</PickerRow>
    </PickerMenu>
  </div>
</template>
