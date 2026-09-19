<script setup lang="ts">
// Shared "label / value" stat list for the item hover card, the bonus inspector and the stat
// source card.
//
// Rows collapse their borders. Hover or focus lifts a row so its accent border
// replaces that line rather than stacking a second one. A row's `note` wraps onto its own
// line under the value, so "15.00% x 40.00% Encounter Damage" never crowds the label; a note
// part naming a scaler links to its parameter row through `go-to-slot`, which the host wires to
// its own navigation.
import type { StatLine } from "../../lib/item-card-rows";
import BaseLink from "../ui/BaseLink.vue";

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
    /** Test id applied to every row; a row's note carries it with a `-note` suffix and each
     *  link in the note with `-note-link`. */
    rowTestid?: string;
  }>(),
  {
    active: true,
    notes: () => [],
    emptyText: "",
    rowTestid: "stat-row",
  },
);

const emit = defineEmits<{
  select: [value: string];
  "go-to-slot": [slotId: string];
}>();

const ROW_COLLAPSE =
  "relative flex flex-wrap justify-between gap-x-2 border-y border-line -mt-px py-0.5 first:mt-0";
const ROW_CLASS = `${ROW_COLLAPSE} hover:z-10 hover:border-accent focus-visible:z-10 focus-visible:border-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent`;
const NOTE_CLASS = `${ROW_COLLAPSE} text-muted`;
</script>

<template>
  <div class="flex flex-col py-1" :class="active ? 'text-text' : 'text-muted'">
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
      <!-- The label flexes and wraps within itself so the value keeps the right edge. -->
      <span class="min-w-0 flex-1">{{ row.label }}</span>
      <span class="flex-none tabular-nums">{{ row.value }}</span>
      <span
        v-if="row.note"
        class="basis-full text-right leading-snug text-muted"
        :data-testid="`${rowTestid}-note`"
        ><template v-for="(part, i) in row.note" :key="i"
          ><BaseLink
            v-if="part.slotId"
            :data-testid="`${rowTestid}-note-link`"
            @click.stop="emit('go-to-slot', part.slotId)"
            >{{ part.text }}</BaseLink
          ><template v-else>{{ part.text }}</template></template
        ></span
      >
    </component>
    <div v-if="!rows.length && emptyText" class="py-0.5 text-muted">
      {{ emptyText }}
    </div>
  </div>
</template>
