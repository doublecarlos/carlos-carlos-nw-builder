<script lang="ts">
import { useExclusiveOpen } from "../../composables/useExclusiveOpen";
// Shared across every instance (one per section header) so opening one popover closes
// whichever other one was already open.
const exclusive = useExclusiveOpen<string>();
</script>

<script setup lang="ts">
// A section header's "copy this section from another build" control. `roving: false` since the
// combobox owns its own Up/Down. `dismiss-on-tab: false` so Tab reaches the Copy button instead
// of closing the menu first.
import { ref, useTemplateRef, watch } from "vue";
import { Copy } from "@lucide/vue";
import BuildComboBox from "./BuildComboBox.vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseTooltip from "../ui/BaseTooltip.vue";
import BaseMenu from "../ui/BaseMenu.vue";
import type { BuildOption } from "../../types";

const props = defineProps<{
  sectionId: string;
  otherBuilds: BuildOption[];
}>();

const emit = defineEmits<{
  copy: [fromId: string];
}>();

// Defaults to the first other build in the collection so the control is usable with a
// single click, not "pick a build, then click copy".
const chosen = ref(props.otherBuilds[0]?.value ?? "");

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

function confirm() {
  if (!chosen.value) return;
  emit("copy", chosen.value);
  menu.value?.close();
}
</script>

<template>
  <div class="mr-0.5 flex-none">
    <BaseMenu
      ref="menu"
      :width="480"
      fit-content
      role="group"
      :roving="false"
      :dismiss-on-tab="false"
      label="Copy section from"
      panel-class="copy-popover flex items-center gap-1.5 whitespace-nowrap px-2 py-1.5"
      item-selector="[data-testid='picker-input']"
      :ignore="['.section-copy-btn']"
      @open="exclusive.open(sectionId)"
      @close="onClose"
    >
      <template #trigger="{ toggle, attrs }">
        <BaseTooltip text="Copy this section from another build">
          <BaseButton class="section-copy-btn" v-bind="attrs" @click="toggle">
            <Copy />Copy from…
          </BaseButton>
        </BaseTooltip>
      </template>

      <span class="text-muted">Copy section from</span>
      <BuildComboBox
        v-model="chosen"
        class="copy-popover-select w-56"
        :options="otherBuilds"
        placeholder="Choose a build…"
      />
      <BaseButton variant="primary" :disabled="!chosen" @click="confirm"
        >Copy</BaseButton
      >
    </BaseMenu>
  </div>
</template>
