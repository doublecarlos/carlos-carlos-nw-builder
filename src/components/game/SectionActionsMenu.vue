<script setup lang="ts">
// A section header's actions in one labeled menu: apply or save presets, copy the section from
// another build, reset it. Picking which preset to overwrite or which build to copy from opens
// a second list in the same menu, with Back, rather than squeezing a picker into it. The build
// list draws the sidebar's folder tree (lib/tree-rows.ts), since names are only unique within
// a folder.
//
// Applying, copying and resetting act at once, each one undo step on the build. Overwriting a
// preset lands on that layer's undo stack instead (see `layers.updatePreset`), which posts an
// undo notice.
import { computed, nextTick, ref, useTemplateRef } from "vue";
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
import FolderHeading from "./FolderHeading.vue";
import { treePadding, treeRows } from "../../lib/tree-rows";
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

type View = "main" | "overwrite" | "copy";

const view = ref<View>("main");

/** Swaps the list in place. The entry that held focus is gone, so focus moves to the new
 *  list's first entry to keep the keyboard working. */
function show(next: View) {
  view.value = next;
  void nextTick(() => menu.value?.focusFirst());
}

/** The builds with their folder headings, as the sidebar nests them. */
const buildRows = computed(() =>
  treeRows(props.otherBuilds, (build) => build.path),
);

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
    panel-testid="section-actions-panel"
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
      <div class="px-2 py-1 text-muted">
        {{ presets.length ? "Apply a preset" : "Presets" }}
      </div>
      <BaseMenuItem
        v-for="preset in presets"
        :key="preset.id"
        :icon="LayoutTemplate"
        :data-testid="`preset-apply-${preset.id}`"
        @click="run(() => emit('apply-preset', preset))"
        >{{ preset.label }}</BaseMenuItem
      >
      <BaseMenuItem
        :icon="Plus"
        data-testid="preset-create-from-current"
        @click="run(() => emit('create-preset'))"
        >Save as new preset</BaseMenuItem
      >
      <BaseMenuItem
        v-if="presets.length"
        :icon="Save"
        data-testid="section-actions-overwrite"
        @click="show('overwrite')"
        >Overwrite a preset…</BaseMenuItem
      >
      <div class="my-1 h-px bg-line" />
      <BaseMenuItem
        v-if="otherBuilds.length"
        :icon="Copy"
        data-testid="section-actions-copy"
        @click="show('copy')"
        >Copy from another build…</BaseMenuItem
      >
      <BaseMenuItem
        :icon="RotateCcw"
        :data-testid="`clear-section-${sectionId}`"
        @click="run(() => emit('clear'))"
        >Reset to defaults</BaseMenuItem
      >
    </template>

    <template v-else>
      <BaseMenuItem
        :icon="ArrowLeft"
        data-testid="section-actions-back"
        @click="show('main')"
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
          :data-testid="`preset-update-${preset.id}`"
          @click="run(() => emit('update-preset', preset))"
          >{{ preset.label }}</BaseMenuItem
        >
      </template>
      <template v-else>
        <template v-for="(row, index) in buildRows" :key="index">
          <div
            v-if="row.kind === 'heading'"
            class="px-2 py-1"
            data-testid="section-actions-folder"
          >
            <FolderHeading :name="row.step.label" :depth="row.depth" />
          </div>
          <BaseMenuItem
            v-else
            :icon="Copy"
            :style="treePadding(row.depth, 0.5)"
            :data-testid="`section-actions-copy-${row.item.value}`"
            @click="run(() => emit('copy', row.item.value))"
            >{{ row.item.label }}</BaseMenuItem
          >
        </template>
      </template>
    </template>
  </BaseMenu>
</template>
