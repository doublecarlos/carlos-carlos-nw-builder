<script setup lang="ts">
// Click-triggered popover for a stat row in StatPanel.vue: which items/bonuses/pipeline
// stages fed the number on screen. Its rows are the shared `StatRows`, rendered
// once for the whole panel and refilled per click, not once per row.
//
// Opened by a click on the row's own circle-alert button, closed by the × here or by
// StatPanel.vue's click-outside handler. Click trigger only, on purpose: in a dense stat
// table the pointer's path to a row ran through other rows' trigger buttons, so hover-to-open
// kept swapping the card's contents out from under the pointer.
import { computed } from "vue";
import { signedStat } from "../../lib/format";
import BaseCard from "../ui/BaseCard.vue";
import BaseCardHeader from "../ui/BaseCardHeader.vue";
import BaseCardBody from "../ui/BaseCardBody.vue";
import StatRows from "./StatRows.vue";
import type { StatRow } from "./StatRows.vue";
import type { StatSourceSection } from "../../engine/stat-sources";
import { useEscapeToClose } from "../../composables/useEscapeToClose";

const props = defineProps<{
  label: string;
  sections: StatSourceSection[];
}>();

const emit = defineEmits<{ close: []; "go-to-slot": [slotId: string] }>();

useEscapeToClose(() => emit("close"));

/** One row per source. A source with a slot becomes the button that jumps to it. */
const sectionRows = computed(() =>
  props.sections.map((section) => ({
    key: section.key,
    title: section.title,
    rows: section.sources.map((source, index): StatRow => ({
      key: `${source.slotId ?? ""}:${source.name}:${index}`,
      label: source.name,
      value: signedStat(section.key, source.value),
      select: source.slotId,
    })),
  })),
);

// Width (`w-64` = 256px) and max-height (`max-h-96` = 384px) are read back by StatPanel.vue's
// own positioning logic (`CARD_W`) -- keep them in step. `.statcard` on the root is a bare JS
// hook for that same positioning code (`closest('.statcard')`), not a style.
</script>

<template>
  <BaseCard class="statcard" data-testid="stat-card">
    <BaseCardHeader sticky class="flex">
      <span
        class="statcard-title font-semibold flex-1"
        data-testid="stat-card-title"
        >{{ label }}</span
      >
      <button
        type="button"
        class="statcard-close flex-none pl-2 leading-none text-muted hover:text-text"
        aria-label="Close"
        data-testid="stat-card-close"
        @click="$emit('close')"
      >
        ×
      </button>
    </BaseCardHeader>
    <BaseCardBody>
      <template v-for="(section, i) in sectionRows" :key="section.key">
        <div
          v-if="sectionRows.length > 1"
          class="statcard-section mt-1.5 uppercase tracking-wide text-muted"
          data-testid="stat-card-section"
        >
          {{ section.title }}
        </div>
        <StatRows
          v-if="section.rows.length"
          class="statcard-rows"
          data-testid="stat-card-rows"
          :rows="section.rows"
          row-testid="stat-card-row"
          @select="emit('go-to-slot', $event)"
        />
        <div
          v-else
          class="statcard-empty py-0.5 text-muted"
          data-testid="stat-card-empty"
        >
          no contributing sources
        </div>
        <div
          v-if="i < sectionRows.length - 1"
          class="mt-1.5 border-t border-line"
        ></div>
      </template>
    </BaseCardBody>
  </BaseCard>
</template>
