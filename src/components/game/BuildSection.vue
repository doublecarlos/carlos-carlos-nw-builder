<script setup lang="ts">
// One collapsible section: header (label, fill count, error/diff badges, collapse toggle, copy-
// from-another-build menu, revert) plus its slot list. Row content is a scoped slot so
// BuildEditor.vue keeps owning the cross-row state (hover card, keyboard cursor, compare-diff)
// that a single row can't compute on its own -- this component only knows about the section
// itself, not what's inside a row.
//
// The fill-count badge only ever counts item_picker slots (`total`/`filled`, computed by the
// caller) -- a section made entirely of build_parameter slots (Options) naturally gets no badge
// as a result, not because this component special-cases its id.
import BaseBadge from "../ui/BaseBadge.vue";
import SectionCopyMenu from "./SectionCopyMenu.vue";
import PresetMenu from "./PresetMenu.vue";
import SectionClearButton from "./SectionClearButton.vue";
import { useCursorRowKeys } from "../../composables/useCursorRowKeys";
import { useTemplateRef } from "vue";
import type { Slot, SectionPreset, BuildOption } from "../../types";

const props = defineProps<{
  id: string;
  label: string;
  slots: Slot[];
  filled: number;
  total: number;
  errors: number;
  warnings: number;
  diffs: number;
  expanded: boolean;
  /** Arrow keys on the focused header: BuildEditor moves focus to the next/previous row,
   *  or to the next/previous section when the platform modifier is held. */
  onArrow: (dir: 1 | -1, bySection: boolean) => void;
  highlightDiff: boolean;
  otherBuilds: BuildOption[];
  presets: SectionPreset[];
}>();

defineEmits<{
  toggle: [];
  copy: [fromId: string];
  "apply-preset": [preset: SectionPreset];
  "create-preset": [];
  "update-preset": [preset: SectionPreset];
  clear: [];
}>();

defineSlots<{
  default(props: { slotDef: Slot }): unknown;
}>();

/** The header button is its own cursor target: while it has focus it IS the highlighted row,
 *  and arrows move focus to the neighbouring row. Enter/Space need no binding -- a focused
 *  button's native click already fires the toggle. */
const button = useTemplateRef("button");
useCursorRowKeys(button, {
  onArrow: (dir, bySection) => props.onArrow(dir, bySection),
});
</script>

<template>
  <!-- `data-section-id` is what BuildEditor's section-at-a-time cursor and the section rail's
       scroll spy both navigate by, the same way `data-cursor-key` marks a row. -->
  <section class="rounded-md border border-line" :data-section-id="id">
    <!-- Sticky within its own section, so a long one (Group is 28 rows, Artifact Call 26)
         still says which section you are reading once its top has scrolled away. The editor's
         `<main>` is the scroll container and the toolbar above it is a sibling, not an
         ancestor, so `top-0` pins to the top of the visible list with nothing over it. The
         divider moves here from the body below: sticking detaches the header from the body,
         which would take the body's own top border with it. -->
    <div
      class="bg-surface-2 sticky top-0 z-10 flex items-center pr-1.5 focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-accent"
      :class="expanded && 'border-b border-line'"
    >
      <button
        ref="button"
        type="button"
        class="flex flex-1 items-center gap-2 min-w-0 px-2.5 py-1.5 text-left font-semibold hover:bg-surface-2 focus:outline-none"
        :data-cursor-key="'header:' + id"
        @click="$emit('toggle')"
      >
        <span class="w-2.5 text-muted">{{ expanded ? "▾" : "▸" }}</span>
        <span class="truncate">{{ label }}</span>
        <span
          class="ml-auto font-normal text-muted"
          :class="total > 0 ? 'section-count' : ''"
          >{{ total ? `${filled}/${total}` : "" }}</span
        >
        <BaseBadge v-if="errors" variant="error">{{ errors }}</BaseBadge>
        <BaseBadge v-if="warnings" variant="warn">{{ warnings }}</BaseBadge>
        <BaseBadge v-if="highlightDiff && diffs" variant="diff">{{
          diffs
        }}</BaseBadge>
      </button>
      <!-- Always rendered, even with no presets: its "Create new from current" entry is how a
           section's first preset gets authored. -->
      <PresetMenu
        :section-id="id"
        :presets="presets"
        @apply="(preset) => $emit('apply-preset', preset)"
        @create="$emit('create-preset')"
        @update="(preset) => $emit('update-preset', preset)"
      />
      <SectionCopyMenu
        v-if="otherBuilds.length"
        :section-id="id"
        :other-builds="otherBuilds"
        @copy="(fromId) => $emit('copy', fromId)"
      />
      <SectionClearButton :section-id="id" @clear="$emit('clear')" />
    </div>

    <div v-if="expanded" class="bg-surface pb-2 pt-1">
      <template v-for="slot in slots" :key="slot.id">
        <slot :slot-def="slot" />
      </template>
    </div>
  </section>
</template>
