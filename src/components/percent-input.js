// Percent field, in the spirit of a percent-formatted spreadsheet cell.
//
// The engine stores percentages as decimals (0.09 === 9%), which is right for the maths and
// awful to type: `0.09` is easy to enter as `9`, and `catalog.validate` exists partly to catch
// exactly that mistake. This widget removes the mistake instead of reporting it -- you read and
// type percent units, and the decimal never surfaces.
//
// Float hygiene matters more here than it looks. `3.6 / 100` is 0.036000000000000004, not
// 0.036, so a naive conversion would perturb every value it touched: the item would diff
// against the shipped data, and the export would fill with noise digits. Both directions round
// to a precision far finer than any real game value.

window.NW = window.NW ?? {};
window.NW.components = window.NW.components ?? {};

window.NW.components.PercentInput = (() => {
  'use strict';

  /** decimal -> percent number. 0.036 -> 3.6, not 3.5999999999999996. */
  const toPercent = (value) => Number((Number(value) * 100).toFixed(10));

  /** percent number -> decimal. 3.6 -> 0.036, not 0.036000000000000004. */
  const toDecimal = (percent) => Number((Number(percent) / 100).toFixed(12));

  /** Up to 4 decimals, trailing zeros trimmed: 9%, 3.6%, 9.85%. */
  const display = (value) => {
    if (value === '' || value == null || !Number.isFinite(Number(value))) return '';
    const percent = toPercent(value);
    return `${Number(percent.toFixed(4))}%`;
  };

  return {
    name: 'PercentInput',

    props: {
      modelValue: { type: [Number, String], default: '' },
      placeholder: { type: String, default: '' },
      step: { type: Number, default: 1 },      // percentage points per arrow press
    },

    emits: ['update:modelValue'],

    data: () => ({ focused: false, text: '' }),

    computed: {
      shown() {
        return this.focused ? this.text : display(this.modelValue);
      },
    },

    methods: {
      onFocus(event) {
        this.focused = true;
        const value = this.modelValue;
        this.text = (value === '' || value == null || !Number.isFinite(Number(value)))
          ? ''
          : String(toPercent(value));
        // Select the whole value, so typing replaces rather than appends -- the spreadsheet
        // behaviour, and the reason retyping a rate is not fiddly.
        this.$nextTick(() => event.target.select());
      },

      onBlur() {
        this.focused = false;
      },

      onInput(event) {
        this.text = event.target.value;
        this.commit(this.text);
      },

      commit(raw) {
        const cleaned = String(raw).replace(/[%\s]/g, '').replace(',', '.');
        if (cleaned === '' || cleaned === '-') {
          this.$emit('update:modelValue', '');
          return;
        }
        const percent = Number(cleaned);
        // Mid-typing states like "9." or "-" are left alone rather than snapped to 0.
        if (!Number.isFinite(percent)) return;
        this.$emit('update:modelValue', toDecimal(percent));
      },

      nudge(direction, event) {
        event.preventDefault();
        const current = Number.isFinite(Number(this.modelValue)) && this.modelValue !== ''
          ? toPercent(this.modelValue)
          : 0;
        const factor = event.shiftKey ? 10 : 1;
        const next = Number((current + direction * this.step * factor).toFixed(10));
        this.text = String(next);
        this.$emit('update:modelValue', toDecimal(next));
      },
    },

    template: `
      <input
        ref="input"
        class="pct-input"
        type="text"
        inputmode="decimal"
        autocomplete="off"
        :value="shown"
        :placeholder="placeholder"
        @focus="onFocus"
        @blur="onBlur"
        @input="onInput"
        @keydown.up="nudge(1, $event)"
        @keydown.down="nudge(-1, $event)">
    `,

    // Exposed for tests and for anyone needing the same rounding elsewhere.
    toPercent,
    toDecimal,
  };
})();
