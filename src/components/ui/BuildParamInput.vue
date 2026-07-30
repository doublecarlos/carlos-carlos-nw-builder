<script setup lang="ts">
// Pure control for one BuildParameterSlot -- no label, no diff markup, no row chrome. Used by
// both BuildSlot.vue (the Options section's rows) and QuickOptions.vue (the always-visible
// compact strip) so the input logic for each `paramType` exists exactly once regardless of
// which layout wraps it.
//
// `boolean` is the one case with a default slot: Checkbox's clickable label is *inside* the
// control (a bigger, more natural click target), so the caller passes its label as slot content
// instead of rendering a separate label element the way the other three paramTypes need.
import ComboBox from './ComboBox.vue';
import PercentInput from './PercentInput.vue';
import Checkbox from './Checkbox.vue';
import type { BuildParameterSlot } from '../../types';

const props = defineProps<{
  slot: BuildParameterSlot;
  modelValue: string | number | boolean | undefined;
}>();

const emit = defineEmits<{ 'update:modelValue': [value: string | number | boolean] }>();

function onNumber(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  emit('update:modelValue', Number.isFinite(value) ? value : (props.slot.min ?? 0));
}
</script>

<template>
  <ComboBox v-if="slot.paramType === 'list'"
            :model-value="(modelValue as string) ?? ''" :options="slot.options ?? []"
            @update:model-value="$emit('update:modelValue', $event)" />

  <PercentInput v-else-if="slot.paramType === 'percent'"
                :model-value="(modelValue as number) ?? ''"
                @update:model-value="$emit('update:modelValue', $event)" />

  <Checkbox v-else-if="slot.paramType === 'boolean'"
            :model-value="!!modelValue"
            @update:model-value="$emit('update:modelValue', $event)">
    <slot />
  </Checkbox>

  <div v-else class="flex items-center gap-1.5">
    <input type="number" class="w-20 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
           :min="slot.min" :max="slot.max" :step="slot.step"
           :value="modelValue ?? ''" @input="onNumber">
    <div v-if="slot.presets?.length" class="flex gap-0.5">
      <button v-for="preset in slot.presets" :key="preset" type="button"
              class="rounded-md border px-1.5 py-0.5 text-sm"
              :class="Number(modelValue) === preset ? 'border-accent bg-accent-soft text-text' : 'border-line bg-surface-2 text-muted'"
              @click="$emit('update:modelValue', preset)">{{ preset }}</button>
    </div>
  </div>
</template>
