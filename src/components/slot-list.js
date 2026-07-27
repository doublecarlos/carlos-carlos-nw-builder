// The left column: 15 collapsible sections over 180 slots (plan §1.5, §Phase 3).
//
// Sections start collapsed except Gear (handoff §6). That keeps the mounted DOM at ~15 rows
// on load; expanding everything is ~180 rows, which the browser handles fine -- only one
// dropdown is ever open, and that is where the per-row cost actually lives. No virtualisation.

window.NW = window.NW ?? {};
window.NW.components = window.NW.components ?? {};

window.NW.components.SlotList = (() => {
  'use strict';

  const OPEN_BY_DEFAULT = new Set(['gear']);

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
    },

    emits: ['choose', 'set-value', 'set', 'set-forte'],

    data() {
      const expanded = { options: false };
      for (const section of this.db.sections) expanded[section.id] = OPEN_BY_DEFAULT.has(section.id);
      return {
        expanded,
        hover: null,        // { slotId, left, top } -- the one hover card, or nothing
        hoverTimer: null,
        leaveTimer: null,   // grace period before a leave actually closes the card
        lastHideAt: 0,      // Date.now() of the last close, for the "resume" fast path
        editing: false,     // a picker has focus: suppress the card so it cannot cover a dropdown
      };
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

      sections() {
        return this.db.sections.map((section) => {
          const slots = this.db.slots.filter((slot) => slot.section === section.id);
          let filled = 0;
          let errors = 0;
          for (const slot of slots) {
            if (this.rowBySlot.get(slot.id)?.item) filled += 1;
            errors += this.errorsBySlot.get(slot.id)?.length ?? 0;
          }
          return { ...section, slots, filled, errors, total: slots.length };
        });
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

      errorsFor(slotId) {
        return this.errorsBySlot.get(slotId) ?? [];
      },

      toggle(sectionId) {
        this.expanded[sectionId] = !this.expanded[sectionId];
      },

      setAll(open) {
        for (const section of this.db.sections) this.expanded[section.id] = open;
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

      onFocusIn() {
        this.editing = true;
        window.clearTimeout(this.hoverTimer);
        this.close();
      },

      onFocusOut() {
        this.editing = false;
      },
    },

    mounted() {
      window.addEventListener('scroll', this.onScroll, true);
    },

    unmounted() {
      window.clearTimeout(this.hoverTimer);
      window.clearTimeout(this.leaveTimer);
      window.removeEventListener('scroll', this.onScroll, true);
    },

    template: `
      <div class="slots" @focusin="onFocusIn" @focusout="onFocusOut">
        <div class="slots-toolbar">
          <button type="button" class="link" @click="setAll(true)">expand all</button>
          <button type="button" class="link" @click="setAll(false)">collapse all</button>
        </div>

        <section class="section">
          <button type="button" class="section-head" @click="expanded.options = !expanded.options">
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
          <button type="button" class="section-head" @click="toggle(section.id)">
            <span class="section-chevron">{{ expanded[section.id] ? '▾' : '▸' }}</span>
            <span class="section-label">{{ section.label }}</span>
            <span class="section-count">{{ section.filled }}/{{ section.total }}</span>
            <span v-if="section.errors" class="badge badge--error">{{ section.errors }}</span>
          </button>

          <div v-if="expanded[section.id]" class="section-body">
            <div v-for="slot in section.slots" :key="slot.id" class="slot-row"
                 :class="{ 'is-hovered': hover?.slotId === slot.id }"
                 @mouseenter="onRowEnter($event, slot.id)"
                 @mouseleave="onRowLeave">
              <label class="slot-label" :for="slot.id">{{ slot.label }}</label>

              <div class="slot-control">
                <ItemPicker
                  :items="itemsFor(slot.id)"
                  :model-value="build.choices[slot.id] ?? ''"
                  :invalid="errorsFor(slot.id).length > 0"
                  @update:model-value="$emit('choose', slot.id, $event)" />

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
          :slot-label="db.slotById.get(hover.slotId)?.label ?? ''"
          :style="{ left: hover.left + 'px', top: hover.top + 'px' }"
          @mouseenter="onCardEnter"
          @mouseleave="onCardLeave" />
      </div>
    `,
  };
})();
