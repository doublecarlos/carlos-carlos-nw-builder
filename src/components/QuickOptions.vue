<script setup lang="ts">
// Compact "quick options" panel: the 5 toggles plus combat type, duration and location, laid
// out as one small vertical block instead of a wrapping horizontal bar -- matching the sheet's
// own quick-options widget (a column of label/value rows), which is what this replaces.
//
// Everything else that used to live in the top bar (class, role, damage type, magnitude, forte)
// is rarely changed mid-session, so it moved to a collapsible section ahead of Gear
// (SlotList.vue's `AdvancedOptions` section) instead of eating width here.
import { computed } from 'vue';
import ComboBox from './ComboBox.vue';
import { NW_SCHEMA } from '../data';
import { titleCase } from '../format';
import type { BuildContext } from '../types';

// Display order and labels are UI-only -- data/schema.json keeps its own order untouched.
// The sheet's quick-options widget lists Consumables/Party/Combat/Other procs/Artifact call,
// in that order, and calls "procs" "Other procs".
const TOGGLE_ORDER = ['consumables', 'party', 'combat', 'procs', 'artifactCall'];
const TOGGLE_LABELS: Record<string, string> = { procs: 'Other procs', artifactCall: 'Artifact call' };

// combatTypes as the sheet phrased them ("Single Target"), not a raw title-case of the key.
const TYPE_LABELS: Record<string, string> = { single: 'Single Target', aoe: 'AoE', mixed: 'Mixed' };

const props = defineProps<{ context: BuildContext }>();

const emit = defineEmits<{
  set: [key: string, value: string | number | boolean];
  'set-toggle': [name: string, value: boolean];
}>();

const schema = NW_SCHEMA.context;

const orderedToggles = computed(() => TOGGLE_ORDER
  .filter((name) => schema.toggles.includes(name))
  .map((name) => ({ name, label: TOGGLE_LABELS[name] ?? titleCase(name) })));

const typeOptions = computed(() => schema.combatTypes
  .map((value: string) => ({ value, label: TYPE_LABELS[value] ?? titleCase(value) })));

const locationOptions = computed(() => schema.locations.map((value: string) => ({ value, label: titleCase(value) })));

/** Free number of seconds; blank and nonsense both read as 0 rather than NaN. */
function onDuration(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  emit('set', 'duration', Number.isFinite(value) ? Math.max(value, 0) : 0);
}
</script>

<template>
  <div class="quickopts">
    <label v-for="toggle in orderedToggles" :key="toggle.name" class="quickopts-row">
      <input type="checkbox" :checked="!!context.toggles?.[toggle.name]"
             @change="$emit('set-toggle', toggle.name, ($event.target as HTMLInputElement).checked)">
      <span class="quickopts-label">{{ toggle.label }}</span>
    </label>

    <span class="quickopts-sep"></span>

    <div class="quickopts-row">
      <span class="quickopts-label">Type</span>
      <ComboBox class="quickopts-combo" :model-value="context.combatType"
                :options="typeOptions" @update:model-value="$emit('set', 'combatType', $event)" />
    </div>

    <div class="quickopts-row">
      <span class="quickopts-label">Location</span>
      <ComboBox class="quickopts-combo" :model-value="context.location"
                :options="locationOptions" @update:model-value="$emit('set', 'location', $event)" />
    </div>

    <div class="quickopts-row">
      <span class="quickopts-label">Duration (s)</span>
      <input class="num-input quickopts-num" type="number" min="0" step="1"
             :value="context.duration" @input="onDuration">
      <div class="quickopts-presets">
        <button v-for="preset in schema.durationPresets" :key="preset" type="button"
                class="preset" :class="{ 'is-on': Number(context.duration) === preset }"
                @click="$emit('set', 'duration', preset)">{{ preset }}s</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* A single wrapping row, not a narrow stacked column -- the toggles and the three fields flow
 * across whatever width the top bar has instead of leaving it mostly empty. */
.quickopts {
  align-items: center;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  display: flex;
  flex: 1 1 100%;
  flex-wrap: wrap;
  gap: 6px 18px;
  padding: 6px 10px;
}
.quickopts-row { align-items: center; display: flex; font-size: 1rem; gap: 6px; white-space: nowrap; }
label.quickopts-row { cursor: pointer; }
.quickopts-sep { background: var(--line); height: 18px; width: 1px; }
.quickopts-combo { width: 150px; }
.quickopts-num { text-align: right; width: 60px; }
.quickopts-presets { display: flex; gap: 3px; }

.preset {
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  color: var(--muted);
  cursor: pointer;
  font: inherit;
  font-size: 1rem;
  padding: 3px 6px;
}
.preset.is-on { background: var(--accent-soft); border-color: var(--accent); color: var(--text); }
</style>
