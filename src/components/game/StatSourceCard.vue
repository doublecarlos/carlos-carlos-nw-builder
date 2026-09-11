<script setup lang="ts">
// Click-triggered popover for a stat row in StatPanel.vue: which items/bonuses/pipeline
// stages fed the number on screen. Same shape as ItemCard.vue's own hover card (one source
// per line, a bottom-border separator between lines) -- rendered once for the whole panel,
// moved and refilled per click, not once per row.
//
// Opened by a click on the row's own circle-alert button, closed by the × here, or by
// StatPanel.vue's own document-level "click outside" handler -- there is no hover/mouseleave
// behavior at all, on purpose: a dense stat table put the pointer's path to the card through
// other rows' own trigger buttons often enough that hover-to-open kept swapping the card's
// contents out from under the pointer before it arrived.
import { signedStat } from "../../lib/format";
import BaseCard from "../ui/BaseCard.vue";
import BaseCardHeader from "../ui/BaseCardHeader.vue";
import BaseCardBody from "../ui/BaseCardBody.vue";
import type { StatSourceSection } from "../../engine/stat-sources";
import { useEscapeToClose } from "../../composables/useEscapeToClose";

defineProps<{
  label: string;
  sections: StatSourceSection[];
}>();

const emit = defineEmits<{ close: []; "go-to-slot": [slotId: string] }>();

useEscapeToClose(() => emit("close"));

// Width (`w-64` = 256px) and max-height (`max-h-96` = 384px) are read back by StatPanel.vue's
// own positioning logic (`CARD_W`) -- keep them in step. `.statcard` on the root is a bare JS
// hook for that same positioning code (`closest('.statcard')`), not a style.

// A source with a slot renders its whole row as the button that jumps there; one without
// stays a plain div. Both share this layout, hover included, so the two read as the same
// kind of line.
const ROW_CLASS =
  "statcard-row flex justify-between gap-2 border-b border-line py-0.5 last:border-b-0 hover:shadow-[inset_0_1px_0_var(--color-accent),inset_0_-1px_0_var(--color-accent)]";
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
      <template v-for="(section, i) in sections" :key="section.key">
        <div
          v-if="sections.length > 1"
          class="statcard-section mt-1.5 uppercase tracking-wide text-muted"
          data-testid="stat-card-section"
        >
          {{ section.title }}
        </div>
        <div
          v-if="section.sources.length"
          class="statcard-rows flex flex-col"
          data-testid="stat-card-rows"
        >
          <template
            v-for="(src, j) in section.sources"
            :key="`${src.slotId ?? ''}:${src.name}:${j}`"
          >
            <button
              v-if="src.slotId"
              type="button"
              :class="ROW_CLASS"
              class="w-full cursor-pointer bg-transparent text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
              data-testid="stat-card-row"
              @click="emit('go-to-slot', src.slotId)"
            >
              <span class="min-w-0">{{ src.name }}</span>
              <span class="flex-none tabular-nums">{{
                signedStat(section.key, src.value)
              }}</span>
            </button>
            <div v-else :class="ROW_CLASS" data-testid="stat-card-row">
              <span class="min-w-0">{{ src.name }}</span>
              <span class="flex-none tabular-nums">{{
                signedStat(section.key, src.value)
              }}</span>
            </div>
          </template>
        </div>
        <div
          v-else
          class="statcard-empty py-0.5 text-muted"
          data-testid="stat-card-empty"
        >
          no contributing sources
        </div>
        <div
          v-if="i < sections.length - 1"
          class="mt-1.5 border-t border-line"
        ></div>
      </template>
    </BaseCardBody>
  </BaseCard>
</template>
