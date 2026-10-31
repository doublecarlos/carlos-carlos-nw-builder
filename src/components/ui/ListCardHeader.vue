<script setup lang="ts">
// Header row of one card in a reorderable list: grip, optional fold chevron, "<Noun> N", the
// row actions right after it as in DraftFormBar, then the caller's content (a summary, an
// inline field). Content goes last so the actions keep their place as it changes length. The
// actions read the same on every list: move up/down, duplicate, insert below, remove, then
// the caller's own `#actions`. Used by a bonus's grants and a grant's tiers and variants.
//
// The row wraps in whole groups, never inside one: the content drops under the header, and on
// a narrower card the actions drop under the grip and name.
//
// `expanded` makes the card foldable: the chevron is the accessible toggle and a click on the
// row's inert area toggles too.
import { computed } from "vue";
import ArrowDown from "virtual:icon/arrow-down.vue";
import ArrowUp from "virtual:icon/arrow-up.vue";
import ChevronDown from "virtual:icon/chevron-down.vue";
import ChevronRight from "virtual:icon/chevron-right.vue";
import CirclePlus from "virtual:icon/circle-plus.vue";
import Copy from "virtual:icon/copy.vue";
import Trash from "virtual:icon/trash.vue";
import DragHandle from "./DragHandle.vue";
import IconButton from "./IconButton.vue";
import type { DragHandleProps } from "../../composables/useDragAndDrop";
import { clickedControl } from "../../lib/control-click";

const props = withDefaults(
  defineProps<{
    /** Lowercase, as the action titles use it: "Move grant up". */
    noun: string;
    index: number;
    count: number;
    dragHandle: DragHandleProps;
    dragTestid?: string;
    /** Set to make the card foldable; left out, it has no chevron. */
    expanded?: boolean;
  }>(),
  { dragTestid: undefined, expanded: undefined },
);

const emit = defineEmits<{
  toggle: [];
  move: [delta: -1 | 1];
  duplicate: [];
  insert: [];
  remove: [];
}>();

const foldable = computed(() => props.expanded !== undefined);
const label = computed(
  () =>
    `${props.noun[0]?.toUpperCase()}${props.noun.slice(1)} ${props.index + 1}`,
);

function onRowClick(event: MouseEvent) {
  if (foldable.value && !clickedControl(event)) emit("toggle");
}
</script>

<template>
  <div
    class="flex flex-wrap items-center gap-1.5"
    :class="foldable && 'cursor-pointer'"
    @click="onRowClick"
  >
    <div class="flex flex-wrap items-center gap-1.5">
      <div class="flex items-center gap-1.5">
        <DragHandle :data-testid="dragTestid" v-bind="dragHandle" />
        <IconButton
          v-if="foldable"
          :title="expanded ? 'Collapse' : 'Expand'"
          :aria-expanded="expanded"
          :data-testid="`${noun}-toggle`"
          @click="emit('toggle')"
        >
          <ChevronDown v-if="expanded" />
          <ChevronRight v-else />
        </IconButton>
        <span class="text-muted">{{ label }}</span>
      </div>
      <div class="flex items-center gap-1.5">
        <IconButton
          :title="`Move ${noun} up`"
          :disabled="index === 0"
          @click="emit('move', -1)"
          ><ArrowUp
        /></IconButton>
        <IconButton
          :title="`Move ${noun} down`"
          :disabled="index === count - 1"
          @click="emit('move', 1)"
          ><ArrowDown
        /></IconButton>
        <IconButton :title="`Duplicate ${noun}`" @click="emit('duplicate')"
          ><Copy
        /></IconButton>
        <IconButton :title="`Insert ${noun} below`" @click="emit('insert')"
          ><CirclePlus
        /></IconButton>
        <IconButton :title="`Remove ${noun}`" @click="emit('remove')"
          ><Trash
        /></IconButton>
        <slot name="actions" />
      </div>
    </div>
    <div
      v-if="$slots.default"
      class="flex min-w-0 grow items-center gap-1.5 empty:hidden"
    >
      <slot />
    </div>
  </div>
</template>
