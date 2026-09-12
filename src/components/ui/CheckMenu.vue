<script lang="ts">
export interface CheckMenuItem {
  key: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
}
</script>

<script setup lang="ts">
// A click-triggered menu of checkboxes: toggling one leaves the menu open, so related
// preferences can be flipped in one visit. NavContextMenu is the command-row counterpart.
//
// Each row states its own `checked` and emits `toggle`, so the values can stay in a store's
// individual refs without one object owning them.
import { ref, useTemplateRef } from "vue";
import { onClickOutside } from "@vueuse/core";
import BaseButton from "./BaseButton.vue";
import BaseCheckbox from "./BaseCheckbox.vue";
import BasePopover from "./BasePopover.vue";
import IconButton from "./IconButton.vue";
import { useEscapeToClose } from "../../composables/useEscapeToClose";

withDefaults(
  defineProps<{
    /** The trigger's accessible name; its text unless `iconOnly`, then its tooltip. */
    label: string;
    items: CheckMenuItem[];
    /** Tooltip on the trigger, when the label alone does not say what the menu is for. */
    title?: string;
    testid?: string;
    /** px. The menu sizes to its content up to this. */
    width?: number;
    /** Render the trigger as an icon button -- the BuildEditor toolbar's picker options. */
    iconOnly?: boolean;
  }>(),
  { title: "", testid: undefined, width: 320, iconOnly: false },
);

const emit = defineEmits<{ toggle: [key: string] }>();

const open = ref(false);
const popover = useTemplateRef<InstanceType<typeof BasePopover>>("popover");
const menuEl = useTemplateRef<HTMLElement>("menuEl");
const triggerClass = "check-menu-btn";

function toggleMenu(event: MouseEvent) {
  if (open.value) {
    close();
    return;
  }
  open.value = true;
  popover.value?.place(
    (event.currentTarget as HTMLElement).getBoundingClientRect(),
  );
}

function close() {
  open.value = false;
  popover.value?.close();
}

onClickOutside(menuEl, close, { ignore: [`.${triggerClass}`] });

useEscapeToClose(() => {
  if (open.value) close();
});
</script>

<template>
  <div class="flex-none">
    <IconButton
      v-if="iconOnly"
      :class="triggerClass"
      :title="title || label"
      :aria-expanded="open"
      :data-testid="testid"
      @click="toggleMenu"
    >
      <slot name="icon" />
    </IconButton>
    <BaseButton
      v-else
      :class="triggerClass"
      :title="title"
      :aria-expanded="open"
      :data-testid="testid"
      @click="toggleMenu"
    >
      <slot name="icon" />{{ label }}
    </BaseButton>
    <BasePopover ref="popover" :width="width" fit-content>
      <div
        ref="menuEl"
        class="flex -translate-x-full flex-col overflow-y-auto rounded-md border border-line bg-surface p-1.5 shadow-lg"
        role="group"
        :aria-label="label"
      >
        <!-- BaseCheckbox is a label wrapping its input, so padding it makes the whole row the
             hit target. -->
        <BaseCheckbox
          v-for="item in items"
          :key="item.key"
          class="rounded-md px-2 py-1.5 hover:bg-surface-2"
          :class="item.disabled && 'opacity-60'"
          :model-value="item.checked"
          :disabled="item.disabled"
          :data-testid="testid ? `${testid}:${item.key}` : undefined"
          @update:model-value="emit('toggle', item.key)"
        >
          {{ item.label }}
        </BaseCheckbox>
      </div>
    </BasePopover>
  </div>
</template>
