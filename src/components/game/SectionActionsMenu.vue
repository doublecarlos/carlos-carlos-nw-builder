<script setup lang="ts">
// A section header's actions folded into one labeled menu, for a phone where PresetMenu,
// SectionCopyMenu and SectionClearButton would only have room for bare icons. Picking which
// preset to overwrite or which build to copy from opens a second list in the same menu, with
// Back, rather than squeezing a picker into it.
import { ref, useTemplateRef } from "vue";
import {
  ArrowLeft,
  Copy,
  EllipsisVertical,
  LayoutTemplate,
  Plus,
  RotateCcw,
  Save,
} from "@lucide/vue";
import BaseMenu from "../ui/BaseMenu.vue";
import BaseMenuItem from "../ui/BaseMenuItem.vue";
import IconButton from "../ui/IconButton.vue";
import type { BuildOption, SectionPreset } from "../../types";

const props = defineProps<{
  sectionId: string;
  label: string;
  presets: SectionPreset[];
  otherBuilds: BuildOption[];
}>();

const emit = defineEmits<{
  "apply-preset": [preset: SectionPreset];
  "create-preset": [];
  "update-preset": [preset: SectionPreset];
  copy: [fromId: string];
  clear: [];
}>();

const menu = useTemplateRef<InstanceType<typeof BaseMenu>>("menu");

const view = ref<"main" | "overwrite" | "copy">("main");

/** Closes first, so an undo notice the action posts is not left behind the menu. */
function run(action: () => void) {
  menu.value?.close();
  action();
}

const triggerClass = `section-actions-${props.sectionId}`;
</script>

<template>
  <BaseMenu
    ref="menu"
    fit-content
    :label="`${label} actions`"
    panel-class="flex max-h-[60dvh] min-w-56 max-w-[calc(100vw-1rem)] flex-col overflow-y-auto p-1"
    :ignore="[`.${triggerClass}`]"
    @open="view = 'main'"
  >
    <template #trigger="{ toggle, attrs }">
      <IconButton
        :class="triggerClass"
        :title="`${label} actions`"
        :data-testid="`section-actions-${sectionId}`"
        v-bind="attrs"
        @click="toggle"
        ><EllipsisVertical
      /></IconButton>
    </template>

    <template v-if="view === 'main'">
      <div class="px-2 py-1 text-muted">Presets</div>
      <BaseMenuItem
        v-for="preset in presets"
        :key="preset.id"
        :icon="LayoutTemplate"
        :data-testid="`section-actions-apply-${preset.id}`"
        @click="run(() => emit('apply-preset', preset))"
        >Apply “{{ preset.label }}”</BaseMenuItem
      >
      <BaseMenuItem
        :icon="Plus"
        data-testid="section-actions-create-preset"
        @click="run(() => emit('create-preset'))"
        >Save as new preset</BaseMenuItem
      >
      <BaseMenuItem
        v-if="presets.length"
        :icon="Save"
        data-testid="section-actions-overwrite"
        @click="view = 'overwrite'"
        >Overwrite a preset…</BaseMenuItem
      >
      <div class="my-1 h-px bg-line" />
      <BaseMenuItem
        v-if="otherBuilds.length"
        :icon="Copy"
        data-testid="section-actions-copy"
        @click="view = 'copy'"
        >Copy from another build…</BaseMenuItem
      >
      <BaseMenuItem
        :icon="RotateCcw"
        :data-testid="`section-actions-clear-${sectionId}`"
        @click="run(() => emit('clear'))"
        >Reset to defaults</BaseMenuItem
      >
    </template>

    <template v-else>
      <BaseMenuItem
        :icon="ArrowLeft"
        data-testid="section-actions-back"
        @click="view = 'main'"
        >Back</BaseMenuItem
      >
      <div class="px-2 py-1 text-muted">
        {{
          view === "overwrite"
            ? "Overwrite with this section's values"
            : "Copy this section from"
        }}
      </div>
      <template v-if="view === 'overwrite'">
        <BaseMenuItem
          v-for="preset in presets"
          :key="preset.id"
          :icon="Save"
          :data-testid="`section-actions-update-${preset.id}`"
          @click="run(() => emit('update-preset', preset))"
          >{{ preset.label }}</BaseMenuItem
        >
      </template>
      <template v-else>
        <BaseMenuItem
          v-for="build in otherBuilds"
          :key="build.value"
          :icon="Copy"
          :data-testid="`section-actions-copy-${build.value}`"
          @click="run(() => emit('copy', build.value))"
          >{{ build.label }}</BaseMenuItem
        >
      </template>
    </template>
  </BaseMenu>
</template>
