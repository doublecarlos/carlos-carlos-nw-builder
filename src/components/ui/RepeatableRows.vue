<script setup lang="ts" generic="T">
// One list where every row repeats the same Add/Remove pair, and an empty list still shows a
// lone "Add" so the affordance never disappears. The array, its row content and the handlers
// stay with the caller via the `#row`/`#empty` slots and the `add`/`remove` emits. `rowClass`
// is passed through rather than fixed, since several `tests/e2e` specs locate rows by it.
//
// A row that also fills `#lead` is laid out here, as one grid with three named areas: the
// pair, the lead control and the rest. Only the areas move between widths. From `md` up they
// sit in one row, pair first. On a phone the row becomes a card: the lead alone on the first
// line, the rest below it with the pair pinned right, so every row has the same shape and its
// controls line up with the next row's. With `headerActions` the pair sits on the lead's line
// instead, and the rest takes the full width below: for a row of several fields or nested
// content, where a pinned pair would sit beside whichever control comes last. Such a row's
// `rowClass` names and spaces it; a row without `#lead` takes its layout from `rowClass`.
import { computed } from "vue";
import IconButton from "./IconButton.vue";
import { Plus, Trash } from "@lucide/vue";

const props = defineProps<{
  rows: T[];
  /** With `#lead`, naming and spacing classes only, since the component owns that layout.
   *  Without it, the row's layout too. */
  rowClass: string;
  addLabel: string;
  removeLabel: string;
  addTestid?: string;
  /** The row's fields are FormFields with a label above: the pair lines up with the inputs'
   *  bottom edge, and the rest wraps its fields top-aligned. From `md` up the first grid row
   *  is sized by the lead and the pair alone, so a rest that grows below its fields (a message, a preview)
   *  leaves the pair in place. */
  labeledFields?: boolean;
  /** On a phone card, the pair goes on the lead's line rather than beside the rest. */
  headerActions?: boolean;
}>();
defineEmits<{ add: []; remove: [index: number] }>();

const slots = defineSlots<{
  /** The row's main control, given the card's full first line on a phone. */
  lead?(props: { row: T; index: number }): unknown;
  row?(props: { row: T; index: number }): unknown;
  empty?(): unknown;
}>();

/** The rest spans a flexible second track from `md` up, which keeps it out of the first
 *  track's size, so that track fits the lead and the pair alone. */
const GRID =
  "grid gap-1.5 grid-cols-[minmax(0,1fr)_auto] md:grid-cols-[auto_auto_minmax(0,1fr)] md:grid-rows-[auto_1fr] md:gap-y-0 md:[grid-template-areas:'actions_lead_rest'_'._._rest']";
const CARD =
  "max-md:mb-1.5 max-md:rounded-md max-md:border max-md:border-line max-md:bg-surface-2 max-md:p-2";
const phoneAreas = computed(() =>
  props.headerActions
    ? "max-md:[grid-template-areas:'lead_actions'_'rest_rest']"
    : "max-md:[grid-template-areas:'lead_lead'_'rest_actions']",
);
</script>

<template>
  <template v-if="slots.lead">
    <div
      v-for="(row, index) in rows"
      :key="index"
      :class="[rowClass, GRID, CARD, phoneAreas]"
      data-testid="repeatable-row"
    >
      <div
        class="flex items-center gap-1.5 self-end [grid-area:actions]"
        :class="!labeledFields && 'md:self-center'"
        data-testid="repeatable-row-actions"
      >
        <IconButton :title="addLabel" @click="$emit('add')"
          ><Plus
        /></IconButton>
        <IconButton :title="removeLabel" @click="$emit('remove', index)"
          ><Trash
        /></IconButton>
      </div>
      <div class="min-w-0 [grid-area:lead]" data-testid="repeatable-row-lead">
        <slot name="lead" :row="row" :index="index" />
      </div>
      <div
        class="flex min-w-0 flex-wrap gap-1.5 [grid-area:rest]"
        :class="labeledFields ? 'items-start' : 'items-center'"
        data-testid="repeatable-row-rest"
      >
        <slot name="row" :row="row" :index="index" />
      </div>
    </div>
  </template>
  <template v-else>
    <div
      v-for="(row, index) in rows"
      :key="index"
      :class="rowClass"
      data-testid="repeatable-row"
    >
      <div
        class="flex items-center gap-1.5"
        data-testid="repeatable-row-actions"
      >
        <IconButton :title="addLabel" @click="$emit('add')"
          ><Plus
        /></IconButton>
        <IconButton :title="removeLabel" @click="$emit('remove', index)"
          ><Trash
        /></IconButton>
      </div>
      <slot name="row" :row="row" :index="index" />
    </div>
  </template>
  <div v-if="!rows.length" class="flex items-center gap-1.5" :class="rowClass">
    <IconButton :title="addLabel" :data-testid="addTestid" @click="$emit('add')"
      ><Plus
    /></IconButton>
    <slot name="empty" />
  </div>
</template>
