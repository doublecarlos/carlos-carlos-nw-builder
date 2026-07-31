<script setup lang="ts">
// Pure control for one BuildParameterSlot -- no label, no diff markup, no row chrome. Used by
// both BuildSlot.vue (the Options section's rows) and QuickOptions.vue (the always-visible
// compact strip) so the input logic for each paramType exists exactly once regardless of
// which layout wraps it.
//
// Exposes `focus` and `focusAndSeed` (via defineExpose) so the keyboard cursor can target
// these controls the same way it targets ItemPicker -- Enter-to-focus, type-to-seed, and the
// same interaction surface on every slot row.
//
// `boolean` is the one case with a default slot: BaseCheckbox's clickable label is *inside* the
// control (a bigger, more natural click target), so the caller passes its label as slot content
// instead of rendering a separate label element the way the other three paramTypes need.
import { ref, nextTick } from "vue";
import ComboBox from "./ComboBox.vue";
import PercentInput from "./PercentInput.vue";
import BaseCheckbox from "./BaseCheckbox.vue";
import type { BuildParameterSlot } from "../../types";

const props = withDefaults(
  defineProps<{
    slotDef: BuildParameterSlot;
    /** When true, constrains control widths for uniform row alignment in section rows.
     *  QuickOptions (the horizontal strip) never passes `wide` -- it has its own layout. */
    wide?: boolean;
  }>(),
  {
    wide: false,
  },
);

const model = defineModel<string | number | boolean>();

/** Width class per paramType when `wide` is set, so every row lines up visually. */
function widthCls(slotDef: BuildParameterSlot) {
  if (slotDef.paramType === "number") return "w-20";
  return "w-36";
}

function onNumber(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  model.value = Number.isFinite(value) ? value : (props.slotDef.min ?? 0);
}

// --- keyboard cursor integration ---------------------------------------------------------

const comboboxInstance = ref<InstanceType<typeof ComboBox> | null>(null);
const root = ref<HTMLElement | null>(null);

/** Focus the underlying input. For a list-type this opens the combobox and positions the
 *  cursor inside its input; for other types it just focuses the control. */
function focusControl() {
  if (comboboxInstance.value) {
    comboboxInstance.value.$el?.querySelector("input")?.focus();
    return;
  }
  root.value?.querySelector("input")?.focus();
}

/** Open a list-type control and seed its query with `char`. No-op for other types. */
function focusAndSeed(char: string) {
  if (props.slotDef.paramType === "list") {
    focusControl();
    nextTick(() => {
      const input = comboboxInstance.value?.$el?.querySelector(
        "input",
      ) as HTMLInputElement | null;
      if (input) {
        input.value = char;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
  } else {
    focusControl();
  }
}

defineExpose({ focus: focusControl, focusAndSeed });
</script>

<template>
  <div ref="root" class="min-w-0 flex-1">
    <ComboBox
      v-if="slotDef.paramType === 'list'"
      ref="comboboxInstance"
      :class="wide && 'w-36'"
      :model-value="(model as string) ?? ''"
      :options="slotDef.options ?? []"
      @update:model-value="model = $event as string"
    />

    <PercentInput
      v-else-if="slotDef.paramType === 'percent'"
      :class="wide && 'w-28'"
      :model-value="(model as number) ?? ''"
      @update:model-value="model = $event as number | string"
    />

    <BaseCheckbox
      v-else-if="slotDef.paramType === 'boolean'"
      :class="wide && 'w-36'"
      :model-value="!!model"
      @update:model-value="model = $event as boolean"
    >
      <slot />
    </BaseCheckbox>

    <div v-else class="flex items-center gap-1.5">
      <input
        type="number"
        :class="[
          widthCls(slotDef),
          'rounded-md border border-line bg-surface py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent',
        ]"
        :min="slotDef.min"
        :max="slotDef.max"
        :step="slotDef.step"
        :value="model ?? ''"
        @input="onNumber"
      />
      <div v-if="slotDef.presets?.length" class="flex gap-0.5">
        <button
          v-for="preset in slotDef.presets"
          :key="preset"
          type="button"
          class="rounded-md border px-1.5 py-0.5 text-sm"
          :class="
            Number(model) === preset
              ? 'border-accent bg-accent-soft text-text'
              : 'border-line bg-surface-2 text-muted'
          "
          @click="model = preset as string | number | boolean"
        >
          {{ preset }}
        </button>
      </div>
    </div>
  </div>
</template>
