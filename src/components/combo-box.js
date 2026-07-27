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

      choose(option) {
        this.$emit('update:modelValue', option.value);
        this.close();
        this.$refs.input?.blur();
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
          if (this.open && this.filtered[this.highlight]) this.choose(this.filtered[this.highlight]);
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
