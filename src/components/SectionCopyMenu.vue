<script lang="ts">
import { ref } from 'vue';
// Shared across every instance (one per section header) so opening one popover closes
// whichever other one was already open.
const openSectionId = ref<string | null>(null);
</script>

<script setup lang="ts">
// A section header's "copy this section from another build" control.
import { onMounted, onUnmounted } from 'vue';
import IconButton from './IconButton.vue';
import ComboBox from './ComboBox.vue';

const props = defineProps<{
  sectionId: string;
  otherBuilds: { value: string; label: string }[];
}>();

const emit = defineEmits<{
  copy: [fromId: string];
}>();

// Defaults to the first other build in the collection so the control is usable with a
// single click, not "pick a build, then click copy".
const chosen = ref(props.otherBuilds[0]?.value ?? '');

const isOpen = () => openSectionId.value === props.sectionId;

function toggle() {
  openSectionId.value = isOpen() ? null : props.sectionId;
}

function confirm() {
  if (!chosen.value) return;
  emit('copy', chosen.value);
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
  if (path.some((el) => (el as Element).classList?.contains?.('copy-popover')
    || (el as Element).classList?.contains?.('section-copy-btn'))) return;
  openSectionId.value = null;
}

onMounted(() => document.addEventListener('mousedown', onDocumentClick));
onUnmounted(() => document.removeEventListener('mousedown', onDocumentClick));
</script>

<template>
  <div class="copy-popover-wrap">
    <IconButton icon="copy" title="Copy this section from another build" class="section-copy-btn"
                @click="toggle" />
    <div v-if="isOpen()" class="copy-popover">
      <span class="copy-popover-label">Copy section from</span>
      <ComboBox class="copy-popover-select" :model-value="chosen" :options="otherBuilds"
                placeholder="choose a build…" @update:model-value="chosen = $event" />
      <button type="button" class="btn btn--primary" :disabled="!chosen" @click="confirm">Copy</button>
    </div>
  </div>
</template>

<style scoped>
.copy-popover-wrap { flex: none; margin-right: 2px; position: relative; }
.copy-popover {
  align-items: center;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: 0 8px 24px rgba(0, 0, 0, .18);
  display: flex;
  gap: 6px;
  padding: 7px 9px;
  position: absolute;
  right: calc(100% + 6px);
  top: 50%;
  transform: translateY(-50%);
  white-space: nowrap;
  z-index: 25;
}
.copy-popover-label { color: var(--muted); font-size: 1rem; }
.copy-popover-select { width: 170px; }
</style>
