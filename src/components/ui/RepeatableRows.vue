<script setup lang="ts" generic="T">
// One list where every row repeats the same Add/Remove pair, and an empty list still shows a
// lone "Add" so the affordance never disappears. The array, its row content and the handlers
// stay with the caller via the `#row`/`#empty` slots and the `add`/`remove` emits. `rowClass`
// is passed through rather than fixed, since several `tests/e2e` specs locate rows by it.
import IconButton from "./IconButton.vue";
import { Plus, Trash } from "@lucide/vue";

defineProps<{
  rows: T[];
  rowClass: string;
  addLabel: string;
  removeLabel: string;
  addTestid?: string;
  /** The row's fields are FormFields with a label above: the pair sits under an equal blank
   *  label and centers on the fields, so a row that grows below its fields (a message, a
   *  preview) leaves it in place. Pair with a top-aligned `rowClass`. */
  labeledFields?: boolean;
}>();
defineEmits<{ add: []; remove: [index: number] }>();
</script>

<template>
  <div v-for="(row, index) in rows" :key="index" :class="rowClass">
    <div v-if="labeledFields" class="flex flex-col gap-0.5">
      <span class="invisible" aria-hidden="true">&nbsp;</span>
      <!-- The padding centers the icon buttons on a BaseInput, which is 6px taller. -->
      <div class="flex items-center gap-1.5 py-[3px]">
        <IconButton :title="addLabel" @click="$emit('add')"
          ><Plus
        /></IconButton>
        <IconButton :title="removeLabel" @click="$emit('remove', index)"
          ><Trash
        /></IconButton>
      </div>
    </div>
    <template v-else>
      <IconButton :title="addLabel" @click="$emit('add')"><Plus /></IconButton>
      <IconButton :title="removeLabel" @click="$emit('remove', index)"
        ><Trash
      /></IconButton>
    </template>
    <slot name="row" :row="row" :index="index" />
  </div>
  <div v-if="!rows.length" :class="rowClass">
    <IconButton :title="addLabel" :data-testid="addTestid" @click="$emit('add')"
      ><Plus
    /></IconButton>
    <slot name="empty" />
  </div>
</template>
