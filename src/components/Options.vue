<script setup lang="ts">
// The build-context fields that are rarely touched mid-session: class, role, damage type,
// magnitude and the 3 forte picks. Rendered inside a collapsible "Options" section ahead of
// Gear (BuildEditor.vue), so they no longer eat top-bar width every session -- see
// QuickOptions.vue for the 5 toggles + combat type + duration + location that stayed visible.
//
// Not called "advanced options": class is a basic, load-bearing choice, just an infrequently
// changed one. The name describes how often it's touched, not how simple it is.
import { computed } from 'vue';
import ComboBox from './ui/ComboBox.vue';
import FormField from './ui/FormField.vue';
import Checkbox from './ui/Checkbox.vue';
import { NW_SCHEMA } from '../data';
import { titleCase, label as statLabel } from '../format';
import type { BuildContext } from '../types';

// The stats the sheet's `option_forte` dropdown offered. This lives in the UI rather than in
// data/schema.json because the engine accepts any stat key here (see engine.ts stage 6) -- the
// restriction is the game's, and it is a presentation concern until someone says otherwise.
const FORTE_STATS = ['power_p', 'sev_p', 'strike_p', 'acc_p', 'ca_p', 'defense_p',
  'awareness_p', 'crit_avoid_p', 'deflect_p', 'deflect_sev_p', 'mana_regen'];

const FORTE_SLOTS = [
  { key: 'primary', label: 'Forte 1', share: '½' },
  { key: 'secondaryA', label: 'Forte 2A', share: '¼' },
  { key: 'secondaryB', label: 'Forte 2B', share: '¼' },
];

const props = withDefaults(defineProps<{
  context: BuildContext;
  // The quick-compare build's own context (App.vue's `compareBuild.context`, forwarded
  // through BuildEditor.vue) -- `null` means "not comparing", same convention as BuildEditor's own
  // `compareBuild` prop. `highlightDiff` mirrors `build.compare.highlight` so this section
  // obeys the same on/off toggle as the slot rows.
  compareContext?: BuildContext | null;
  compareName?: string;
  highlightDiff?: boolean;
}>(), {
  compareContext: null,
  compareName: '',
  highlightDiff: false,
});
const emit = defineEmits<{
  set: [key: string, value: string | number | boolean];
  'set-forte': [slot: string, value: string];
}>();

const schema = NW_SCHEMA.context;

const title = (value: string) => titleCase(value);
// Roles carry their own display label in the schema ("DPS", not "Dps").
const roleLabel = (value: string) => NW_SCHEMA.roles[value]?.label ?? titleCase(value);
const forteLabel = (value: string) => (value ? statLabel(value) : '— none —');

const classOptions = computed(() => schema.classes.map((value: string) => ({ value, label: title(value) })));
const roleOptions = computed(() => schema.roles.map((value: string) => ({ value, label: roleLabel(value) })));
const damageTypeOptions = computed(() => schema.damageTypes.map((value: string) => ({ value, label: title(value) })));
const forteOptions = computed(() => [{ value: '', label: '— none —' },
  ...FORTE_STATS.map((key) => ({ value: key, label: statLabel(key) }))]);

function onMagnitude(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  emit('set', 'magnitude', Number.isFinite(value) ? value : 0);
}

/** A plain top-level context field differing from the compare build's -- `key` narrowed to
 * the fields this component actually renders, not every `BuildContext` key. */
function fieldDiffers(key: 'class' | 'role' | 'damageType' | 'magnitude' | 'm32Forte') {
  if (!props.highlightDiff || !props.compareContext) return false;
  return props.context[key] !== props.compareContext[key];
}

function forteDiffers(slotKey: string) {
  if (!props.highlightDiff || !props.compareContext) return false;
  const mine = (props.context.forte as Record<string, string | undefined>)?.[slotKey] ?? '';
  const theirs = (props.compareContext.forte as Record<string, string | undefined>)?.[slotKey] ?? '';
  return mine !== theirs;
}

/** The hover tooltip for a differing field -- the label itself just goes bold/dotted/coloured
 * (see `.field-diff` below), so this is the only place the compare build's actual value shows. */
function diffTitle(key: 'class' | 'role' | 'damageType' | 'magnitude' | 'm32Forte') {
  const other = props.compareContext;
  if (!other) return undefined;
  switch (key) {
    case 'class': return `${props.compareName}: ${title(other.class)}`;
    case 'role': return `${props.compareName}: ${roleLabel(other.role)}`;
    case 'damageType': return `${props.compareName}: ${title(other.damageType)}`;
    case 'magnitude': return `${props.compareName}: ${other.magnitude}`;
    case 'm32Forte': return `${props.compareName}: ${other.m32Forte ? 'on' : 'off'}`;
    default: return undefined;
  }
}

function forteDiffTitle(slotKey: string) {
  const other = props.compareContext;
  if (!other) return undefined;
  const theirs = (other.forte as Record<string, string | undefined>)?.[slotKey] ?? '';
  return `${props.compareName}: ${forteLabel(theirs)}`;
}
</script>

<template>
  <div class="options flex flex-wrap items-start gap-x-5 gap-y-2.5">
    <div class="flex flex-wrap items-end gap-x-2.5 gap-y-2">
      <FormField>
        <span :class="fieldDiffers('class') ? 'cursor-help font-bold text-diff' : 'text-sm text-muted'"
              :title="fieldDiffers('class') ? diffTitle('class') : undefined">Class<template v-if="fieldDiffers('class')"> ●</template></span>
        <ComboBox :model-value="context.class" :options="classOptions"
                  @update:model-value="$emit('set', 'class', $event)" />
      </FormField>

      <FormField>
        <span :class="fieldDiffers('role') ? 'cursor-help font-bold text-diff' : 'text-sm text-muted'"
              :title="fieldDiffers('role') ? diffTitle('role') : undefined">Role<template v-if="fieldDiffers('role')"> ●</template></span>
        <ComboBox :model-value="context.role" :options="roleOptions"
                  @update:model-value="$emit('set', 'role', $event)" />
      </FormField>

      <FormField>
        <span :class="fieldDiffers('damageType') ? 'cursor-help font-bold text-diff' : 'text-sm text-muted'"
              :title="fieldDiffers('damageType') ? diffTitle('damageType') : undefined">Damage type<template v-if="fieldDiffers('damageType')"> ●</template></span>
        <ComboBox :model-value="context.damageType" :options="damageTypeOptions"
                  @update:model-value="$emit('set', 'damageType', $event)" />
      </FormField>

      <label class="flex min-w-40 flex-col gap-0.5">
        <span :class="fieldDiffers('magnitude') ? 'cursor-help font-bold text-diff' : 'text-sm text-muted'"
              :title="fieldDiffers('magnitude') ? diffTitle('magnitude') : undefined">Magnitude<template v-if="fieldDiffers('magnitude')"> ●</template></span>
        <input class="w-24 rounded-md border border-line bg-surface px-1.5 py-0.5 text-right focus:outline-2 focus:-outline-offset-1 focus:outline-accent"
               type="number" min="0" step="1" :value="context.magnitude" @input="onMagnitude">
      </label>
    </div>

    <div class="flex flex-wrap items-end gap-x-2.5 gap-y-2">
      <FormField v-for="slot in FORTE_SLOTS" :key="slot.key">
        <span :class="forteDiffers(slot.key) ? 'cursor-help font-bold text-diff' : 'text-sm text-muted'"
              :title="forteDiffers(slot.key) ? forteDiffTitle(slot.key) : undefined">
          {{ slot.label }} <span class="text-muted">{{ slot.share }}</span><template v-if="forteDiffers(slot.key)"> ●</template>
        </span>
        <ComboBox :model-value="(context.forte as Record<string, string | undefined>)?.[slot.key] ?? ''" :options="forteOptions"
                  @update:model-value="$emit('set-forte', slot.key, $event)" />
      </FormField>

      <Checkbox :model-value="!!context.m32Forte" @update:model-value="$emit('set', 'm32Forte', $event)">
        <span :class="fieldDiffers('m32Forte') && 'cursor-help font-bold text-diff'"
              :title="fieldDiffers('m32Forte') ? diffTitle('m32Forte') : 'Round each forte share to 2 decimals, as M32+ does'">
          M32 Forte<template v-if="fieldDiffers('m32Forte')"> ●</template>
        </span>
      </Checkbox>
    </div>
  </div>
</template>
