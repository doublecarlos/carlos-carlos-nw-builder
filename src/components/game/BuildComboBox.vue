<script setup lang="ts">
// The picker for choosing a build in a field: the quick-compare selector.
//
// Build names are only unique within a folder, and this field sits outside the sidebar that
// draws the grouping, so the list draws the same folder tree (lib/tree-rows.ts): one heading
// per folder, indented to its depth, with each build under its own. That keeps the path out of
// the rows themselves, where it would eat the width the names need.
//
// Closed, the field shows two lines for a build in a folder: the path, small and muted, over
// the name. A top-level build shows its name alone, centered in the same height, so a column
// of chosen builds keeps one row height. The path is cut from its start, keeping the nearest
// folder in view; the box's own value still spells out the whole path for the tooltip and for
// assistive tech, since dropping it would put the ambiguity back the moment a choice is made.
//
// The menu sizes to its longest name, up to a cap, since the compare picker's own field is a
// narrow stat-panel table cell. It grows rightward: that panel is a rail whose scroller clips
// horizontally, and a menu anchored to grow leftward has its text (which sits at its left
// edge) cut off by the rail rather than merely narrowed.
import { computed } from "vue";
import ComboBox from "../ui/ComboBox.vue";
import FolderHeading from "./FolderHeading.vue";
import { pathLabel, treeIndent } from "../../lib/tree-rows";
import type { BuildOption } from "../../types";

const props = withDefaults(
  defineProps<{
    options: BuildOption[];
    placeholder?: string;
  }>(),
  { placeholder: "-" },
);

const model = defineModel<string>({ default: "" });

/** ComboBox heads its list from each option's `group`, so the folder path is handed over
 *  under the name the primitive knows it by. */
const grouped = computed(() =>
  props.options.map((option) => ({ ...option, group: option.path })),
);

const selected = computed(
  () => props.options.find((option) => option.value === model.value) ?? null,
);

/** The whole path and name on one line. Empty falls back to ComboBox's own label, which is
 *  what a top-level build, or the "- none -" row, wants. */
const closedDisplay = computed(() =>
  selected.value?.path
    ? `${pathLabel(selected.value.path)} · ${selected.value.label}`
    : "",
);
</script>

<template>
  <ComboBox
    v-model="model"
    :options="grouped"
    :placeholder="placeholder"
    :closed-display="closedDisplay"
    input-class="h-9"
    menu-class="w-max min-w-(--anchor-width) max-w-[min(22rem,80vw)]"
  >
    <template #group="{ label, depth }">
      <FolderHeading :name="label" :depth="depth" />
    </template>
    <template #option="{ option, depth }">
      <div
        class="overflow-hidden text-ellipsis whitespace-nowrap"
        :style="treeIndent(depth)"
      >
        {{ option.label }}
      </div>
    </template>
    <template #closed="{ option }">
      <!-- Right to left so the ellipsis eats the outer folders; the path itself still reads
           left to right inside. -->
      <span
        v-if="option.path"
        dir="rtl"
        class="overflow-hidden text-ellipsis whitespace-nowrap text-left text-xs leading-tight text-muted"
        data-testid="picker-closed-path"
        ><bdi dir="ltr">{{ pathLabel(option.path) }}</bdi></span
      >
      <span
        class="overflow-hidden text-ellipsis whitespace-nowrap leading-tight"
        >{{ option.label }}</span
      >
    </template>
  </ComboBox>
</template>
