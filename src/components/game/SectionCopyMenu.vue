<script lang="ts">
import { ref } from "vue";
// Shared across every instance (one per section header) so opening one popover closes
// whichever other one was already open.
const openSectionId = ref<string | null>(null);
</script>

<script setup lang="ts">
// A section header's "copy this section from another build" control.
import { onMounted, onUnmounted } from "vue";
import { Copy } from "@lucide/vue";
import ComboBox from "../ui/ComboBox.vue";
import BaseButton from "../ui/BaseButton.vue";

const props = defineProps<{
  sectionId: string;
  otherBuilds: { value: string; label: string }[];
}>();

const emit = defineEmits<{
  copy: [fromId: string];
}>();

// Defaults to the first other build in the collection so the control is usable with a
// single click, not "pick a build, then click copy".
const chosen = ref(props.otherBuilds[0]?.value ?? "");

const isOpen = () => openSectionId.value === props.sectionId;

function toggle() {
  openSectionId.value = isOpen() ? null : props.sectionId;
}

function confirm() {
  if (!chosen.value) return;
  emit("copy", chosen.value);
  openSectionId.value = null;
}

/**
 * Closes the popover on a click landing outside it. `event.composedPath()`, not a live
 * `target.closest(...)` walk: choosing the popover's own ComboBox option closes *that*
 * dropdown in the same mousedown (see `choose()` in ComboBox.vue), which synchronously
 * detaches the clicked row from `.copy-popover` before this handler runs -- a `closest()`
 * walk from `event.target` at that point no longer finds the popover as an ancestor, even
 * though the click plainly landed inside it. `composedPath()` is the path as it was at
 * dispatch time, unaffected by DOM changes any listener made along the way.
 */
function onDocumentClick(event: MouseEvent) {
  if (!isOpen()) return;
  const path = event.composedPath?.() ?? [];
  if (
    path.some(
      (el) =>
        (el as Element).classList?.contains?.("copy-popover") ||
        (el as Element).classList?.contains?.("section-copy-btn"),
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
    <BaseButton
      title="Copy this section from another build"
      class="section-copy-btn"
      @click="toggle"
    >
      <Copy />Copy from…
    </BaseButton>
    <div
      v-if="isOpen()"
      class="copy-popover absolute right-full top-1/2 z-30 mr-1.5 flex -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded-md border border-line bg-surface px-2 py-1.5 shadow-lg"
    >
      <span class="text-sm text-muted">Copy section from</span>
      <ComboBox
        class="copy-popover-select w-44"
        :model-value="chosen"
        :options="otherBuilds"
        placeholder="choose a build…"
        @update:model-value="chosen = $event"
      />
      <BaseButton variant="primary" :disabled="!chosen" @click="confirm"
        >Copy</BaseButton
      >
    </div>
  </div>
</template>
