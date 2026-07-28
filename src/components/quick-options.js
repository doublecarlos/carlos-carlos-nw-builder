// Compact "quick options" panel: the 5 toggles plus combat type, duration and location, laid
// out as one small vertical block instead of a wrapping horizontal bar -- matching the sheet's
// own quick-options widget (a column of label/value rows), which is what this replaces.
//
// Everything else that used to live in the top bar (class, role, damage type, magnitude, forte)
// is rarely changed mid-session, so it moved to a collapsible section ahead of Gear
// (slot-list.js's `AdvancedOptions` section) instead of eating width here.

window.NW = window.NW ?? {};
window.NW.components = window.NW.components ?? {};

window.NW.components.QuickOptions = (() => {
  'use strict';

  // Display order and labels are UI-only -- `data/schema.js` keeps its own order untouched.
  // The sheet's quick-options widget lists Consumables/Party/Combat/Other procs/Artifact call,
  // in that order, and calls "procs" "Other procs".
  const TOGGLE_ORDER = ['consumables', 'party', 'combat', 'procs', 'artifactCall'];
  const TOGGLE_LABELS = { procs: 'Other procs', artifactCall: 'Artifact call' };

  // combatTypes as the sheet phrased them ("Single Target"), not a raw title-case of the key.
  const TYPE_LABELS = { single: 'Single Target', aoe: 'AoE', mixed: 'Mixed' };

  return {
    name: 'QuickOptions',

    components: {
      ComboBox: window.NW.components.ComboBox,
    },

    props: {
      context: { type: Object, required: true },
    },

    emits: ['set', 'set-toggle'],

    data: () => ({ schema: window.NW_SCHEMA.context }),

    computed: {
      orderedToggles() {
        return TOGGLE_ORDER
          .filter((name) => this.schema.toggles.includes(name))
          .map((name) => ({ name, label: TOGGLE_LABELS[name] ?? this.title(name) }));
      },

      typeOptions() {
        return this.schema.combatTypes
          .map((value) => ({ value, label: TYPE_LABELS[value] ?? this.title(value) }));
      },

      locationOptions() {
        return this.schema.locations.map((value) => ({ value, label: this.title(value) }));
      },
    },

    methods: {
      title: (value) => window.NW.format.titleCase(value),

      /** Free number of seconds; blank and nonsense both read as 0 rather than NaN. */
      onDuration(event) {
        const value = Number(event.target.value);
        this.$emit('set', 'duration', Number.isFinite(value) ? Math.max(value, 0) : 0);
      },
    },

    template: `
      <div class="quickopts">
        <label v-for="toggle in orderedToggles" :key="toggle.name" class="quickopts-row">
          <input type="checkbox" :checked="!!context.toggles?.[toggle.name]"
                 @change="$emit('set-toggle', toggle.name, $event.target.checked)">
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
    `,
  };
})();
