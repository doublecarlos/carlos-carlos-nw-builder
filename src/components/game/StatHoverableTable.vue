<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    stats: {
      key: string;
      label: string;
      value: string;
    }[];
    active?: boolean;
  }>(),
  {
    active: true,
  },
);
</script>

<template>
  <div
    class="flex flex-col divide-y divide-line"
    :class="[active ? 'text-text' : 'text-muted']"
  >
    <div
      v-for="stat in stats"
      :key="stat.key"
      class="flex justify-between gap-2 py-0.5 hover:shadow-[inset_0_1px_0_var(--color-accent),inset_0_-1px_0_var(--color-accent)]"
    >
      <span>{{ stat.label }}</span
      ><span class="tabular-nums">{{ stat.value }}</span>
    </div>

    <div v-if="!stats.length" class="text-muted">no direct stats</div>
  </div>
</template>
