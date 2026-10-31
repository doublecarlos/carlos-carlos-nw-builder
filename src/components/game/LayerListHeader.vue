<script setup lang="ts">
// The search, status filter and create strip above the layer editor's left pane, shared by
// the flat entry list and the Slots tab's outline. The `create` slot holds each one's button.
import BaseInput from "../ui/BaseInput.vue";
import ComboBox from "../ui/ComboBox.vue";
import IconButton from "../ui/IconButton.vue";
import { FilterX } from "@lucide/vue";

defineProps<{
  searchPlaceholder: string;
  statusFilterOptions: { value: string; label: string }[];
}>();

const query = defineModel<string>("query", { required: true });
const statusFilter = defineModel<string>("statusFilter", { required: true });

function clearFilters() {
  query.value = "";
  statusFilter.value = "all";
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
        :disabled="!(query || statusFilter !== 'all')"
        data-testid="layer-list-clear-filters"
        @click="clearFilters"
        ><FilterX
      /></IconButton>
    </div>
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
