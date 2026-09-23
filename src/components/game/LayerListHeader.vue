<script setup lang="ts">
// The search, status filter and create strip above the layer editor's left pane, shared by
// the flat entry list and the Slots tab's outline. The `create` slot holds each one's button.
import BaseButton from "../ui/BaseButton.vue";
import BaseInput from "../ui/BaseInput.vue";
import ComboBox from "../ui/ComboBox.vue";
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
  <div>
    <div class="flex items-center gap-1 p-2">
      <BaseInput
        v-model="query"
        type="search"
        class="editor-search w-full min-w-0"
        :placeholder="searchPlaceholder"
      />
    </div>
    <div class="flex flex-none gap-1.5 px-2">
      <ComboBox
        class="w-full"
        :model-value="statusFilter"
        :options="statusFilterOptions"
        @update:model-value="(v) => (statusFilter = v)"
      />
    </div>
    <div class="flex flex-none gap-1.5 border-b border-line px-2 py-2">
      <BaseButton
        :disabled="!(query || statusFilter !== 'all')"
        class="flex-1 text-center justify-center"
        @click="clearFilters"
        ><FilterX />clear filters</BaseButton
      >
      <slot name="create" />
    </div>
  </div>
</template>
