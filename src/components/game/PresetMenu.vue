<script lang="ts">
import { useExclusiveOpen } from "../../composables/useExclusiveOpen";
// Shared across every instance (one per section header) so opening one popover closes
// whichever other one was already open. Independent from SectionCopyMenu's own instance:
// each `useExclusiveOpen()` call creates its own state.
const exclusive = useExclusiveOpen<string>();
</script>

<script setup lang="ts">
// A section header's "apply a preset" control. Choosing a preset applies it immediately, with
// no separate "pick a target, then confirm" step like SectionCopyMenu has, since a preset is
// already the fully-specified target.
//
// The list is followed by "Create new from current", which goes the other way: it hands the
// section's live state to the layer editor as an unsaved preset draft. That entry is why the
// menu still renders for a section with no presets at all: it is the only way to author the
// first one from the build editor.
//
// Each row also carries an "update from current" button, the same direction as that entry but
// aimed at a preset that already exists: it overwrites that preset's contents with the section
// as it stands. Overwriting is the one destructive thing this menu does, and it lands on a
// *layer's* undo stack rather than the build's (see `layers.updatePreset`), out of reach of
// Ctrl+Z here, so that store posts an undo notice.
import { useTemplateRef, watch } from "vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseTooltip from "../ui/BaseTooltip.vue";
import BaseMenu from "../ui/BaseMenu.vue";
import { LayoutTemplate, Plus, Save } from "@lucide/vue";
import type { SectionPreset } from "../../types";

const props = defineProps<{
  sectionId: string;
  presets: SectionPreset[];
}>();

const emit = defineEmits<{
  apply: [preset: SectionPreset];
  create: [];
  update: [preset: SectionPreset];
}>();

const menu = useTemplateRef<InstanceType<typeof BaseMenu>>("menu");

// Another section grabbing `exclusive` means this one is no longer open; close to match.
watch(
  () => exclusive.isOpen(props.sectionId),
  (mine) => {
    if (!mine) menu.value?.close();
  },
);

/** Only clears `exclusive` when this instance held it. A close cascading from the watch above
 *  (another section just took it) must not stomp that section's own claim. */
function onClose() {
  if (exclusive.isOpen(props.sectionId)) exclusive.close();
}

function choose(preset: SectionPreset) {
  emit("apply", preset);
  menu.value?.close();
}

function create() {
  emit("create");
  menu.value?.close();
}

/** Closes the menu as it writes, so the undo notice is not left behind it. */
function update(preset: SectionPreset) {
  menu.value?.close();
  emit("update", preset);
}
</script>

<template>
  <div class="mr-0.5 flex-none">
    <BaseMenu
      ref="menu"
      :width="320"
      fit-content
      role="group"
      panel-class="preset-popover flex max-h-64 min-w-40 flex-col gap-0.5 overflow-y-auto whitespace-nowrap p-1"
      :ignore="['.section-preset-btn']"
      @open="exclusive.open(sectionId)"
      @close="onClose"
    >
      <template #trigger="{ toggle, attrs }">
        <BaseTooltip text="Apply a preset to this section, or save one from it">
          <BaseButton class="section-preset-btn" v-bind="attrs" @click="toggle">
            <LayoutTemplate />Presets…
          </BaseButton>
        </BaseTooltip>
      </template>

      <div
        v-for="preset in presets"
        :key="preset.id"
        class="preset-menu-row flex items-center gap-1"
      >
        <button
          type="button"
          tabindex="-1"
          class="flex-1 rounded px-2 py-1 text-left hover:bg-surface-2"
          :data-testid="`preset-apply-${preset.id}`"
          @click="choose(preset)"
        >
          {{ preset.label }}
        </button>
        <button
          type="button"
          tabindex="-1"
          class="preset-update-btn [&_svg]:size-[14px] flex cursor-pointer items-center gap-1 rounded p-1 text-muted hover:bg-surface-2 hover:text-accent"
          :title="`Overwrite “${preset.label}” with this section's current values`"
          :aria-label="`Overwrite “${preset.label}” with this section's current values`"
          :data-testid="`preset-update-${preset.id}`"
          @click="update(preset)"
        >
          <Save />
        </button>
      </div>
      <div v-if="presets.length" class="my-0.5 border-t border-line"></div>
      <button
        type="button"
        tabindex="-1"
        class="preset-create-btn flex items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-surface-2"
        data-testid="preset-create-from-current"
        @click="create"
      >
        <Plus class="size-3.5" />Create new from current
      </button>
    </BaseMenu>
  </div>
</template>
