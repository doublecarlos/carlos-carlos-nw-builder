<script setup lang="ts">
// Hover card for a stat row in StatPanel.vue: which items/bonuses/pipeline stages fed the
// number on screen. Its rows are the shared `StatRows`, rendered once for the whole panel and
// refilled per row, not once per row.
//
// Previewed by hovering the row's info button and opened pinned by clicking it
// (useStatSourcePopover). The header's pin button pins a previewed card, then closes it.
import { computed } from "vue";
import { signedStat } from "../../lib/format";
import BaseCard from "../ui/BaseCard.vue";
import BaseCardHeader from "../ui/BaseCardHeader.vue";
import BaseCardBody from "../ui/BaseCardBody.vue";
import PinButton from "../ui/PinButton.vue";
import StatRows from "./StatRows.vue";
import type { StatRow } from "./StatRows.vue";
import type { StatSourceSection } from "../../engine/stat-sources";
import type { Db } from "../../types";

const props = defineProps<{
  label: string;
  sections: StatSourceSection[];
  /** Resolves a source's item to its quality, for tinting its line. */
  db: Db;
  pinned: boolean;
}>();

const emit = defineEmits<{
  pin: [];
  close: [];
  "go-to-slot": [slotId: string];
}>();

/** One row per source. A source with a slot becomes the button that jumps to it. */
const sectionRows = computed(() =>
  props.sections.map((section) => ({
    key: section.key,
    title: section.title,
    multiplicative: section.multiplicative,
    rows: section.sources.map((source, index): StatRow => ({
      key: `${source.slotId ?? ""}:${source.name}:${index}`,
      label: source.name,
      value: signedStat(section.key, source.value),
      select: source.slotId,
      quality: source.itemId && props.db.get(source.itemId)?.quality,
    })),
  })),
);
</script>

<template>
  <BaseCard class="statcard" data-testid="stat-card">
    <BaseCardHeader sticky class="flex">
      <span
        class="statcard-title font-semibold flex-1"
        data-testid="stat-card-title"
        >{{ label }}</span
      >
      <PinButton
        :pinned="pinned"
        class="-my-1 -mr-1"
        @pin="emit('pin')"
        @close="emit('close')"
      />
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
          v-if="section.multiplicative"
          class="statcard-note py-0.5 text-muted"
          data-testid="stat-card-multiplicative"
        >
          Rows multiply: (1 + a) × (1 + b) × … − 1
        </div>
        <div
          v-if="i < sectionRows.length - 1"
          class="mt-1.5 border-t border-line"
        ></div>
      </template>
    </BaseCardBody>
  </BaseCard>
</template>
