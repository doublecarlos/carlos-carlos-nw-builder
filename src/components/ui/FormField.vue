<script setup lang="ts">
// Label-above-control stack, the data editor's basic form unit -- ItemForm, BonusForm,
// ConditionRows, BonusRows, Options, QuickOptions.
defineProps<{ label?: string }>();
</script>

<template>
  <div class="flex flex-col gap-0.5">
    <span v-if="label" class="text-sm text-muted">{{ label }}</span>
    <slot />
  </div>
</template>
