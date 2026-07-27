// The build-context fields that are rarely touched mid-session: class, role, damage type,
// magnitude and the 3 forte picks. Rendered inside a collapsible "Options" section ahead of
// Gear (slot-list.js), so they no longer eat top-bar width every session -- see
// quick-options.js for the 5 toggles + combat type + duration + location that stayed visible.
//
// Not called "advanced options": class is a basic, load-bearing choice, just an infrequently
// changed one. The name describes how often it's touched, not how simple it is.

window.NW = window.NW ?? {};
window.NW.components = window.NW.components ?? {};

window.NW.components.Options = (() => {
  'use strict';

  // The stats the sheet's `option_forte` dropdown offered. This lives in the UI rather than in
  // data/schema.js because the engine accepts any stat key here (see engine.js stage 6) -- the
  // restriction is the game's, and it is a presentation concern until someone says otherwise.
  const FORTE_STATS = ['power_p', 'sev_p', 'strike_p', 'acc_p', 'ca_p', 'defense_p',
    'awareness_p', 'crit_avoid_p', 'deflect_p', 'deflect_sev_p', 'mana_regen'];

  const FORTE_SLOTS = [
    { key: 'primary', label: 'Forte 1', share: '½' },
    { key: 'secondaryA', label: 'Forte 2A', share: '¼' },
    { key: 'secondaryB', label: 'Forte 2B', share: '¼' },
  ];

  return {
    name: 'Options',

    components: {
      ComboBox: window.NW.components.ComboBox,
    },

    props: {
      context: { type: Object, required: true },
    },

    emits: ['set', 'set-forte'],

    data: () => ({
      schema: window.NW_SCHEMA.context,
      forteStats: FORTE_STATS,
      forteSlots: FORTE_SLOTS,
    }),

    computed: {
      classOptions() {
        return this.schema.classes.map((value) => ({ value, label: this.title(value) }));
      },
      roleOptions() {
        return this.schema.roles.map((value) => ({ value, label: this.roleLabel(value) }));
      },
      damageTypeOptions() {
        return this.schema.damageTypes.map((value) => ({ value, label: this.title(value) }));
      },
      forteOptions() {
        return [{ value: '', label: '— none —' },
          ...this.forteStats.map((key) => ({ value: key, label: this.statLabel(key) }))];
      },
    },

    methods: {
      title: (value) => window.NW.format.titleCase(value),
      statLabel: (key) => window.NW.format.label(key),

      // Roles carry their own display label in the schema ("DPS", not "Dps").
      roleLabel: (value) => window.NW_SCHEMA.roles[value]?.label
        ?? window.NW.format.titleCase(value),

      onMagnitude(event) {
        const value = Number(event.target.value);
        this.$emit('set', 'magnitude', Number.isFinite(value) ? value : 0);
      },
    },

    template: `
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
          <div v-for="slot in forteSlots" :key="slot.key" class="field">
            <span class="field-label">{{ slot.label }} <span class="hint">{{ slot.share }}</span></span>
            <ComboBox :model-value="context.forte?.[slot.key] ?? ''" :options="forteOptions"
                      @update:model-value="$emit('set-forte', slot.key, $event)" />
          </div>

          <label class="check" title="Round each forte share to 2 decimals, as M32+ does">
            <input type="checkbox" :checked="!!context.m32Forte"
                   @change="$emit('set', 'm32Forte', $event.target.checked)">
            <span>M32 Forte</span>
          </label>
        </div>
      </div>
    `,
  };
})();
