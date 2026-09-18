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
//
// Built on BaseMenu with `role="group"`, not `menu`: a checkbox is a semantics mismatch for a
// menuitem. Roving focus still moves over the native `<input>`s.
import BaseButton from "./BaseButton.vue";
import BaseCheckbox from "./BaseCheckbox.vue";
import BaseMenu from "./BaseMenu.vue";
import IconButton from "./IconButton.vue";

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
</script>

<template>
  <div class="flex-none">
    <BaseMenu
      :width="width"
      fit-content
      role="group"
      :label="label"
      panel-class="flex flex-col overflow-y-auto p-1.5"
      item-selector="input[type='checkbox']"
      :ignore="['.check-menu-btn']"
    >
      <template #trigger="{ toggle: openMenu, attrs }">
        <IconButton
          v-if="iconOnly"
          class="check-menu-btn"
          :title="title || label"
          v-bind="attrs"
          :data-testid="testid"
          @click="openMenu"
        >
          <slot name="icon" />
        </IconButton>
        <BaseButton
          v-else
          class="check-menu-btn"
          :title="title"
          v-bind="attrs"
          :data-testid="testid"
          @click="openMenu"
        >
          <slot name="icon" />{{ label }}
        </BaseButton>
      </template>

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
    </BaseMenu>
  </div>
</template>
