<script setup lang="ts">
// The "label / value" table shape repeated across StatPanel.vue's IL/HP tile, Other stats,
// Ability scores, Enemy, Damage, Healing and EHP sections -- one component instead of the same
// markup seven times over.
//
// A row carrying `compare` stacks the compare build's own number under its value, tagged with
// `compareLabel` (that build's name) under the stat's label. Rows leave `compare` unset when
// the two builds agree, so the panel only grows where there is something to see.
import IconButton from "./IconButton.vue";
import CompareLine from "./CompareLine.vue";
import { CircleAlert } from "@lucide/vue";

defineProps<{
  rows: {
    key: string;
    label: string;
    value: string;
    lead?: boolean;
    muted?: boolean;
    compare?: string | null;
    onInfo?: (event: MouseEvent) => void;
  }[];
  /** The compare build's name, shown once per compared row. */
  compareLabel?: string;
}>();
</script>

<template>
  <table class="w-full border-collapse border border-line">
    <tbody>
      <tr
        v-for="row in rows"
        :key="row.key"
        class="even:bg-surface-2/55 hover:outline hover:outline-2 hover:outline-accent"
        :class="row.lead && 'font-semibold'"
        :data-stat-row="row.key"
      >
        <td class="px-1 py-0.5 align-top" :class="row.muted && 'text-muted'">
          <div class="flex items-center gap-0.5">
            <IconButton
              v-if="row.onInfo"
              title="Show contributing sources"
              class="stat-info-btn flex-none"
              :data-stat-key="row.key"
              @click="row.onInfo"
            >
              <CircleAlert />
            </IconButton>
            <span>{{ row.label }}</span>
          </div>
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
      </tr>
    </tbody>
  </table>
</template>
