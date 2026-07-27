// The top bar: everything that used to be a pseudo-item row in the sheet's Options section
// and is now build *context* (plan §2.1, handoff §6 "Options are context, not slots").
//
// Duration is a free number of seconds with quick presets, NOT a four-value dropdown. That is
// the whole point of the context redesign: 85 s is expressible now.

window.NW = window.NW ?? {};
window.NW.components = window.NW.components ?? {};

window.NW.components.OptionsBar = (() => {
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
    name: 'OptionsBar',

    props: {
      context: { type: Object, required: true },
    },

    emits: ['set', 'set-toggle', 'set-forte'],

    data: () => ({
      schema: window.NW_SCHEMA.context,
      forteStats: FORTE_STATS,
      forteSlots: FORTE_SLOTS,
    }),

    methods: {
      title: (value) => window.NW.format.titleCase(value),
      statLabel: (key) => window.NW.format.label(key),

      // Roles carry their own display label in the schema ("DPS", not "Dps").
      roleLabel: (value) => window.NW_SCHEMA.roles[value]?.label
        ?? window.NW.format.titleCase(value),

      /** Free number of seconds; blank and nonsense both read as 0 rather than NaN. */
      onDuration(event) {
        const value = Number(event.target.value);
        this.$emit('set', 'duration', Number.isFinite(value) ? Math.max(value, 0) : 0);
      },

      onMagnitude(event) {
        const value = Number(event.target.value);
        this.$emit('set', 'magnitude', Number.isFinite(value) ? value : 0);
      },
    },

    template: `
      <div class="options">
        <div class="options-group">
          <label class="field">
            <span class="field-label">Class</span>
            <select :value="context.class" @change="$emit('set', 'class', $event.target.value)">
              <option v-for="value in schema.classes" :key="value" :value="value">
                {{ title(value) }}
              </option>
            </select>
          </label>

          <label class="field">
            <span class="field-label">Role</span>
            <select :value="context.role" @change="$emit('set', 'role', $event.target.value)">
              <option v-for="value in schema.roles" :key="value" :value="value">
                {{ roleLabel(value) }}
              </option>
            </select>
          </label>

          <label class="field">
            <span class="field-label">Combat</span>
            <select :value="context.combatType"
                    @change="$emit('set', 'combatType', $event.target.value)">
              <option v-for="value in schema.combatTypes" :key="value" :value="value">
                {{ title(value) }}
              </option>
            </select>
          </label>

          <label class="field">
            <span class="field-label">Location</span>
            <select :value="context.location"
                    @change="$emit('set', 'location', $event.target.value)">
              <option v-for="value in schema.locations" :key="value" :value="value">
                {{ title(value) }}
              </option>
            </select>
          </label>

          <label class="field">
            <span class="field-label">Damage type</span>
            <select :value="context.damageType"
                    @change="$emit('set', 'damageType', $event.target.value)">
              <option v-for="value in schema.damageTypes" :key="value" :value="value">
                {{ title(value) }}
              </option>
            </select>
          </label>

          <label class="field">
            <span class="field-label">Magnitude</span>
            <input class="num-input num-input--wide" type="number" min="0" step="1"
                   :value="context.magnitude" @input="onMagnitude">
          </label>
        </div>

        <div class="options-group">
          <label class="field">
            <span class="field-label">Duration (s)</span>
            <input class="num-input" type="number" min="0" step="1"
                   :value="context.duration" @input="onDuration">
          </label>
          <div class="presets">
            <button v-for="preset in schema.durationPresets" :key="preset" type="button"
                    class="preset" :class="{ 'is-on': Number(context.duration) === preset }"
                    @click="$emit('set', 'duration', preset)">{{ preset }}s</button>
          </div>

          <label v-for="slot in forteSlots" :key="slot.key" class="field">
            <span class="field-label">{{ slot.label }} <span class="hint">{{ slot.share }}</span></span>
            <select :value="context.forte?.[slot.key] ?? ''"
                    @change="$emit('set-forte', slot.key, $event.target.value)">
              <option value="">— none —</option>
              <option v-for="key in forteStats" :key="key" :value="key">{{ statLabel(key) }}</option>
            </select>
          </label>
        </div>

        <div class="options-group options-group--toggles">
          <label v-for="name in schema.toggles" :key="name" class="check">
            <input type="checkbox" :checked="!!context.toggles?.[name]"
                   @change="$emit('set-toggle', name, $event.target.checked)">
            <span>{{ title(name) }}</span>
          </label>

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
