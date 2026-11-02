<script setup lang="ts">
// The layer editor's Items tab filters under the search: quality, category and a "hide
// retired" toggle. LayerEditor applies them; this only edits the shared filter record.
import { computed } from "vue";
import BaseCheckbox from "../ui/BaseCheckbox.vue";
import ComboBox from "../ui/ComboBox.vue";
import { QUALITIES } from "../../lib/item-quality";
import type { ItemListFilter } from "../../lib/item-list-filter";

const props = defineProps<{
  /** Every category the editor knows, sorted. */
  categories: string[];
}>();

const filter = defineModel<ItemListFilter>({ required: true });

const qualityOptions = [
  { value: "", label: "any quality" },
  ...QUALITIES.map((quality) => ({ value: quality.id, label: quality.label })),
];

const categoryOptions = computed(() => [
  { value: "", label: "any category" },
  ...props.categories.map((category) => ({
    value: category,
    label: category,
  })),
]);

function set<K extends keyof ItemListFilter>(key: K, value: ItemListFilter[K]) {
  filter.value = { ...filter.value, [key]: value };
}
</script>

<template>
  <div class="flex flex-col gap-1.5" data-testid="item-list-filters">
    <div class="flex items-center gap-1.5">
      <ComboBox
        class="min-w-0 flex-1"
        :model-value="filter.quality"
        :options="qualityOptions"
        data-testid="item-list-quality"
        @update:model-value="(v) => set('quality', v)"
      />
      <ComboBox
        class="min-w-0 flex-1"
        :model-value="filter.category"
        :options="categoryOptions"
        data-testid="item-list-category"
        @update:model-value="(v) => set('category', v)"
      />
    </div>
    <BaseCheckbox
      inline
      :model-value="filter.hideRetired"
      data-testid="item-list-hide-retired"
      @update:model-value="(v) => set('hideRetired', v === true)"
      >Hide retired</BaseCheckbox
    >
  </div>
</template>
