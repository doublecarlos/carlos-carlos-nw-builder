<script setup lang="ts">
// The one picker every "choose a build" surface uses -- the quick-compare selector and a
// section's "copy from" popover today.
//
// Build names are only unique within a folder, and these surfaces sit outside the sidebar that
// draws the grouping, so the list is grouped the same way the sidebar is: one heading per
// folder, its builds indented under it, in sidebar order. That keeps the folder out of the
// rows themselves, where it would eat the width the names need. The closed field has no
// second line to put a heading on, so it spells the folder inline instead -- dropping it there
// would put the ambiguity back the moment a choice is made.
//
// The menu sizes to its longest name, up to a cap, since the compare picker's own field is a
// narrow stat-panel table cell. It grows rightward: that panel is a rail whose scroller clips
// horizontally, and a menu anchored to grow leftward has its text -- which sits at its left
// edge -- cut off by the rail rather than merely narrowed.
import { computed } from "vue";
import { Folder } from "@lucide/vue";
import ComboBox from "../ui/ComboBox.vue";
import type { BuildOption } from "../../types";

const props = withDefaults(
  defineProps<{
    options: BuildOption[];
    placeholder?: string;
  }>(),
  { placeholder: "-" },
);

const model = defineModel<string>({ default: "" });

/** ComboBox heads its list wherever `group` changes, so the folder name is handed over under
 *  the name the primitive knows it by. */
const grouped = computed(() =>
  props.options.map((option) => ({ ...option, group: option.folder })),
);

const selected = computed(
  () => props.options.find((option) => option.value === model.value) ?? null,
);

/** Folder first, so a column of chosen builds lines up by where they live -- and so the half
 *  that gets clipped in a narrow field is the one the open list spells out anyway. Empty falls
 *  back to ComboBox's own label-only display, which is what a top-level build -- or the
 *  "- none -" row -- wants. */
const closedDisplay = computed(() =>
  selected.value?.folder
    ? `${selected.value.folder} · ${selected.value.label}`
    : "",
);
</script>

<template>
  <ComboBox
    v-model="model"
    :options="grouped"
    :placeholder="placeholder"
    :closed-display="closedDisplay"
    menu-class="left-0 w-max min-w-full max-w-[min(22rem,80vw)]"
  >
    <template #group="{ label }">
      <span class="flex items-center gap-1.5 font-semibold text-muted">
        <Folder class="size-[13px] flex-none" />
        <span class="overflow-hidden text-ellipsis whitespace-nowrap">{{
          label
        }}</span>
      </span>
    </template>
    <template #option="{ option }">
      <!-- Indented under its heading, the way the sidebar nests a folder's builds. -->
      <div
        class="overflow-hidden text-ellipsis whitespace-nowrap"
        :class="option.folder && 'pl-4'"
      >
        {{ option.label }}
      </div>
    </template>
  </ComboBox>
</template>
