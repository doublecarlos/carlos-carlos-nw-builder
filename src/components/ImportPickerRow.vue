<script setup lang="ts">
// One thing the file offers: a tick, and - when its id is already in use here - the choice
// between keeping both and replacing what is here.
import type { Resolution } from "../lib/import-plan";

defineProps<{
  name: string;
  kind: "build" | "layer";
  /** Name of the build/layer already here under this id. */
  conflictName?: string;
}>();

const selected = defineModel<boolean>("selected", { required: true });
const resolution = defineModel<Resolution>("resolution", { required: true });

const OPTIONS = [
  { value: "new", label: "Keep both" },
  { value: "replace", label: "Replace" },
] as const;
</script>

<template>
  <div class="flex items-center gap-2 py-0.5" data-testid="import-row">
    <label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
      <input
        v-model="selected"
        type="checkbox"
        :data-testid="`import-${kind}-checkbox`"
      />
      <span class="truncate">{{ name }}</span>
    </label>

    <span
      v-if="conflictName"
      class="flex flex-none items-center gap-2"
      :class="!selected && 'opacity-40'"
    >
      <span
        class="text-xs text-muted"
        :title="
          conflictName === name
            ? undefined
            : `Already here as “${conflictName}”.`
        "
        data-testid="import-conflict"
        >already here</span
      >
      <span class="flex overflow-hidden rounded border border-line">
        <button
          v-for="option in OPTIONS"
          :key="option.value"
          type="button"
          class="cursor-pointer px-2 py-0.5 text-xs"
          :class="
            resolution === option.value
              ? 'bg-accent-soft text-accent'
              : 'text-muted hover:bg-surface-2'
          "
          :aria-pressed="resolution === option.value"
          :data-testid="`import-${kind}-${option.value}`"
          @click="resolution = option.value"
        >
          {{ option.label }}
        </button>
      </span>
    </span>
  </div>
</template>
