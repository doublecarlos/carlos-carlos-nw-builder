<script setup lang="ts" generic="T">
// One list where every row repeats the same Add/Remove pair, and an empty list still shows a
// lone "Add" so the affordance never disappears. The array, its row content and the handlers
// stay with the caller via the `#row`/`#empty` slots and the `add`/`remove` emits. `rowClass`
// is passed through rather than fixed, since several `tests/e2e` specs locate rows by it.
//
// A row that also fills `#lead` becomes a card on a phone: the lead control alone on the first
// line, the `#row` content below it with the pair pinned right, so every row has the same shape
// and its controls line up with the next row's. From `md` up the wrappers are `display:
// contents`, leaving the caller's own `rowClass` layout untouched.
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

const slots = defineSlots<{
  /** The row's main control, given the card's full first line on a phone. */
  lead?(props: { row: T; index: number }): unknown;
  row?(props: { row: T; index: number }): unknown;
  empty?(): unknown;
}>();

/** The phone card: a full-width first line, then the rest beside the pinned pair. */
const CARD =
  "repeatable-card max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto] max-md:gap-1.5 max-md:mb-1.5 max-md:rounded-md max-md:border max-md:border-line max-md:bg-surface-2 max-md:p-2";
</script>

<template>
  <div
    v-for="(row, index) in rows"
    :key="index"
    :class="[rowClass, slots.lead && CARD]"
    data-testid="repeatable-row"
  >
    <div
      v-if="labeledFields"
      class="flex flex-col gap-0.5"
      data-testid="repeatable-row-actions"
    >
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
    <div
      v-else
      class="flex items-center gap-1.5 md:contents max-md:col-start-2 max-md:row-start-2 max-md:self-end"
      data-testid="repeatable-row-actions"
    >
      <IconButton :title="addLabel" @click="$emit('add')"><Plus /></IconButton>
      <IconButton :title="removeLabel" @click="$emit('remove', index)"
        ><Trash
      /></IconButton>
    </div>
    <template v-if="slots.lead">
      <div
        class="min-w-0 md:contents max-md:col-span-2 max-md:row-start-1"
        data-testid="repeatable-row-lead"
      >
        <slot name="lead" :row="row" :index="index" />
      </div>
      <div
        class="flex min-w-0 flex-wrap items-center gap-1.5 md:contents max-md:col-start-1 max-md:row-start-2"
        data-testid="repeatable-row-rest"
      >
        <slot name="row" :row="row" :index="index" />
      </div>
    </template>
    <slot v-else name="row" :row="row" :index="index" />
  </div>
  <div v-if="!rows.length" :class="rowClass">
    <IconButton :title="addLabel" :data-testid="addTestid" @click="$emit('add')"
      ><Plus
    /></IconButton>
    <slot name="empty" />
  </div>
</template>
