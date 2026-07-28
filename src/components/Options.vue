<script setup lang="ts">
// The build-context fields that are rarely touched mid-session: class, role, damage type,
// magnitude and the 3 forte picks. Rendered inside a collapsible "Options" section ahead of
// Gear (SlotList.vue), so they no longer eat top-bar width every session -- see
// QuickOptions.vue for the 5 toggles + combat type + duration + location that stayed visible.
//
// Not called "advanced options": class is a basic, load-bearing choice, just an infrequently
// changed one. The name describes how often it's touched, not how simple it is.
import { computed } from 'vue';
import ComboBox from './ComboBox.vue';
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

const props = defineProps<{ context: BuildContext }>();
const emit = defineEmits<{
  set: [key: string, value: string | number | boolean];
  'set-forte': [slot: string, value: string];
}>();

const schema = NW_SCHEMA.context;

const title = (value: string) => titleCase(value);
// Roles carry their own display label in the schema ("DPS", not "Dps").
const roleLabel = (value: string) => NW_SCHEMA.roles[value]?.label ?? titleCase(value);

const classOptions = computed(() => schema.classes.map((value: string) => ({ value, label: title(value) })));
const roleOptions = computed(() => schema.roles.map((value: string) => ({ value, label: roleLabel(value) })));
const damageTypeOptions = computed(() => schema.damageTypes.map((value: string) => ({ value, label: title(value) })));
const forteOptions = computed(() => [{ value: '', label: '— none —' },
  ...FORTE_STATS.map((key) => ({ value: key, label: statLabel(key) }))]);

function onMagnitude(event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  emit('set', 'magnitude', Number.isFinite(value) ? value : 0);
}
</script>

<template>
  <div class="options">
    <div class="options-group">
      <div class="field">
        <span class="field-label">Class</span>
        <ComboBox :model-value="context.class" :options="classOptions"
                  @update:model-value="$emit('set', 'class', $event)" />
      </div>

      <div class="field">
        <span class="field-label">Role</span>
        <ComboBox :model-value="context.role" :options="roleOptions"
                  @update:model-value="$emit('set', 'role', $event)" />
      </div>

      <div class="field">
        <span class="field-label">Damage type</span>
        <ComboBox :model-value="context.damageType" :options="damageTypeOptions"
                  @update:model-value="$emit('set', 'damageType', $event)" />
      </div>

      <label class="field">
        <span class="field-label">Magnitude</span>
        <input class="num-input num-input--wide" type="number" min="0" step="1"
               :value="context.magnitude" @input="onMagnitude">
      </label>
    </div>

    <div class="options-group">
      <div v-for="slot in FORTE_SLOTS" :key="slot.key" class="field">
        <span class="field-label">{{ slot.label }} <span class="hint">{{ slot.share }}</span></span>
        <ComboBox :model-value="(context.forte as Record<string, string | undefined>)?.[slot.key] ?? ''" :options="forteOptions"
                  @update:model-value="$emit('set-forte', slot.key, $event)" />
      </div>

      <label class="check" title="Round each forte share to 2 decimals, as M32+ does">
        <input type="checkbox" :checked="!!context.m32Forte"
               @change="$emit('set', 'm32Forte', ($event.target as HTMLInputElement).checked)">
        <span>M32 Forte</span>
      </label>
    </div>
  </div>
</template>
