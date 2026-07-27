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

  return {
    name: 'SlotList',

    components: { ItemPicker: window.NW.components.ItemPicker },

    props: {
      db: { type: Object, required: true },
      build: { type: Object, required: true },
      result: { type: Object, required: true },
    },

    emits: ['choose', 'set-value'],

    data() {
      const expanded = {};
      for (const section of this.db.sections) expanded[section.id] = OPEN_BY_DEFAULT.has(section.id);
      return { expanded };
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
        return this.db.forSlot(slotId);
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
    },

    template: `
      <div class="slots">
        <div class="slots-toolbar">
          <button type="button" class="link" @click="setAll(true)">expand all</button>
          <button type="button" class="link" @click="setAll(false)">collapse all</button>
        </div>

        <section v-for="section in sections" :key="section.id" class="section">
          <button type="button" class="section-head" @click="toggle(section.id)">
            <span class="section-chevron">{{ expanded[section.id] ? '▾' : '▸' }}</span>
            <span class="section-label">{{ section.label }}</span>
            <span class="section-count">{{ section.filled }}/{{ section.total }}</span>
            <span v-if="section.errors" class="badge badge--error">{{ section.errors }}</span>
          </button>

          <div v-if="expanded[section.id]" class="section-body">
            <div v-for="slot in section.slots" :key="slot.id" class="slot-row">
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
      </div>
    `,
  };
})();
