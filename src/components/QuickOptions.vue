<script setup lang="ts">
// Compact "quick options" panel: the 5 toggles plus combat type, duration and location, laid
// out as one small vertical block instead of a wrapping horizontal bar -- matching the sheet's
// own quick-options widget (a column of label/value rows), which is what this replaces.
//
// Everything else that used to live in the top bar (class, role, damage type, magnitude, forte)
// is rarely changed mid-session, so it moved to a collapsible section ahead of Gear
// (SlotList.vue's `AdvancedOptions` section) instead of eating width here.
import { computed } from 'vue';
import ComboBox from './ui/ComboBox.vue';
import { NW_SCHEMA } from '../data';
import { titleCase } from '../format';
import * as library from '../stores/library';
import * as compare from '../stores/compare';
import * as buildEditor from '../stores/buildEditor';
import Checkbox from './ui/Checkbox.vue';

// Display order and labels are UI-only -- data/schema.json keeps its own order untouched.
// The sheet's quick-options widget lists Consumables/Party/Combat/Other procs/Artifact call,
// in that order, and calls "procs" "Other procs".
const TOGGLE_ORDER = ['consumables', 'party', 'combat', 'procs', 'artifactCall'];
const TOGGLE_LABELS: Record<string, string> = { procs: 'Other procs', artifactCall: 'Artifact call' };

// combatTypes as the sheet phrased them ("Single Target"), not a raw title-case of the key.
const TYPE_LABELS: Record<string, string> = { single: 'Single Target', aoe: 'AoE', mixed: 'Mixed' };

const context = computed(() => library.build.value.context);
const compareContext = computed(() => compare.compareBuild.value?.context ?? null);
const compareName = computed(() => compare.compareBuild.value?.name ?? '');
const highlightDiff = computed(() => library.build.value.compare.highlight);

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
  buildEditor.setContext('duration', Number.isFinite(value) ? Math.max(value, 0) : 0);
}

function toggleDiffers(name: string) {
  if (!highlightDiff.value || !compareContext.value) return false;
  return !!context.value.toggles?.[name] !== !!compareContext.value.toggles?.[name];
}

function fieldDiffers(key: 'combatType' | 'location' | 'duration') {
  if (!highlightDiff.value || !compareContext.value) return false;
  return context.value[key] !== compareContext.value[key];
}

const typeLabel = (value: string) => TYPE_LABELS[value] ?? titleCase(value);

/** The hover tooltip for a differing field -- the label itself just goes bold/dotted/coloured
 * (see `.field-diff` below), so this is the only place the compare build's actual value shows. */
function toggleDiffTitle(name: string) {
  const other = compareContext.value;
  if (!other) return undefined;
  return `${compareName.value}: ${other.toggles?.[name] ? 'on' : 'off'}`;
}

function diffTitle(key: 'combatType' | 'location' | 'duration') {
  const other = compareContext.value;
  if (!other) return undefined;
  switch (key) {
    case 'combatType': return `${compareName.value}: ${typeLabel(other.combatType)}`;
    case 'location': return `${compareName.value}: ${titleCase(other.location)}`;
    case 'duration': return `${compareName.value}: ${other.duration}s`;
    default: return undefined;
  }
}
</script>

<template>
  <div class="flex flex-1 flex-wrap items-center gap-x-4 gap-y-1.5 rounded-md border border-line px-2.5 py-1.5">
    <Checkbox v-for="toggle in orderedToggles" :key="toggle.name"
      :model-value="!!context.toggles?.[toggle.name]"
      @update:model-value="v => buildEditor.setToggle(toggle.name, v)"
    >
      <span :class="toggleDiffers(toggle.name) ? 'font-bold text-diff' : ''"
            :title="toggleDiffers(toggle.name) ? toggleDiffTitle(toggle.name) : undefined">
        {{ toggle.label }}<template v-if="toggleDiffers(toggle.name)"> ●</template>
      </span>
    </Checkbox>

    <span class="h-4 w-px bg-line"></span>

    <div class="flex items-center gap-1.5 whitespace-nowrap text-sm">
      <span :class="fieldDiffers('combatType') ? 'cursor-help font-bold text-diff' : ''"
            :title="fieldDiffers('combatType') ? diffTitle('combatType') : undefined">Type<template v-if="fieldDiffers('combatType')"> ●</template></span>
      <ComboBox class="w-36" :model-value="context.combatType"
                :options="typeOptions" @update:model-value="buildEditor.setContext('combatType', $event)" />
    </div>

    <div class="flex items-center gap-1.5 whitespace-nowrap text-sm">
      <span :class="fieldDiffers('location') ? 'cursor-help font-bold text-diff' : ''"
            :title="fieldDiffers('location') ? diffTitle('location') : undefined">Location<template v-if="fieldDiffers('location')"> ●</template></span>
      <ComboBox class="w-36" :model-value="context.location"
                :options="locationOptions" @update:model-value="buildEditor.setContext('location', $event)" />
    </div>

    <div class="flex items-center gap-1.5 whitespace-nowrap text-sm">
      <span :class="fieldDiffers('duration') ? 'cursor-help font-bold text-diff' : ''"
            :title="fieldDiffers('duration') ? diffTitle('duration') : undefined">Duration (s)<template v-if="fieldDiffers('duration')"> ●</template></span>
      <input class="w-14 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
             type="number" min="0" step="1" :value="context.duration" @input="onDuration">
      <div class="flex gap-0.5">
        <button v-for="preset in schema.durationPresets" :key="preset" type="button"
                class="rounded-md border px-1.5 py-0.5 text-sm"
                :class="Number(context.duration) === preset ? 'border-accent bg-accent-soft text-text' : 'border-line bg-surface-2 text-muted'"
                @click="buildEditor.setContext('duration', preset)">{{ preset }}s</button>
      </div>
    </div>
  </div>
</template>
