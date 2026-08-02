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
import type { Slot } from "../../types";

defineProps<{
  id: string;
  label: string;
  slots: Slot[];
  filled: number;
  total: number;
  errors: number;
  diffs: number;
  expanded: boolean;
  isCursor: boolean;
  highlightDiff: boolean;
  otherBuilds: { value: string; label: string }[];
}>();

defineEmits<{
  toggle: [];
  copy: [fromId: string];
}>();
</script>

<template>
  <section class="rounded-md border border-line">
    <div class="bg-surface-2 flex items-center">
      <button
        type="button"
        class="flex flex-1 items-center gap-2 min-w-0 px-2.5 py-1.5 text-left font-semibold hover:bg-surface-2"
        :class="
          isCursor && 'is-cursor outline-2 -outline-offset-1 outline-accent'
        "
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
        <BaseBadge v-if="highlightDiff && diffs" variant="diff">{{
          diffs
        }}</BaseBadge>
      </button>
      <SectionCopyMenu
        v-if="otherBuilds.length"
        :section-id="id"
        :other-builds="otherBuilds"
        @copy="(fromId) => $emit('copy', fromId)"
      />
    </div>

    <div
      v-if="expanded"
      class="bg-surface border-t border-line px-2.5 pb-2 pt-1"
    >
      <slot v-for="slot in slots" :key="slot.id" :slot-def="slot" />
    </div>
  </section>
</template>
