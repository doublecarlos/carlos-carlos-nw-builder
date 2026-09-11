<script lang="ts">
import { useExclusiveOpen } from "../../composables/useExclusiveOpen";
// Shared across every instance (one per section header) so opening one popover closes
// whichever other one was already open.
const exclusive = useExclusiveOpen<string>();
</script>

<script setup lang="ts">
// A section header's "copy this section from another build" control.
import { ref, useTemplateRef } from "vue";
import { onClickOutside } from "@vueuse/core";
import { Copy } from "@lucide/vue";
import BuildComboBox from "./BuildComboBox.vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseTooltip from "../ui/BaseTooltip.vue";
import BasePopover from "../ui/BasePopover.vue";
import { useEscapeToClose } from "../../composables/useEscapeToClose";
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

const isOpen = () => exclusive.isOpen(props.sectionId);
const popover = useTemplateRef<InstanceType<typeof BasePopover>>("popover");
const menuEl = useTemplateRef<HTMLElement>("menuEl");

function toggle(event: MouseEvent) {
  if (isOpen()) {
    close();
    return;
  }
  exclusive.open(props.sectionId);
  popover.value?.place(
    (event.currentTarget as HTMLElement).getBoundingClientRect(),
  );
}

function close() {
  exclusive.close();
  popover.value?.close();
}

function confirm() {
  if (!chosen.value) return;
  emit("copy", chosen.value);
  close();
}

// composedPath-based, not a live closest() walk: choosing the ComboBox option inside detaches
// that row from the DOM in the same mousedown (see `choose()` in ComboBox.vue), which a
// closest() check would miss.
onClickOutside(menuEl, close, { ignore: [".section-copy-btn"] });

useEscapeToClose(() => {
  if (isOpen()) close();
});
</script>

<template>
  <div class="mr-0.5 flex-none">
    <BaseTooltip text="Copy this section from another build">
      <BaseButton class="section-copy-btn" @click="toggle">
        <Copy />Copy from…
      </BaseButton>
    </BaseTooltip>
    <BasePopover ref="popover" :width="480" fit-content>
      <div
        ref="menuEl"
        class="copy-popover -translate-x-full flex items-center gap-1.5 whitespace-nowrap rounded-md border border-line bg-surface px-2 py-1.5 shadow-lg"
      >
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
      </div>
    </BasePopover>
  </div>
</template>
