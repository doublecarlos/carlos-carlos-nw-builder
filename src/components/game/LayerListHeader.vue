<script setup lang="ts">
// The search, status filter and create strip above the layer editor's left pane, shared by
// the flat entry list and the Slots tab's outline. The `create` slot holds each one's button,
// and `filters` any extra filters a list adds, which `clear` asks the owner to reset.
import BaseInput from "../ui/BaseInput.vue";
import ComboBox from "../ui/ComboBox.vue";
import IconButton from "../ui/IconButton.vue";
import { FilterX } from "@lucide/vue";

defineProps<{
  searchPlaceholder: string;
  statusFilterOptions: { value: string; label: string }[];
  /** Whether the `filters` slot's own filters differ from their defaults. */
  extraFiltersActive?: boolean;
}>();

const emit = defineEmits<{ clear: [] }>();

const query = defineModel<string>("query", { required: true });
const statusFilter = defineModel<string>("statusFilter", { required: true });

function clearFilters() {
  query.value = "";
  statusFilter.value = "all";
  emit("clear");
}
</script>

<template>
  <!-- Two rows: search with the one-click reset beside it, then the status filter with the
       create button, so the list starts high even in a narrow rail or on a phone. -->
  <div class="flex flex-col gap-1.5 border-b border-line p-2">
    <div class="flex items-center gap-1">
      <BaseInput
        v-model="query"
        type="search"
        class="editor-search w-full min-w-0"
        :placeholder="searchPlaceholder"
      />
      <IconButton
        class="flex-none"
        title="Clear filters"
        :disabled="!(query || statusFilter !== 'all' || extraFiltersActive)"
        data-testid="layer-list-clear-filters"
        @click="clearFilters"
        ><FilterX
      /></IconButton>
    </div>
    <slot name="filters" />
    <div class="flex items-center gap-1.5">
      <ComboBox
        class="min-w-0 flex-1"
        :model-value="statusFilter"
        :options="statusFilterOptions"
        @update:model-value="(v) => (statusFilter = v)"
      />
      <slot name="create" />
    </div>
  </div>
</template>
