<script setup lang="ts">
// Shared "label / value" stat list for the item hover card, the bonus inspector and the stat
// source card.
//
// Rows collapse their borders. Hover or focus lifts a row so its accent border
// replaces that line rather than stacking a second one.
import type { StatLine } from "../../lib/item-card-rows";

export interface StatRow extends StatLine {
  /** When set, the row renders as a button and `select` emits this value on click. */
  select?: string;
}

withDefaults(
  defineProps<{
    rows: StatRow[];
    /** Mutes the list for an inactive tier, variant or grant. */
    active?: boolean;
    /** Muted lines above the rows, such as "each stack would give:". */
    notes?: string[];
    emptyText?: string;
    /** Test id applied to every row. */
    rowTestid?: string;
  }>(),
  {
    active: true,
    notes: () => [],
    emptyText: "",
    rowTestid: "stat-row",
  },
);

const emit = defineEmits<{ select: [value: string] }>();

const ROW_COLLAPSE =
  "relative flex justify-between gap-2 border-y border-line -mt-px py-0.5 first:mt-0 first:border-t-transparent last:border-b-transparent";
const ROW_CLASS = `${ROW_COLLAPSE} hover:z-10 hover:border-accent focus-visible:z-10 focus-visible:border-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent`;
const NOTE_CLASS = `${ROW_COLLAPSE} text-muted`;
</script>

<template>
  <div class="flex flex-col" :class="active ? 'text-text' : 'text-muted'">
    <div v-for="note in notes" :key="note" :class="NOTE_CLASS">
      {{ note }}
    </div>
    <component
      :is="row.select ? 'button' : 'div'"
      v-for="row in rows"
      :key="row.key"
      :type="row.select ? 'button' : undefined"
      :class="[
        ROW_CLASS,
        row.select && 'w-full cursor-pointer bg-transparent text-left',
      ]"
      :data-testid="rowTestid"
      @click="row.select && emit('select', row.select)"
    >
      <span class="min-w-0">{{ row.label }}</span>
      <span class="flex-none tabular-nums">{{ row.value }}</span>
    </component>
    <div v-if="!rows.length && emptyText" class="py-0.5 text-muted">
      {{ emptyText }}
    </div>
  </div>
</template>
