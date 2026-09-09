<script setup lang="ts" generic="T">
// One list where every row repeats the same Add/Remove pair, and an empty list still shows a
// lone "Add" so the affordance never disappears -- `ItemForm`'s insignia slots, recipe shapes,
// default params, published values and carried values, plus `StatRowList`/`DynamicStatRowList`.
// The array, its row content and the add/remove handlers all stay with the caller via the
// `#row`/`#empty` slots and the `add`/`remove` emits; this owns only the row scaffold. `rowClass`
// is passed through rather than fixed, since several `tests/e2e` specs locate rows by it.
import IconButton from "./IconButton.vue";
import { Plus, Trash } from "@lucide/vue";

defineProps<{
  rows: T[];
  rowClass: string;
  addLabel: string;
  removeLabel: string;
  addTestid?: string;
}>();
defineEmits<{ add: []; remove: [index: number] }>();
</script>

<template>
  <div v-for="(row, index) in rows" :key="index" :class="rowClass">
    <IconButton :title="addLabel" @click="$emit('add')"><Plus /></IconButton>
    <IconButton :title="removeLabel" @click="$emit('remove', index)"
      ><Trash
    /></IconButton>
    <slot name="row" :row="row" :index="index" />
  </div>
  <div v-if="!rows.length" :class="rowClass">
    <IconButton :title="addLabel" :data-testid="addTestid" @click="$emit('add')"
      ><Plus
    /></IconButton>
    <slot name="empty" />
  </div>
</template>
