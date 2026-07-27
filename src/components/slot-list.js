// The left column: 15 collapsible sections over 180 slots (plan §1.5, §Phase 3).
//
// Sections start collapsed except Gear (handoff §6). That keeps the mounted DOM at ~15 rows
// on load; expanding everything is ~180 rows, which the browser handles fine -- only one
// dropdown is ever open, and that is where the per-row cost actually lives. No virtualisation.

window.NW = window.NW ?? {};
window.NW.components = window.NW.components ?? {};

window.NW.components.SlotList = (() => {
  'use strict';

  const HOVER_DELAY_MS = 220;
  // If the pointer lands on a new row this soon after the last card closed, treat it as still
  // "in" the tooltip session and skip the opening delay -- sweeping down a list of items should
  // feel like one continuous hover, not a fresh 220ms wait per row.
  const HOVER_RESUME_MS = 400;
  const HOVER_CLOSE_GRACE_MS = 100;
  const CARD_W = 330;    // must match .itemcard width in app.css

  return {
    name: 'SlotList',

    components: {
      ItemPicker: window.NW.components.ItemPicker,
      ItemCard: window.NW.components.ItemCard,
      Options: window.NW.components.Options,
    },

    props: {
      db: { type: Object, required: true },
      build: { type: Object, required: true },
      result: { type: Object, required: true },
      context: { type: Object, required: true },
      // sectionId (plus 'options') -> open/closed. Owned by app.js (`build.expanded`, saved
      // with the build) so it survives a reload the same way the rest of the build does --
      // this component only reads it and asks for changes via `toggle-section`/`set-expanded`.
      expanded: { type: Object, required: true },
      // The quick-compare picker in app.js. `compareBuild` alone (no highlight) still backs
      // the other-build note under a differing row; `highlightDiff` adds the row colour;
      // `onlyDiff` hides everything that agrees.
      compareBuild: { type: Object, default: null },
      highlightDiff: { type: Boolean, default: false },
      onlyDiff: { type: Boolean, default: false },
    },

    emits: ['choose', 'set-value', 'set', 'set-forte', 'apply-slot', 'toggle-section', 'set-expanded'],

    data: () => ({
      hover: null,        // { slotId, left, top } -- the one hover card, or nothing
      hoverTimer: null,
      leaveTimer: null,   // grace period before a leave actually closes the card
      lastHideAt: 0,      // Date.now() of the last close, for the "resume" fast path
      editing: false,     // a picker has focus: suppress the card so it cannot cover a dropdown
      cursor: null,        // { type: 'header'|'slot', id } -- keyboard cursor, independent of the mouse
    }),

    /** Imperative ref bag for per-row ItemPickers (see `setPickerRef`) -- not template state,
     *  so it lives outside `data()` and is never made reactive. */
    created() {
      this.pickerRefs = {};
    },

    computed: {
      /** slotId -> the engine's resolved row, so the item object is never looked up twice. */
      rowBySlot() {
        return new Map(this.result.rows.map((row) => [row.slotId, row]));
      },

      /** slotId -> [error]. Errors are rare, so a Map beats filtering per row. */
      errorsBySlot() {
        const map = new Map();
        for (const error of this.result.errors) {
          const list = map.get(error.slotId);
          if (list) list.push(error);
          else map.set(error.slotId, [error]);
        }
        return map;
      },

      /**
       * bonusId -> resolved entry, so a hover can look up an item's bonuses without scanning
       * all 48 of them per row.
       */
      bonusById() {
        return new Map(this.result.bonuses.map((bonus) => [bonus.id, bonus]));
      },

      hoveredItem() {
        return this.hover ? this.itemIn(this.hover.slotId) : null;
      },

      /**
       * Every bonus the hovered item takes part in -- its own inline ones and its sets'.
       * Not `bonuses.filter(b => b.slotId === …)`: a set bonus is attributed to the single
       * slot that instanced it, so the other pieces of the set would show nothing.
       */
      hoveredBonuses() {
        const item = this.hoveredItem;
        if (!item) return [];
        const seen = new Set();
        const out = [];
        for (const entry of this.db.bonusesFor(item)) {
          const resolved = this.bonusById.get(entry.bonus.id);
          if (resolved && !seen.has(resolved.id)) {
            seen.add(resolved.id);
            out.push(resolved);
          }
        }
        return out;
      },

      /**
       * slotId -> active bonuses to credit to *that* row's inline summary, one row-line per
       * bonus rather than a name attached to raw numbers. A bonus fed by several equipped
       * items (a set piece requirement, or a flat bonus two items both grant) would otherwise
       * print on every one of their rows -- read together that looks like each item grants it
       * independently, when really they share credit for one thing. Google Sheets' own
       * summary sidesteps this by crediting a shared bonus to only the first contributing row;
       * this walks the slots in the same canonical (not display/expanded) order and does the
       * same, via a `shown` set threaded through the whole pass.
       */
      bonusesBySlot() {
        const shown = new Set();
        const map = new Map();
        for (const section of this.sections) {
          for (const slot of section.slots) {
            const item = this.itemIn(slot.id);
            if (!item) continue;
            const entries = [];
            for (const raw of this.db.bonusesFor(item)) {
              const resolved = this.bonusById.get(raw.bonus.id);
              if (!resolved?.active || shown.has(resolved.id)) continue;
              shown.add(resolved.id);
              entries.push(resolved);
            }
            if (entries.length) map.set(slot.id, entries);
          }
        }
        return map;
      },

      sections() {
        const onlyDiff = this.onlyDiff && this.compareBuild;
        return this.db.sections
          .map((section) => {
            const allSlots = this.db.slots.filter((slot) => slot.section === section.id);
            // Counted off the section's full slot list, not the (possibly onlyDiff-filtered)
            // one below -- the badge's job is telling a *collapsed* section apart, where
            // `slots` would otherwise be invisible.
            const diffs = this.compareBuild ? allSlots.filter((slot) => this.differs(slot.id)).length : 0;
            const slots = onlyDiff ? allSlots.filter((slot) => this.differs(slot.id)) : allSlots;
            let filled = 0;
            let errors = 0;
            for (const slot of slots) {
              if (this.rowBySlot.get(slot.id)?.item) filled += 1;
              errors += this.errorsBySlot.get(slot.id)?.length ?? 0;
            }
            return { ...section, slots, filled, errors, diffs, total: slots.length };
          })
          .filter((section) => !onlyDiff || section.slots.length > 0);
      },

      /**
       * Flattens exactly what the template renders -- the Options header, then per section a
       * header and (if expanded) its slot rows -- so keyboard movement always matches what is
       * actually on screen. Collapsed sections simply contribute no slot entries, the same way
       * a spreadsheet skips hidden rows.
       */
      visibleRows() {
        const rows = [{ type: 'header', id: 'options' }];
        for (const section of this.sections) {
          rows.push({ type: 'header', id: section.id });
          if (this.expanded[section.id]) {
            for (const slot of section.slots) rows.push({ type: 'slot', id: slot.id });
          }
        }
        return rows;
      },
    },

    methods: {
      statLabel: (key) => window.NW.format.label(key),

      itemsFor(slotId) {
        const cls = this.build.context.class;
        return this.db.forSlot(slotId)
          .filter((item) => !item.allowedClass || item.allowedClass.includes(cls));
      },

      itemIn(slotId) {
        return this.rowBySlot.get(slotId)?.item ?? null;
      },

      // --- quick compare ---------------------------------------------------------------------

      otherChoice(slotId) {
        return this.compareBuild?.choices?.[slotId] || '';
      },

      differs(slotId) {
        return Boolean(this.compareBuild)
          && (this.build.choices[slotId] || '') !== this.otherChoice(slotId);
      },

      errorsFor(slotId) {
        return this.errorsBySlot.get(slotId) ?? [];
      },

      toggle(sectionId) {
        this.$emit('toggle-section', sectionId);
      },

      setAll(open) {
        this.$emit('set-expanded', open);
      },

      /**
       * Condensed, single-line stat summary for a row: the item's own stats plus whatever
       * active bonuses are credited to this slot (`bonusesBySlot`), summed together key by key
       * rather than attributed separately -- one number per stat, not a name-tagged breakdown.
       */
      statSummary(slotId) {
        const item = this.itemIn(slotId);
        if (!item) return '';
        const totals = {};
        for (const key of window.NW_SCHEMA.statKeys) {
          if (item[key]) totals[key] = (totals[key] ?? 0) + item[key];
        }
        for (const entry of this.bonusesBySlot.get(slotId) ?? []) {
          for (const [key, value] of Object.entries(entry.appliedStats ?? {})) {
            totals[key] = (totals[key] ?? 0) + value;
          }
        }
        const fmt = window.NW.format;
        const parts = [];
        for (const key of window.NW_SCHEMA.statKeys) {
          if (!totals[key]) continue;
          parts.push(`${fmt.abbr(key)} ${fmt.signedStat(key, totals[key])}`);
        }
        return parts.join(' • ');
      },

      // --- keyboard cursor -------------------------------------------------------------------

      isCursor(type, id) {
        return this.cursor?.type === type && this.cursor?.id === id;
      },

      setCursor(type, id) {
        this.cursor = { type, id };
        this.syncCursorFocus();
      },

      setPickerRef(slotId, el) {
        if (el) this.pickerRefs[slotId] = el;
        else delete this.pickerRefs[slotId];
      },

      /** Focusing the input reuses ItemPicker's own `onFocus` (opens, clears the query). Only
       *  the type-ahead case needs a seeded query, via ItemPicker's `focusAndSeed`. */
      focusPicker(slotId, seedChar) {
        const picker = this.pickerRefs[slotId];
        if (!picker) return;
        if (seedChar) picker.focusAndSeed(seedChar);
        else picker.$refs.input?.focus();
      },

      /**
       * Scrolls the cursor row into view, and -- unless real focus is already somewhere inside
       * it (a click straight into the picker, say) -- moves native DOM focus to it too. Without
       * this, arrowing the visual cursor around leaves real focus stranded wherever it happened
       * to be last, and Tab from there jumps somewhere unrelated to what's highlighted; with it,
       * Tab naturally continues from the row the cursor is actually on (and, for a slot row,
       * lands on that row's own picker next, since it's tabindex="-1" and the picker input is
       * the next focusable thing after it in document order).
       */
      syncCursorFocus() {
        this.$nextTick(() => {
          if (!this.cursor) return;
          const key = `${this.cursor.type}:${this.cursor.id}`;
          const el = this.$el.querySelector(`[data-cursor-key="${CSS.escape(key)}"]`);
          if (!el) return;
          el.scrollIntoView({ block: 'nearest' });
          if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });
        });
      },

      /**
       * The passive gate: arrow/type-to-edit only fires when nothing has already claimed the
       * keyboard for its own editing. This is deliberately not scoped to `.slots` -- Escape on
       * an open picker blurs its input, which sends focus to <body>, and the cursor (never
       * cleared) should be immediately live again with no extra click.
       */
      isPassiveTarget() {
        const el = document.activeElement;
        if (!el) return true;
        const tag = el.tagName;
        return tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' && !el.isContentEditable;
      },

      onNavKeydown(event) {
        if (!this.isPassiveTarget()) return;

        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          const rows = this.visibleRows;
          if (!rows.length) return;
          event.preventDefault();
          const dir = event.key === 'ArrowDown' ? 1 : -1;
          const idx = this.cursor
            ? rows.findIndex((r) => r.type === this.cursor.type && r.id === this.cursor.id)
            : -1;
          const next = idx === -1
            ? (dir === 1 ? 0 : rows.length - 1)
            : Math.min(Math.max(idx + dir, 0), rows.length - 1);
          this.setCursor(rows[next].type, rows[next].id);
          return;
        }

        if (!this.cursor) return;

        if (event.key === 'Enter') {
          event.preventDefault();
          if (this.cursor.type === 'header') this.toggle(this.cursor.id);
          else this.focusPicker(this.cursor.id);
          return;
        }

        if (this.cursor.type === 'slot' && (event.key === 'Backspace' || event.key === 'Delete')) {
          event.preventDefault();
          this.$emit('choose', this.cursor.id, '');
          return;
        }

        if (this.cursor.type === 'slot' && event.key.length === 1
          && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault();
          this.focusPicker(this.cursor.id, event.key);
        }
      },

      // --- hover card ----------------------------------------------------------------------

      onRowEnter(event, slotId) {
        if (this.editing || !this.itemIn(slotId)) return;
        window.clearTimeout(this.hoverTimer);
        window.clearTimeout(this.leaveTimer);
        const rect = event.currentTarget.getBoundingClientRect();
        const x = event.clientX;
        // Delay: sweeping the pointer down a 180-row list should not strobe cards. But if a
        // card only just closed, this is the same sweep -- resume instantly instead of making
        // every row pay the delay again.
        const resuming = Date.now() - this.lastHideAt < HOVER_RESUME_MS;
        this.hoverTimer = window.setTimeout(
          () => this.place(slotId, rect, x),
          resuming ? 0 : HOVER_DELAY_MS,
        );
      },

      onRowLeave() {
        window.clearTimeout(this.hoverTimer);
        // Grace period, not an instant close: the card sits outside the row's own bounds, so
        // reaching it always crosses this "gap" first. Without the grace period the card would
        // vanish the instant the pointer leaves the row, before it ever reaches the card.
        window.clearTimeout(this.leaveTimer);
        this.leaveTimer = window.setTimeout(() => this.close(), HOVER_CLOSE_GRACE_MS);
      },

      /** Entering the card itself cancels any pending close from leaving the row. */
      onCardEnter() {
        window.clearTimeout(this.leaveTimer);
      },

      onCardLeave() {
        this.close();
      },

      close() {
        window.clearTimeout(this.leaveTimer);
        if (this.hover) this.lastHideAt = Date.now();
        this.hover = null;
      },

      /**
       * Anchored to the pointer horizontally and to the row vertically. Anchoring to the row's
       * right edge instead would be tidier, but a slot row spans almost the full column, so
       * the card would always land on top of the stat panel.
       *
       * The vertical flip needs the card's real height, not its CSS max-height, or a short
       * card near the bottom of the screen flips for no reason -- so it is measured once the
       * card exists and nudged only if it actually overflows.
       */
      place(slotId, rect, pointerX) {
        const margin = 10;
        let left = pointerX + 18;
        if (left + CARD_W > window.innerWidth - margin) left = pointerX - CARD_W - 18;
        this.hover = { slotId, left: Math.max(left, margin), top: rect.bottom + 6 };

        this.$nextTick(() => {
          const card = this.$el?.querySelector?.('.itemcard');
          if (!card || !this.hover) return;
          const height = card.offsetHeight;
          if (this.hover.top + height <= window.innerHeight - margin) return;
          const flipped = Math.max(rect.top - height - 6, margin);
          this.hover = { ...this.hover, top: flipped };
        });
      },

      /**
       * The rect is viewport-relative, so any scroll of the page invalidates it -- close
       * immediately, skipping the leave grace period that exists only for reaching the card by
       * pointer. Registered on the capture phase (see `mounted`) so a scroll anywhere reaches
       * it even inside a section body that stops propagation -- but capture-phase 'scroll'
       * fires for *every* scrollable element's own scrolling too, including the card's own
       * `overflow-y: auto`. Without this check, scrolling the long card's contents would look
       * indistinguishable from scrolling the page and close the card on its first wheel tick.
       */
      onScroll(event) {
        if (event.target?.closest?.('.itemcard')) return;
        window.clearTimeout(this.hoverTimer);
        if (this.hover) this.close();
      },

      /**
       * `setCursor`/`syncCursorFocus` push the keyboard cursor's position onto real DOM focus,
       * but focus can also move for reasons that never go through `setCursor` -- native Tab
       * order, or a click landing directly on a descendant like the picker input rather than
       * bubbling a `setCursor` call from the row div itself. Left alone, the cursor would go
       * stale and point somewhere real focus already isn't, so arrow keys from there would
       * jump from the wrong place. Syncing the other direction here -- real focus moving
       * updates the cursor to match -- keeps the two from ever disagreeing.
       */
      onFocusIn(event) {
        this.editing = true;
        window.clearTimeout(this.hoverTimer);
        this.close();

        const key = event.target.closest?.('[data-cursor-key]')?.dataset.cursorKey;
        if (!key) return;
        const sep = key.indexOf(':');
        const type = key.slice(0, sep);
        const id = key.slice(sep + 1);
        if (this.cursor?.type === type && this.cursor?.id === id) return;
        this.cursor = { type, id };
      },

      onFocusOut() {
        this.editing = false;
      },
    },

    mounted() {
      window.addEventListener('scroll', this.onScroll, true);
      window.addEventListener('keydown', this.onNavKeydown);
    },

    unmounted() {
      window.clearTimeout(this.hoverTimer);
      window.clearTimeout(this.leaveTimer);
      window.removeEventListener('scroll', this.onScroll, true);
      window.removeEventListener('keydown', this.onNavKeydown);
    },

    template: `
      <div class="slots" @focusin="onFocusIn" @focusout="onFocusOut">
        <div class="slots-toolbar">
          <button type="button" class="link" @click="setAll(true)">expand all</button>
          <button type="button" class="link" @click="setAll(false)">collapse all</button>
        </div>

        <section class="section">
          <button type="button" class="section-head" :class="{ 'is-cursor': isCursor('header', 'options') }"
                  data-cursor-key="header:options"
                  @click="toggle('options'); setCursor('header', 'options')">
            <span class="section-chevron">{{ expanded.options ? '▾' : '▸' }}</span>
            <span class="section-label">Options</span>
          </button>
          <div v-if="expanded.options" class="section-body">
            <Options :context="context"
                     @set="(key, value) => $emit('set', key, value)"
                     @set-forte="(slot, key) => $emit('set-forte', slot, key)" />
          </div>
        </section>

        <section v-for="section in sections" :key="section.id" class="section">
          <button type="button" class="section-head" :class="{ 'is-cursor': isCursor('header', section.id) }"
                  :data-cursor-key="'header:' + section.id"
                  @click="toggle(section.id); setCursor('header', section.id)">
            <span class="section-chevron">{{ expanded[section.id] ? '▾' : '▸' }}</span>
            <span class="section-label">{{ section.label }}</span>
            <span class="section-count">{{ section.filled }}/{{ section.total }}</span>
            <span v-if="section.errors" class="badge badge--error">{{ section.errors }}</span>
            <span v-if="highlightDiff && section.diffs" class="badge badge--diff">{{ section.diffs }}</span>
          </button>

          <div v-if="expanded[section.id]" class="section-body">
            <div v-for="slot in section.slots" :key="slot.id" class="slot-row" tabindex="-1"
                 :class="{ 'is-hovered': hover?.slotId === slot.id, 'is-cursor': isCursor('slot', slot.id),
                           'is-diff': highlightDiff && differs(slot.id) }"
                 :data-cursor-key="'slot:' + slot.id"
                 @mouseenter="onRowEnter($event, slot.id)"
                 @mouseleave="onRowLeave"
                 @click="setCursor('slot', slot.id)">
              <label class="slot-label" :for="slot.id">{{ slot.label }}</label>

              <div class="slot-control">
                <div class="slot-main">
                  <ItemPicker
                    :ref="el => setPickerRef(slot.id, el)"
                    :items="itemsFor(slot.id)"
                    :model-value="build.choices[slot.id] ?? ''"
                    :invalid="errorsFor(slot.id).length > 0"
                    @update:model-value="$emit('choose', slot.id, $event)" />
                  <span v-if="itemIn(slot.id)" class="slot-summary">{{ statSummary(slot.id) }}</span>
                </div>

                <p v-if="highlightDiff && differs(slot.id)" class="slot-diff-note">
                  {{ compareBuild.name }}: {{ otherChoice(slot.id) || '(empty)' }}
                  <button type="button" class="link" @click.stop="$emit('apply-slot', slot.id)">
                    apply
                  </button>
                </p>

                <!-- Dynamic weapon modifications carry a user-typed magnitude. Driven by the
                     item's own \`dynamicStat\`, not by a hard-coded slot id, so a second
                     dynamic modification would work with no UI change. -->
                <div v-if="itemIn(slot.id)?.dynamicStat" class="slot-value">
                  <input
                    type="number"
                    class="num-input"
                    :min="itemIn(slot.id).dynamicMin"
                    :max="itemIn(slot.id).dynamicMax"
                    :value="build.values[slot.id] ?? ''"
                    :placeholder="itemIn(slot.id).dynamicMin"
                    @input="$emit('set-value', slot.id, $event.target.value)">
                  <span class="hint">
                    {{ statLabel(itemIn(slot.id).dynamicStat) }}
                    {{ itemIn(slot.id).dynamicMin }}–{{ itemIn(slot.id).dynamicMax }}
                  </span>
                </div>

                <p v-for="error in errorsFor(slot.id)" :key="error.kind + error.choice"
                   class="slot-error">{{ error.message }}</p>
              </div>
            </div>
          </div>
        </section>

        <!-- One card for the whole list, moved and refilled on hover. -->
        <ItemCard
          v-if="hover && hoveredItem"
          :item="hoveredItem"
          :bonuses="hoveredBonuses"
          :db="db"
          :slot-label="db.slotById.get(hover.slotId)?.label ?? ''"
          :style="{ left: hover.left + 'px', top: hover.top + 'px' }"
          @mouseenter="onCardEnter"
          @mouseleave="onCardLeave" />
      </div>
    `,
  };
})();
