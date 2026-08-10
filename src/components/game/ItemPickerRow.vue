<script setup lang="ts">
// The item_picker case of BuildSlot.vue's row content: the picker itself, its typed
// dynamicStat magnitude (when the chosen item has one), and this type's diff notes
// (choice/bonus/value). Row chrome (label, cursor anchor, hover/diff highlighting, the
// errors list) stays in BuildSlot.vue since it's identical across every slot type.
import { computed, useTemplateRef } from "vue";
import ItemPicker from "./ItemPicker.vue";
import BaseButton from "../ui/BaseButton.vue";
import BaseCheckbox from "../ui/BaseCheckbox.vue";
import IconButton from "../ui/IconButton.vue";
import { Plus } from "@lucide/vue";
import * as buildEditor from "../../stores/buildEditor";
import { useItemProcs } from "../../composables/useItemProcs";
import { label as statLabel } from "../../lib/format";
import type { Build, Db, Item, ItemPickerSlot } from "../../types";

const props = defineProps<{
  slotDef: ItemPickerSlot;
  build: Build;
  /** The active build's resolved db -- only needed for the picker's bonus-aware preview
   *  (ItemPicker.vue's `bonusPreview` prop below). */
  db: Db;
  compareBuild?: Build | null;
  highlightDiff: boolean;
  item?: Item | null;
  items?: Item[];
  statSummary?: string;
  invalid?: boolean;
  choiceDiffers?: boolean;
  otherChoiceLabel?: string;
  bonusDiffs?: { id: string; message: string }[];
  valueDiffers?: boolean;
  otherValue?: number | null;
}>();

const emit = defineEmits<{
  /** The row's own "new item" shortcut -- BuildSlot.vue forwards it up with this row's
   *  `filter`, so the item editor can open with a fresh draft pre-filtered to this slot. */
  addItem: [];
}>();

const picker = useTemplateRef<InstanceType<typeof ItemPicker>>("picker");

const procRows = useItemProcs(computed(() => props.item));

defineExpose({
  focus: () => picker.value?.focus(),
  focusAndSeed: (char: string) => picker.value?.focusAndSeed(char),
});

const choice = () => props.build.choices[props.slotDef.id] ?? "";
const value = () => props.build.values[props.slotDef.id];
</script>

<template>
  <div class="flex flex-wrap items-center gap-2.5">
    <ItemPicker
      ref="picker"
      class="grow-0 basis-80 min-w-40"
      :items="items ?? []"
      :model-value="choice()"
      :selected-item="item"
      :invalid="invalid"
      :bonus-preview="{ db, build, slotId: slotDef.id }"
      @update:model-value="buildEditor.setChoice(slotDef.id, $event)"
    />
    <span class="min-w-0 flex-1 truncate text-sm text-text">{{
      item ? statSummary : ""
    }}</span>
    <IconButton
      title="Create a new item for this slot"
      data-testid="add-item-for-slot"
      @click="emit('addItem')"
    >
      <Plus />
    </IconButton>
  </div>

  <!-- One checkbox per proc-gated grant credited to this item -- see useItemProcs.ts for why
       only the shared bonus's first-contributing row gets one. -->
  <div v-if="procRows.length" class="mt-1 flex flex-wrap items-center gap-2.5">
    <BaseCheckbox
      v-for="row in procRows"
      :key="row.grantKey"
      inline
      :data-testid="`proc-toggle-${row.grantKey}`"
      :model-value="row.checked"
      @update:model-value="
        buildEditor.setProc(row.grantKey, $event as boolean, row.label)
      "
    >
      {{ row.label }}
    </BaseCheckbox>
  </div>

  <!-- Dynamic weapon modifications carry a user-typed magnitude. Driven by the item's own
       `dynamicStat`, not by a hard-coded slot id, so a second one would work with no UI
       change -- item-local params (later phase) generalize this further. -->
  <div v-if="item?.dynamicStat" class="mt-1 flex items-center gap-1.5">
    <input
      type="number"
      class="w-20 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
      :min="item?.dynamicMin"
      :max="item?.dynamicMax"
      :value="value() ?? ''"
      :placeholder="String(item?.dynamicMin ?? '')"
      @input="
        buildEditor.setValue(
          slotDef.id,
          ($event.target as HTMLInputElement).value,
        )
      "
    />
    <span class="text-sm text-muted">
      {{ statLabel(item?.dynamicStat as string) }}
      {{ item?.dynamicMin }}–{{ item?.dynamicMax }}
    </span>
  </div>

  <p
    v-if="highlightDiff && choiceDiffers"
    class="slot-diff-note mt-0.5 text-sm text-muted"
  >
    {{ compareBuild?.name }}: {{ otherChoiceLabel || "(empty)" }}
    <BaseButton
      variant="link"
      class="ml-0.5 text-accent"
      @click.stop="buildEditor.applyFromCompare(slotDef.id)"
    >
      apply
    </BaseButton>
  </p>

  <template v-if="highlightDiff">
    <p
      v-for="bonusDiff in bonusDiffs ?? []"
      :key="bonusDiff.id"
      class="mt-0.5 text-sm font-semibold text-diff"
    >
      {{ bonusDiff.message }}
    </p>
  </template>

  <p
    v-if="highlightDiff && valueDiffers"
    class="slot-diff-note mt-0.5 text-sm text-muted"
  >
    {{ compareBuild?.name }}: {{ otherValue ?? "(none)" }}
    <BaseButton
      variant="link"
      class="ml-0.5 text-accent"
      @click.stop="buildEditor.applyValueFromCompare(slotDef.id)"
    >
      apply
    </BaseButton>
  </p>
</template>
