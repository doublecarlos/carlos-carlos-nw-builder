// Token / chip input: committed values become badges, with autocomplete over known options and
// free text allowed for values that do not exist yet.
//
// Used for an item's set membership, where both halves matter: you usually want to attach an
// existing set (so autocomplete), but creating a brand-new set id by typing it is a normal
// thing to do (so free text).

window.NW = window.NW ?? {};
window.NW.components = window.NW.components ?? {};

window.NW.components.TokenInput = (() => {
  'use strict';

  const MAX_SUGGESTIONS = 40;

  return {
    name: 'TokenInput',

    props: {
      modelValue: { type: Array, default: () => [] },
      options: { type: Array, default: () => [] },
      placeholder: { type: String, default: 'Type to search…' },
      allowFree: { type: Boolean, default: true },
    },

    emits: ['update:modelValue'],

    data: () => ({ query: '', open: false, highlight: 0 }),

    computed: {
      suggestions() {
        if (!this.open) return [];
        const query = this.query.trim().toLowerCase();
        const chosen = new Set(this.modelValue);
        return this.options
          .filter((option) => !chosen.has(option)
            && (!query || option.toLowerCase().includes(query)))
          .slice(0, MAX_SUGGESTIONS);
      },

      /** Offering to create the typed value, when it is genuinely new. */
      freeValue() {
        const value = this.query.trim();
        if (!this.allowFree || !value) return '';
        if (this.modelValue.includes(value)) return '';
        return this.options.includes(value) ? '' : value;
      },

      entries() {
        return this.freeValue ? [this.freeValue, ...this.suggestions] : this.suggestions;
      },
    },

    watch: {
      highlight() {
        this.$nextTick(() => {
          this.$refs.menu?.querySelector('.is-highlighted')?.scrollIntoView({ block: 'nearest' });
        });
      },
    },

    methods: {
      add(value) {
        const token = String(value ?? '').trim();
        if (!token || this.modelValue.includes(token)) return;
        this.$emit('update:modelValue', [...this.modelValue, token]);
        this.query = '';
        this.highlight = 0;
      },

      removeAt(index) {
        const next = [...this.modelValue];
        next.splice(index, 1);
        this.$emit('update:modelValue', next);
      },

      onKeydown(event) {
        const { key } = event;

        // Backspace on an empty box eats the previous token -- the behaviour everyone expects
        // from an address field.
        if (key === 'Backspace' && !this.query && this.modelValue.length) {
          event.preventDefault();
          this.removeAt(this.modelValue.length - 1);
          return;
        }

        if (key === 'ArrowDown' || key === 'ArrowUp') {
          event.preventDefault();
          this.open = true;
          const step = key === 'ArrowDown' ? 1 : -1;
          this.highlight = Math.min(Math.max(this.highlight + step, 0), this.entries.length - 1);
          return;
        }

        // Comma and Enter both commit, so pasting "a, b, c" and typing behave alike.
        if (key === 'Enter' || key === ',' || key === 'Tab') {
          const picked = this.entries[this.highlight];
          if (key === 'Tab' && !this.query && !picked) return;
          if (picked || this.query.trim()) {
            event.preventDefault();
            this.add(picked ?? this.query);
          }
          return;
        }

        if (key === 'Escape') {
          this.open = false;
          this.query = '';
        }
      },

      onPaste(event) {
        const text = event.clipboardData?.getData('text') ?? '';
        if (!text.includes(',')) return;
        event.preventDefault();
        for (const part of text.split(',')) this.add(part);
      },
    },

    template: `
      <div class="tokens" :class="{ 'is-open': open }" @mousedown.self="$refs.input.focus()">
        <span v-for="(token, index) in modelValue" :key="token" class="token">
          {{ token }}
          <button type="button" class="token-x" title="Remove"
                  @mousedown.prevent="removeAt(index)">×</button>
        </span>

        <input
          ref="input"
          class="token-field"
          type="text"
          autocomplete="off"
          spellcheck="false"
          :placeholder="modelValue.length ? '' : placeholder"
          v-model="query"
          @focus="open = true; highlight = 0"
          @blur="open = false"
          @keydown="onKeydown"
          @paste="onPaste">

        <div v-if="open && entries.length" class="token-menu" ref="menu">
          <div v-for="(entry, index) in entries" :key="entry"
               class="token-option" :class="{ 'is-highlighted': index === highlight }"
               @mousedown.prevent="add(entry)" @mouseenter="highlight = index">
            <span>{{ entry }}</span>
            <span v-if="entry === freeValue" class="token-new">new</span>
          </div>
        </div>
      </div>
    `,
  };
})();
