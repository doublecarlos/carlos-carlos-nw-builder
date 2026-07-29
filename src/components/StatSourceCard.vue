<script setup lang="ts">
// Click-triggered popover for a stat row in StatPanel.vue: which items/bonuses/pipeline
// stages fed the number on screen. Same shape as ItemCard.vue's own hover card (one source
// per line, a bottom-border separator between lines) -- rendered once for the whole panel,
// moved and refilled per click, not once per row.
//
// Opened by a click on the row's own circle-alert button, closed by the × here, or by
// StatPanel.vue's own document-level "click outside" handler -- there is no hover/mouseleave
// behaviour at all, on purpose: a dense stat table put the pointer's path to the card through
// other rows' own trigger buttons often enough that hover-to-open kept swapping the card's
// contents out from under the pointer before it arrived.
import { signedStat } from '../format';
import type { StatSourceSection } from '../stat-sources';

defineProps<{
  label: string;
  sections: StatSourceSection[];
}>();

defineEmits<{ close: [] }>();
</script>

<template>
  <div class="statcard">
    <div class="statcard-head">
      <span class="statcard-title">{{ label }}</span>
      <button type="button" class="statcard-close" title="Close" @click="$emit('close')">×</button>
    </div>
    <template v-for="(section, i) in sections" :key="section.key">
      <div v-if="sections.length > 1" class="statcard-section">{{ section.title }}</div>
      <div v-if="section.sources.length" class="statcard-rows">
        <div v-for="src in section.sources" :key="src.name" class="statcard-row">
          <span>{{ src.name }}</span>
          <span class="num">{{ signedStat(section.key, src.value) }}</span>
        </div>
      </div>
      <div v-else class="dim statcard-empty">no contributing sources</div>
      <div v-if="i < sections.length - 1" class="statcard-divider"></div>
    </template>
  </div>
</template>

<style scoped>
.statcard {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: 0 10px 30px rgba(0, 0, 0, .22);
  /* Width/max-height read back by StatPanel.vue's own positioning logic -- keep in step with
   * the constant there. */
  width: 260px;
  max-width: calc(100vw - 20px);
  max-height: 380px;
  overflow-y: auto;
  /* Without this, a wheel scroll that reaches the card's own scroll limit chains onto the
   * page underneath -- see ItemCard.vue's own identical comment. */
  overscroll-behavior: contain;
  padding: 9px 11px;
  position: fixed;
  z-index: 40;
}

.statcard-head {
  align-items: baseline;
  background: var(--surface);
  display: flex;
  gap: 8px;
  justify-content: space-between;
  /* Pinned so a long source list scrolls under the title/close button instead of past them. */
  position: sticky;
  top: -9px;
  margin: -9px -11px 0;
  padding: 9px 11px 4px;
}
.statcard-title { font-weight: 600; }
.statcard-close {
  background: none;
  border: 0;
  color: var(--muted);
  cursor: pointer;
  flex: none;
  font-size: 1.1rem;
  line-height: 1;
  padding: 0 0 0 8px;
}
.statcard-close:hover { color: var(--text); }

.statcard-section {
  color: var(--muted);
  font-size: 1rem;
  letter-spacing: .05em;
  margin-top: 6px;
  text-transform: uppercase;
}

.statcard-rows { display: flex; flex-direction: column; }
.statcard-row {
  border-bottom: 1px solid var(--line);
  display: flex;
  font-size: 1rem;
  gap: 8px;
  justify-content: space-between;
  padding: 3px 0;
}
.statcard-row:last-child { border-bottom: none; }
.statcard-row .num { font-variant-numeric: tabular-nums; }

.statcard-empty { font-size: 1rem; padding: 3px 0; }

.statcard-divider { border-top: 1px solid var(--line); margin-top: 6px; }
</style>
