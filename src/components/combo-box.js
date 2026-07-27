// Typeable single-select dropdown over a fixed, small option list -- the same interaction as
// item-picker.js (type to filter, arrow keys, Enter, Escape), stripped of the item-specific
// stat preview. Replaces a native <select> wherever the option list is short and known ahead
// of time (class, role, combat type, location, damage type, forte picks).
//
// Reuses item-picker's `.picker*` CSS classes rather than inventing a second look for the same
// interaction.

window.NW = window.NW ?? {};
window.NW.components = window.NW.components ?? {};

window.NW.components.ComboBox = (() => {
  'use strict';

  const MAX_ROWS = 60;

  return {
    name: 'ComboBox',

    props: {
      modelValue: { type: String, default: '' },
      /** [{ value, label }], in the order they should list. */
      options: { type: Array, required: true },
      placeholder: { type: String, default: '—' },
    },

    emits: ['update:modelValue'],

    data: () => ({ open: false, query: '', highlight: 0 }),

    computed: {
      selected() {
        return this.options.find((option) => option.value === this.modelValue) ?? null;
      },

      filtered() {
        if (!this.open) return [];
        const query = this.query.trim().toLowerCase();
        const list = query
          ? this.options.filter((option) => option.label.toLowerCase().includes(query))
          : this.options;
        return list.slice(0, MAX_ROWS);
      },
    },

    watch: {
      highlight() {
        this.$nextTick(() => {
          this.$refs.list?.querySelector('.is-highlighted')?.scrollIntoView({ block: 'nearest' });
        });
      },
    },

    methods: {
      onFocus() {
        this.open = true;
        this.query = '';
        const current = this.options.findIndex((option) => option.value === this.modelValue);
        this.highlight = Math.max(current, 0);
      },

      onInput(event) {
        this.query = event.target.value;
        this.open = true;
        this.highlight = 0;
      },

      onBlur() {
        this.close();
      },

      close() {
        this.open = false;
        this.query = '';
      },

      /** `blur: false` for the Tab case below -- the browser's own Tab-forward looks at
       * whatever element is currently focused, so blurring here first (before that runs) would
       * make it tab from nowhere instead of continuing from this input. */
      choose(option, { blur = true } = {}) {
        this.$emit('update:modelValue', option.value);
        this.close();
        if (blur) this.$refs.input?.blur();
      },

      /**
       * Enter has no native "move to the next field" behaviour the way Tab does. Only meaningful
       * for a stat-key picker (rendered inside `.stat-row`, one per stat: id/remove buttons, this
       * combo, then the value field) -- elsewhere there's no adjacent value input to jump to, and
       * `row` comes back null so this is a no-op.
       */
      focusStatValue(input) {
        const row = input.closest('.stat-row');
        const value = row?.querySelector('.pct-input, input[type="number"]');
        value?.focus();
      },

      onKeydown(event) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          if (!this.open) {
            this.onFocus();
            return;
          }
          const step = event.key === 'ArrowDown' ? 1 : -1;
          const last = this.filtered.length - 1;
          this.highlight = Math.min(Math.max(this.highlight + step, 0), last);
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          if (this.open && this.filtered[this.highlight]) {
            this.choose(this.filtered[this.highlight]);
            this.focusStatValue(event.target);
          }
          return;
        }
        // Stat-key pickers only (see `focusStatValue`): commit the highlighted stat before the
        // browser's own Tab moves focus to the value field right after this one in the DOM.
        // No preventDefault -- the browser still does the actual tabbing.
        if (event.key === 'Tab' && !event.shiftKey && this.open && this.filtered[this.highlight]
          && event.target.closest('.stat-row')) {
          this.choose(this.filtered[this.highlight], { blur: false });
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          this.close();
          this.$refs.input?.blur();
        }
      },
    },

    template: `
      <div class="picker" :class="{ 'is-open': open }">
        <input
          ref="input"
          class="picker-input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          :value="open ? query : (selected ? selected.label : '')"
          :placeholder="placeholder"
          @focus="onFocus"
          @input="onInput"
          @blur="onBlur"
          @keydown="onKeydown">
        <span class="picker-caret">▾</span>

        <div v-if="open" class="picker-menu" ref="list">
          <div
            v-for="(option, index) in filtered"
            :key="option.value"
            class="picker-row"
            :class="{ 'is-highlighted': highlight === index }"
            @mousedown.prevent="choose(option)"
            @mouseenter="highlight = index">
            <div class="picker-row-head">
              <span class="picker-name">{{ option.label }}</span>
            </div>
          </div>

          <div v-if="!filtered.length" class="picker-row picker-row--none">no match</div>
        </div>
      </div>
    `,
  };
})();

/**
 * The other half of stat-row keyboard nav (see `ComboBox.focusStatValue` above): Tab/Enter on a
 * stat's *value* field jumps to the next stat row's key picker. Plain Tab would land on that
 * row's add/remove icon buttons first -- they sit before the combo box in the DOM -- and Enter
 * has no native "next field" behaviour to begin with, so both are handled the same way here.
 * Shared because the same `.stat-row` markup is built in four places (item-form.js's own stats,
 * and bonus-rows.js's flat/tier/variant stats) with no component in common at the value-input
 * level -- a plain `<input>` in three of the four, `PercentInput` in all four depending on the
 * stat's kind.
 */
window.NW.statRowNav = (() => {
  'use strict';

  function focusNextCombo(event) {
    if (event.key !== 'Tab' && event.key !== 'Enter') return;
    if (event.key === 'Tab' && event.shiftKey) return;
    const row = event.target.closest('.stat-row');
    const next = row?.nextElementSibling;
    const combo = next?.classList?.contains('stat-row') ? next.querySelector('.combo--stat input') : null;
    if (!combo) return;
    event.preventDefault();
    combo.focus();
  }

  return { focusNextCombo };
})();
