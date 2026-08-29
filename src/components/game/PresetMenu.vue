<script lang="ts">
import { ref } from "vue";
// Shared across every instance (one per section header) so opening one popover closes
// whichever other one was already open. Independent from SectionCopyMenu's own shared ref --
// mousedown-outside on this popover's own trigger already closes SectionCopyMenu's (its class
// doesn't match SectionCopyMenu's ignore list), so the two stay mutually exclusive without
// sharing state.
const openSectionId = ref<string | null>(null);
</script>

<script setup lang="ts">
// A section header's "apply a preset" control. Choosing a preset applies it immediately --
// unlike SectionCopyMenu, there's no separate "pick a target, then confirm" step, since a
// preset is already the fully-specified target.
//
// The list is followed by "Create new from current", which goes the other way: it hands the
// section's live state to the layer editor as an unsaved preset draft. That entry is why the
// menu still renders for a section with no presets at all -- it is the only way to author the
// first one from the build editor.
//
// Each row also carries an "update from current" button, the same direction as that entry but
// aimed at a preset that already exists: it overwrites that preset's contents with the section
// as it stands. Overwriting is the one destructive thing this menu does, and it lands on a
// *layer's* undo stack rather than the build's (see `layers.updatePreset`), so it is two-step
// confirmed the same way SectionClearButton's own discard is.
import { onMounted, onUnmounted } from "vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseTooltip from "../ui/BaseTooltip.vue";
import { LayoutTemplate, Plus, Save } from "@lucide/vue";
import { useEscapeToClose } from "../../composables/useEscapeToClose";
import { useConfirm } from "../../composables/useConfirm";
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

const isOpen = () => openSectionId.value === props.sectionId;

function toggle() {
  openSectionId.value = isOpen() ? null : props.sectionId;
}

function choose(preset: SectionPreset) {
  emit("apply", preset);
  openSectionId.value = null;
}

function create() {
  emit("create");
  openSectionId.value = null;
}

const confirmUpdate_ = useConfirm();

/** Armed on the first click, fires on the second -- and the popover stays open in between so
 *  the row can say so. */
function update(preset: SectionPreset) {
  if (!confirmUpdate_.run(preset.id)) return;
  emit("update", preset);
  openSectionId.value = null;
}

/** Same `composedPath()`-based dismissal as SectionCopyMenu.vue -- see its own comment for why
 * a live `closest()` walk from `event.target` isn't reliable here. */
function onDocumentClick(event: MouseEvent) {
  if (!isOpen()) return;
  const path = event.composedPath?.() ?? [];
  if (
    path.some(
      (el) =>
        (el as Element).classList?.contains?.("preset-popover") ||
        (el as Element).classList?.contains?.("section-preset-btn"),
    )
  )
    return;
  openSectionId.value = null;
}

onMounted(() => document.addEventListener("mousedown", onDocumentClick));
onUnmounted(() => document.removeEventListener("mousedown", onDocumentClick));

useEscapeToClose(() => {
  if (isOpen()) openSectionId.value = null;
});
</script>

<template>
  <div class="relative mr-0.5 flex-none">
    <BaseTooltip text="Apply a preset to this section, or save one from it">
      <BaseButton class="section-preset-btn" @click="toggle">
        <LayoutTemplate />Presets…
      </BaseButton>
    </BaseTooltip>
    <!-- Anchored to the trigger's top edge, not centred on it: the section header is sticky at
         the top of the editor's scroll container, so a centred popover puts half its height
         above that header and under the toolbar sitting over it -- which only gets worse the
         more presets the section has. -->
    <div
      v-if="isOpen()"
      class="preset-popover absolute right-full top-0 z-30 mr-1.5 flex max-h-64 min-w-40 flex-col gap-0.5 overflow-y-auto whitespace-nowrap rounded-md border border-line bg-surface p-1 shadow-lg"
    >
      <div
        v-for="preset in presets"
        :key="preset.id"
        class="preset-menu-row flex items-center gap-1"
      >
        <button
          type="button"
          class="flex-1 rounded px-2 py-1 text-left hover:bg-surface-2"
          :data-testid="`preset-apply-${preset.id}`"
          @click="choose(preset)"
        >
          {{ preset.label }}
        </button>
        <button
          type="button"
          class="preset-update-btn [&_svg]:size-[14px] flex cursor-pointer items-center gap-1 rounded p-1 hover:bg-surface-2"
          :class="
            confirmUpdate_.isConfirming(preset.id)
              ? 'text-danger hover:text-danger'
              : 'text-muted hover:text-accent'
          "
          :title="`Overwrite “${preset.label}” with this section's current values`"
          :aria-label="`Overwrite “${preset.label}” with this section's current values`"
          :data-testid="`preset-update-${preset.id}`"
          @click="update(preset)"
        >
          <Save /><span v-if="confirmUpdate_.isConfirming(preset.id)"
            >Really?</span
          >
        </button>
      </div>
      <div v-if="presets.length" class="my-0.5 border-t border-line"></div>
      <button
        type="button"
        class="preset-create-btn flex items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-surface-2"
        data-testid="preset-create-from-current"
        @click="create"
      >
        <Plus class="size-3.5" />Create new from current
      </button>
    </div>
  </div>
</template>
