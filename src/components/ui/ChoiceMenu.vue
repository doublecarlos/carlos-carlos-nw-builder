<script setup lang="ts">
// Pick one of a few options from a quiet text trigger: the current choice and a chevron, no box.
// For a secondary setting that sits beside the content it tunes, where a ComboBox would outweigh
// that content. The stat panel summary's case pickers are the call site.
//
// Built on BaseMenu; the current option carries a check and `aria-current`.
import { computed, useTemplateRef } from "vue";
import { Check, ChevronDown } from "@lucide/vue";
import BaseMenu from "./BaseMenu.vue";
import BaseMenuItem from "./BaseMenuItem.vue";

const props = defineProps<{
  options: { value: string; label: string }[];
  /** What is being chosen, for the trigger's accessible name and the menu's. */
  label: string;
  testid?: string;
}>();

const model = defineModel<string>({ required: true });

const current = computed(
  () => props.options.find((option) => option.value === model.value) ?? null,
);

const menu = useTemplateRef<InstanceType<typeof BaseMenu>>("menu");

function choose(value: string) {
  model.value = value;
  menu.value?.close();
}
</script>

<template>
  <span class="inline-flex min-w-0">
    <BaseMenu
      ref="menu"
      fit-content
      align="left"
      :label="label"
      panel-class="flex flex-col p-1"
      :ignore="['.choice-menu-btn']"
      :panel-testid="testid ? `${testid}-menu` : undefined"
    >
      <template #trigger="{ toggle, attrs }">
        <button
          type="button"
          class="choice-menu-btn inline-flex min-w-0 cursor-pointer items-center gap-0.5 rounded-sm text-muted transition-colors hover:text-text"
          :aria-label="`${label}: ${current?.label ?? ''}`"
          :data-testid="testid"
          v-bind="attrs"
          @click="toggle"
        >
          <span class="truncate">{{ current?.label }}</span>
          <ChevronDown class="size-3 flex-none" />
        </button>
      </template>
      <BaseMenuItem
        v-for="option in options"
        :key="option.value"
        :aria-current="option.value === model ? 'true' : undefined"
        @click="choose(option.value)"
      >
        <Check
          class="size-3.5 flex-none"
          :class="option.value !== model && 'invisible'"
        />{{ option.label }}
      </BaseMenuItem>
    </BaseMenu>
  </span>
</template>
