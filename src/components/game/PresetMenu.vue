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
import { onMounted, onUnmounted } from "vue";
import IconButton from "../ui/IconButton.vue";
import { LayoutTemplate } from "@lucide/vue";
import type { SectionPreset } from "../../types";

const props = defineProps<{
  sectionId: string;
  presets: SectionPreset[];
}>();

const emit = defineEmits<{
  apply: [preset: SectionPreset];
}>();

const isOpen = () => openSectionId.value === props.sectionId;

function toggle() {
  openSectionId.value = isOpen() ? null : props.sectionId;
}

function choose(preset: SectionPreset) {
  emit("apply", preset);
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
</script>

<template>
  <div class="relative mr-0.5 flex-none">
    <IconButton
      title="Apply a preset to this section"
      class="section-preset-btn"
      @click="toggle"
    >
      <LayoutTemplate />
    </IconButton>
    <div
      v-if="isOpen()"
      class="preset-popover absolute right-full top-1/2 z-30 mr-1.5 flex max-h-64 min-w-40 -translate-y-1/2 flex-col gap-0.5 overflow-y-auto whitespace-nowrap rounded-md border border-line bg-surface p-1 shadow-lg"
    >
      <button
        v-for="preset in presets"
        :key="preset.id"
        type="button"
        class="rounded px-2 py-1 text-left text-sm hover:bg-surface-2"
        @click="choose(preset)"
      >
        {{ preset.label }}
      </button>
    </div>
  </div>
</template>
