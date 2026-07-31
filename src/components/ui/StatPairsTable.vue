<script setup lang="ts">
// The "label / value" table shape repeated across StatPanel.vue's IL/HP tile, Other stats,
// Ability scores, Enemy, Damage, Healing and EHP sections -- one component instead of the same
// markup seven times over.
import IconButton from "./IconButton.vue";

defineProps<{
  rows: {
    key: string;
    label: string;
    value: string;
    lead?: boolean;
    muted?: boolean;
    onInfo?: (event: MouseEvent) => void;
  }[];
}>();
</script>

<template>
  <table class="w-full border-collapse border border-line">
    <tbody>
      <tr
        v-for="row in rows"
        :key="row.key"
        class="even:bg-surface-2/55"
        :class="row.lead && 'font-semibold'"
      >
        <td
          class="flex items-center gap-0.5 px-1 py-0.5"
          :class="row.muted && 'text-muted'"
        >
          <IconButton
            v-if="row.onInfo"
            icon="circle-alert"
            title="Show contributing sources"
            class="stat-info-btn flex-none"
            :data-stat-key="row.key"
            @click="row.onInfo"
          />
          <span>{{ row.label }}</span>
        </td>
        <td
          class="px-1 py-0.5 text-right tabular-nums"
          :class="row.muted && 'text-muted'"
        >
          {{ row.value }}
        </td>
      </tr>
    </tbody>
  </table>
</template>
