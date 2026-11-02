<script setup lang="ts">
// The "label / value" table shape repeated across StatPanel.vue's IL/HP tile, Other stats,
// Ability scores, Enemy, Damage, Healing and EHP sections -- one component instead of the same
// markup seven times over.
//
// A row carrying `compare` stacks the compare build's own number under its value, tagged with
// `compareLabel` (that build's name) under the stat's label. Rows leave `compare` unset when
// the two builds agree, so the panel only grows where there is something to see.
//
// A row with an `infoKey` ends in the info button for that stat's source card.
import CompareLine from "../ui/CompareLine.vue";
import StatInfoButton from "./StatInfoButton.vue";

defineProps<{
  rows: {
    key: string;
    label: string;
    value: string;
    lead?: boolean;
    muted?: boolean;
    compare?: string | null;
    /** The stat whose sources the row's info button shows. */
    infoKey?: string;
  }[];
  /** The compare build's name, shown once per compared row. */
  compareLabel?: string;
}>();
</script>

<template>
  <!-- Below lg the table scrolls inside its own box when its numbers outgrow the panel, so
       the panel's other sections stay put. The row outline is inset there so the box does not
       clip it. -->
  <div class="max-lg:overflow-x-auto" data-testid="stat-table-scroll">
    <table class="w-full border-collapse border border-line">
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.key"
          class="even:bg-surface-2/55 hover:outline hover:outline-2 hover:outline-accent max-lg:-outline-offset-2"
          :class="row.lead && 'font-semibold'"
          :data-stat-row="row.key"
        >
          <td class="px-1 py-0.5 align-top" :class="row.muted && 'text-muted'">
            <span>{{ row.label }}</span>
            <CompareLine
              v-if="row.compare"
              class="font-normal"
              :text="`↳ ${compareLabel}`"
              :title="compareLabel"
              fit-right
            />
          </td>
          <td
            class="px-1 py-0.5 text-right align-top tabular-nums"
            :class="row.muted && 'text-muted'"
            data-testid="stat-value"
          >
            {{ row.value }}
            <CompareLine
              v-if="row.compare"
              class="font-normal tabular-nums"
              :text="row.compare"
            />
          </td>
          <td class="w-0 py-0.5 pr-0.5 align-top">
            <StatInfoButton
              v-if="row.infoKey"
              :stat-key="row.infoKey"
              :label="row.label"
            />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
