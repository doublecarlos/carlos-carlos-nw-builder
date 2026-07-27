// Hover card for an equipped item: its full stat line and every bonus it participates in,
// with the active ones marked and the inactive ones explained.
//
// Pure presentation -- the caller resolves which bonuses belong to the item and positions the
// card. Rendered once by `slot-list`, not once per row: 180 slots must not mean 180 cards.
//
// `pointer-events: none` (see app.css) makes this a genuine tooltip: it can never swallow a
// click meant for the row underneath, or fight the hover that summoned it.

window.NW = window.NW ?? {};
window.NW.components = window.NW.components ?? {};

window.NW.components.ItemCard = (() => {
  'use strict';

  return {
    name: 'ItemCard',

    props: {
      item: { type: Object, required: true },
      /** Resolved bonus entries this item takes part in, from `result.bonuses`. */
      bonuses: { type: Array, default: () => [] },
      slotLabel: { type: String, default: '' },
    },

    computed: {
      stats() {
        const fmt = window.NW.format;
        const out = [];
        for (const key of window.NW_SCHEMA.statKeys) {
          const value = this.item[key];
          if (!value) continue;
          out.push({ key, label: fmt.label(key), value: fmt.signedStat(key, value) });
        }
        return out;
      },

      /** Notes that are not stats but change whether the item is legal or what it grants. */
      notes() {
        const out = [];
        if (this.item.allowedClass) out.push(`${this.item.allowedClass.join(' or ')} only`);
        if (this.item.maxCopies) out.push(`max ${this.item.maxCopies} equipped`);
        if (this.item.dynamicStat) {
          const label = window.NW.format.label(this.item.dynamicStat);
          out.push(`${label} ${this.item.dynamicMin}–${this.item.dynamicMax}, you choose`);
        }
        if (this.item.sets?.length) out.push(`set: ${this.item.sets.join(', ')}`);
        return out;
      },

      rows() {
        return this.bonuses.map((entry) => ({
          id: entry.id,
          state: entry.excluded ? 'excluded' : (entry.active ? 'active' : 'inactive'),
          conditions: (entry.gate?.leaves ?? []).map((leaf) => leaf.label).filter(Boolean)
            .join(' + '),
          unmet: entry.gate?.unmet ?? [],
          excludedBy: entry.excludedBy,
          stats: this.payload(entry),
          stacks: entry.stacks ?? 1,
        }));
      },
    },

    methods: {
      payload(entry) {
        const fmt = window.NW.format;
        // Active bonuses report what actually reached the pipeline; inactive ones can only
        // offer their declared payload, and tiered ones have not chosen a tier at all.
        const stats = entry.active ? entry.appliedStats : entry.bonus?.stats;
        if (!stats) return entry.bonus?.tiers ? '(tiered)' : '';
        return Object.entries(stats)
          .map(([key, value]) => `${fmt.label(key)} ${fmt.signedStat(key, value)}`)
          .join(', ');
      },
    },

    template: `
      <div class="itemcard">
        <div class="itemcard-head">
          <span class="itemcard-name">{{ item.name }}</span>
          <span v-if="item.il" class="itemcard-il">iL {{ item.il.toLocaleString() }}</span>
        </div>
        <div v-if="slotLabel" class="itemcard-slot">{{ slotLabel }}</div>

        <div class="itemcard-stats">
          <div v-for="stat in stats" :key="stat.key" class="itemcard-stat">
            <span>{{ stat.label }}</span><span class="num">{{ stat.value }}</span>
          </div>
          <div v-if="!stats.length" class="dim">no direct stats</div>
        </div>

        <div v-if="notes.length" class="itemcard-notes">
          <div v-for="note in notes" :key="note">{{ note }}</div>
        </div>

        <div v-if="rows.length" class="itemcard-bonuses">
          <div class="itemcard-section">Bonuses</div>
          <div v-for="row in rows" :key="row.id" class="itemcard-bonus" :class="'bonus--' + row.state">
            <div class="itemcard-bonus-head">
              <span class="bonus-dot"></span>
              <span class="itemcard-bonus-cond">{{ row.conditions || 'always' }}</span>
              <span v-if="row.stacks > 1" class="badge">×{{ row.stacks }}</span>
            </div>
            <div v-if="row.stats" class="itemcard-bonus-stats">{{ row.stats }}</div>
            <div v-for="(leaf, i) in row.unmet" :key="i" class="itemcard-bonus-unmet">
              needs {{ leaf.label }}<span v-if="leaf.detail"> — {{ leaf.detail }}</span>
            </div>
            <div v-if="row.excludedBy" class="itemcard-bonus-unmet">
              overridden by {{ row.excludedBy }}
            </div>
          </div>
        </div>
      </div>
    `,
  };
})();
