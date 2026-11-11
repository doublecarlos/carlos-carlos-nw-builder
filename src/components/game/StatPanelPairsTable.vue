<script setup lang="ts">
// The "label / value" table shape repeated across StatPanel.vue's IL/HP tile, Other stats,
// Ability scores, Enemy, Damage, Healing and EHP sections -- one component instead of the same
// markup seven times over.
//
// A row carrying `compare` stacks the compare build's own number under its value, tagged
// "Other" under the stat's label. Rows leave `compare` unset when the two builds agree, so
// the panel only grows where there is something to see.
//
// A row carrying `delta` shows this build's lead over the compare build at the right of its
// label, where it reads with this build's own value and leaves the number column's width alone.
//
// A row with an `infoKey` leads with the info button for that stat's source card.
import CompareLine from "../ui/CompareLine.vue";
import StatInfoButton from "./StatInfoButton.vue";
import { TREND_TONE, type Delta } from "../../lib/compare-delta";

defineProps<{
  rows: {
    key: string;
    label: string;
    value: string;
    lead?: boolean;
    muted?: boolean;
    compare?: string | null;
    delta?: Delta | null;
    /** The stat whose sources the row's info button shows. */
    infoKey?: string;
  }[];
  /** The compare build's name, the "Other" line's tooltip. */
  compareLabel?: string;
}>();
</script>

<template>
  <!-- Below lg the table scrolls sideways inside its own box when its numbers outgrow the panel,
       so the panel's other sections stay put. Never up and down: the info buttons' tap areas
       reach past the outer rows. The row outline is inset there so the box does not clip it.

       Each stat is its own tbody: its values on one row, the compare build's on a second, so
       plain table layout centers a wrapped label and its value and keeps compare lines level. -->
  <div
    class="max-lg:overflow-x-auto max-lg:overflow-y-hidden"
    data-testid="stat-table-scroll"
  >
    <table class="w-full border-collapse border border-line">
      <tbody
        v-for="row in rows"
        :key="row.key"
        class="even:bg-surface-2/55 hover:outline hover:outline-2 hover:outline-accent max-lg:-outline-offset-2"
        :class="[row.lead && 'font-semibold', row.muted && 'text-muted']"
        :data-stat-row="row.key"
      >
        <tr>
          <td class="px-1 py-0.5">
            <div class="flex items-center gap-0.5">
              <StatInfoButton
                v-if="row.infoKey"
                class="flex-none"
                :stat-key="row.infoKey"
                :label="row.label"
              />
              <span data-testid="stat-label">{{ row.label }}</span>
              <span
                v-if="row.delta"
                class="ml-auto pl-2 font-semibold tabular-nums"
                :class="TREND_TONE[row.delta.trend]"
                :data-trend="row.delta.trend"
                data-testid="stat-delta"
                >{{ row.delta.text }}</span
              >
            </div>
          </td>
          <td
            class="px-1 py-0.5 text-right tabular-nums"
            data-testid="stat-value"
          >
            {{ row.value }}
          </td>
        </tr>
        <tr v-if="row.compare" class="font-normal">
          <td class="px-1 pb-0.5">
            <CompareLine text="↳ Other" :title="compareLabel" fit-right />
          </td>
          <td
            class="px-1 pb-0.5 text-right tabular-nums"
            data-testid="compare-value"
          >
            <CompareLine :text="row.compare" />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
