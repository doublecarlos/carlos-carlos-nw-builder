<script setup lang="ts">
// Searchable item typeahead for one slot -- thin wrapper around ComboBox.vue that maps
// Item objects to the generic {value, label} options format and renders the item-specific
// stat preview through ComboBox's `#option` slot.
//
// A native <datalist> was considered and rejected: it cannot show item level and a stat
// preview per row, and its keyboard behaviour is not controllable. This is ~120 lines instead.
//
// The component owns only its own transient UI state (open / query / highlight). The chosen
// value is `model` and every change leaves via `update:model`, so the single build document
// in App.vue stays the only source of truth (undo stack has a single place to hook into).
import { ref, computed } from "vue";
import { itemPreview, hasBonuses, int as fmtInt } from "../../lib/format";
import type { Item } from "../../types";
import ComboBox from "../ui/ComboBox.vue";

const props = withDefaults(
  defineProps<{
    items: Item[];
    /** The item `modelValue` (an id) currently resolves to, or null/undefined for an empty
     * slot -- drives the closed box's display text/placeholder. Passed down already-resolved
     * by the caller (BuildSlot.vue already has it) rather than looked up here, since `items`
     * is only this slot's *selectable* list and would miss an equipped item that's since
     * fallen out of it (e.g. a class change narrowing `allowedClass`). */
    selectedItem?: Item | null;
    invalid?: boolean;
  }>(),
  {
    selectedItem: null,
    invalid: false,
  },
);

const model = defineModel<string>({ default: "" });

const combobox = ref<InstanceType<typeof ComboBox> | null>(null);

/** Map items to the generic {value, label} format ComboBox expects. */
const options = computed(() =>
  props.items.map((item) => ({ value: item.id, label: item.name })),
);

/** Decorated once per filter change rather than once per render pass. */
const matchMap = computed(() => {
  const map = new Map<
    string,
    { item: Item; preview: ReturnType<typeof itemPreview>; flagged: boolean }
  >();
  for (const item of props.items) {
    map.set(item.id, {
      item,
      preview: itemPreview(item, 3),
      flagged: hasBonuses(item),
    });
  }
  return map;
});

const int = (value: unknown) => fmtInt(value);

defineExpose({
  /** Focus the underlying input -- same open/clear behavior as a direct click (ComboBox's
   *  own `onFocus` opens the list and starts a fresh query). */
  focus() {
    combobox.value?.$el?.querySelector("input")?.focus();
  },
  /** Delegates to ComboBox's focusAndSeed. */
  focusAndSeed(char: string) {
    combobox.value?.focusAndSeed(char);
  },
});
</script>

<template>
  <ComboBox
    ref="combobox"
    :options="options"
    :model-value="model"
    :invalid="invalid"
    :show-empty-option="true"
    :closed-display="selectedItem?.name ?? ''"
    :placeholder="selectedItem?.name || '—'"
    @update:model-value="model = $event"
  >
    <template #option="{ option }">
      <template v-if="matchMap.has(option.value)">
        <div class="flex items-baseline gap-1.5">
          <span
            class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap"
            >{{ option.label }}</span
          >
          <span
            v-if="matchMap.get(option.value)?.flagged"
            class="text-sm text-accent"
            title="has conditional bonuses"
            >◈</span
          >
          <span
            v-if="matchMap.get(option.value)?.item?.il"
            class="text-sm text-muted tabular-nums"
            >iL {{ int(matchMap.get(option.value)?.item?.il) }}</span
          >
        </div>
        <div class="flex flex-wrap gap-2 text-sm text-muted">
          <span
            v-for="part in matchMap.get(option.value)?.preview?.parts ?? []"
            :key="part"
            >{{ part }}</span
          >
          <span v-if="matchMap.get(option.value)?.preview?.more" class="italic"
            >+{{ matchMap.get(option.value)?.preview?.more }} more</span
          >
        </div>
      </template>
    </template>
  </ComboBox>
</template>
