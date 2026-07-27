// Searchable item typeahead for one slot (plan §Phase 3, "Left").
//
// A native <datalist> was considered and rejected: it cannot show item level and a stat
// preview per row, and its keyboard behaviour is not controllable. This is ~120 lines instead.
//
// The component owns only its own transient UI state (open / query / highlight). The chosen
// value is `modelValue` and every change leaves via `update:modelValue`, so the single
// build document in app.js stays the only source of truth (and Phase 4's undo stack has a
// single place to hook into).

window.NW = window.NW ?? {};
window.NW.components = window.NW.components ?? {};

window.NW.components.ItemPicker = (() => {
  'use strict';

  // Long filters (insignia, group buffs) run to 40+ entries. Rendering all of them for every
  // keystroke is wasted work when nobody scrolls past the first screenful.
  const MAX_ROWS = 60;

  return {
    name: 'ItemPicker',

    props: {
      modelValue: { type: String, default: '' },
      items: { type: Array, required: true },
      invalid: { type: Boolean, default: false },
    },

    emits: ['update:modelValue'],

    data: () => ({ open: false, query: '', highlight: 0 }),

    computed: {
      filtered() {
        if (!this.open) return [];
        const query = this.query.trim().toLowerCase();
        return query
          ? this.items.filter((item) => item.name.toLowerCase().includes(query))
          : this.items;
      },

      /** Decorated once per filter change rather than once per render pass. */
      matches() {
        return this.filtered.slice(0, MAX_ROWS).map((item) => ({
          item,
          preview: window.NW.format.itemPreview(item, 3),
          flagged: window.NW.format.hasBonuses(item),
        }));
      },

      hiddenCount() {
        return Math.max(this.filtered.length - this.matches.length, 0);
      },

      /** Index 0 is always "clear the slot", so highlight indices line up with the DOM. */
      options() {
        return [null, ...this.matches.map((entry) => entry.item)];
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
      int: (value) => window.NW.format.int(value),

      /** Skips the reset when already open: `focusAndSeed` below pre-sets `open` before the
       *  native focus event fires, and this must not stomp the query it just seeded. */
      onFocus() {
        if (this.open) return;
        this.open = true;
        this.query = '';
        // Start on whatever is already equipped, not on "empty" -- `options` reflects the
        // now-open (unfiltered) list since `open` was just set above.
        const current = this.options.findIndex((item) => item?.name === this.modelValue);
        this.highlight = current === -1 ? 0 : current;
      },

      /** Called imperatively by slot-list's keyboard cursor: typing a character on a row with
       *  no input focused opens this picker pre-filtered, like Sheets overwriting a cell. */
      focusAndSeed(char) {
        this.open = true;
        this.query = char;
        this.highlight = 0;
        this.$nextTick(() => this.$refs.input?.focus());
      },

      onInput(event) {
        this.query = event.target.value;
        this.open = true;
        this.highlight = 0;
      },

      onBlur() {
        // Options use @mousedown.prevent, so a click never reaches this -- but Tab and
        // focus-stealing elsewhere do, and the dropdown must not survive them.
        this.close();
      },

      close() {
        this.open = false;
        this.query = '';
      },

      choose(item) {
        this.$emit('update:modelValue', item ? item.name : '');
        this.close();
        this.$refs.input?.blur();
      },

      /**
       * Every branch here that acts also stops propagation: this input sits inside a
       * `.slot-row` that slot-list.js's own window-level keydown listener watches for its
       * passive row cursor. Without stopping propagation, the same Enter that this handler
       * uses to close the dropdown would go on to reach that listener too -- and since the
       * cursor is still parked on this row, it would immediately refocus (reopen) the very
       * picker that just closed. Relying on the listener's own focused-input gate to prevent
       * that is fragile: it depends on `blur()` having synchronously updated
       * `document.activeElement` before the bubbling event reaches `window`, which is not
       * guaranteed the same way in every browser.
       */
      onKeydown(event) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          event.stopPropagation();
          if (!this.open) {
            this.onFocus();
            return;
          }
          const step = event.key === 'ArrowDown' ? 1 : -1;
          const last = this.options.length - 1;
          this.highlight = Math.min(Math.max(this.highlight + step, 0), last);
          return;
        }
        if (event.key === 'Enter') {
          if (!this.open) return;
          event.preventDefault();
          event.stopPropagation();
          this.choose(this.options[this.highlight] ?? null);
          return;
        }
        if (event.key === 'Tab') {
          // Just closes -- does not pick, does not move focus on itself. A second Tab, with
          // the dropdown now closed, is free to move focus normally.
          if (!this.open) return;
          event.preventDefault();
          event.stopPropagation();
          this.close();
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          this.close();
          this.$refs.input?.blur();
        }
      },
    },

    template: `
      <div class="picker" :class="{ 'is-open': open, 'is-invalid': invalid }">
        <input
          ref="input"
          class="picker-input"
          type="text"
          autocomplete="off"
          spellcheck="false"
          :value="open ? query : (modelValue || '')"
          :placeholder="modelValue || '—'"
          :class="{ 'is-empty': !modelValue }"
          @focus="onFocus"
          @input="onInput"
          @blur="onBlur"
          @keydown="onKeydown">

        <button
          v-if="modelValue"
          class="picker-clear"
          type="button"
          title="Clear this slot"
          @mousedown.prevent="choose(null)">×</button>

        <div v-if="open" class="picker-menu" ref="list">
          <div
            class="picker-row picker-row--clear"
            :class="{ 'is-highlighted': highlight === 0 }"
            @mousedown.prevent="choose(null)"
            @mouseenter="highlight = 0">— empty —</div>

          <div
            v-for="(entry, index) in matches"
            :key="entry.item.name"
            class="picker-row"
            :class="{ 'is-highlighted': highlight === index + 1 }"
            @mousedown.prevent="choose(entry.item)"
            @mouseenter="highlight = index + 1">
            <div class="picker-row-head">
              <span class="picker-name">{{ entry.item.name }}</span>
              <span v-if="entry.flagged" class="picker-flag" title="has conditional bonuses">◈</span>
              <span v-if="entry.item.il" class="picker-il">iL {{ int(entry.item.il) }}</span>
            </div>
            <div class="picker-row-stats">
              <span v-for="part in entry.preview.parts" :key="part" class="picker-stat">{{ part }}</span>
              <span v-if="entry.preview.more" class="picker-more">+{{ entry.preview.more }} more</span>
            </div>
          </div>

          <div v-if="!matches.length" class="picker-row picker-row--none">no match</div>
          <div v-if="hiddenCount" class="picker-row picker-row--none">
            {{ hiddenCount }} more — keep typing
          </div>
        </div>
      </div>
    `,
  };
})();
