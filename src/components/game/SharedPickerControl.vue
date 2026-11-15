<script setup lang="ts">
// A shared picker's control on the row of a bonus reading it, like the location on an item
// whose bonus holds there. It writes the slot's one pick, so every reader's row and the slot's
// own row in the Shared inputs section stay in sync. The menu lists bare names: a place is an
// identity, not gear to compare.
import { computed } from "vue";
import ItemPicker from "./ItemPicker.vue";
import SharedMark from "./SharedMark.vue";
import * as buildEditor from "../../stores/buildEditor";
import { db } from "../../stores/resolved";
import type { SharedPickerControl } from "../../lib/shared-inputs";
import type { Build } from "../../types";

const props = defineProps<{
  control: SharedPickerControl;
  build: Build;
}>();

const slot = computed(() => props.control.slot);
const choice = computed(() => props.build.choices[slot.value.id] ?? "");
const items = computed(() => db.value.forSlot(slot.value.id));
const testid = computed(() => `shared-picker-${slot.value.id}`);
</script>

<template>
  <div class="flex min-w-0 items-center gap-2">
    <ItemPicker
      class="min-w-40 basis-56 max-md:grow"
      :items="items"
      :model-value="choice"
      :selected-item="db.get(choice)"
      :db="db"
      hide-preview
      :allow-empty="!slot.disallowEmpty"
      phone-screen
      :label="slot.label"
      :data-testid="testid"
      @update:model-value="buildEditor.setChoice(slot.id, $event)"
    />
    <span class="min-w-0"
      >{{ slot.label }}
      <SharedMark :text="control.shared" :testid="`${testid}-shared`"
    /></span>
  </div>
</template>
