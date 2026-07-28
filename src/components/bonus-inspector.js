// The bonus inspector (plan §Phase 5, §2.5) -- the thing the spreadsheet could not do.
//
// The sheet could tell you a bonus was not applying. It could never tell you *why*, because
// its conditions were string matches evaluated inline with no record of what failed. The
// engine keeps `gate.leaves` / `gate.unmet` per bonus, each leaf already carrying a human
// `label` and `detail` ("duration ≥ 30s" / "you have 10s"), so this component mostly renders
// what it is handed -- see the handoff §4.
//
// Near-miss ordering is the useful part: inactive bonuses are sorted by how many conditions
// they fail, so the ones a single toggle or set piece away float to the top.

window.NW = window.NW ?? {};
window.NW.components = window.NW.components ?? {};

window.NW.components.BonusInspector = (() => {
  'use strict';

  const fmt = () => window.NW.format;

  /** `m31-crimson-march-combat` -> `M31 Crimson March Combat`, for bonuses with no set name. */
  const fromId = (id) => String(id ?? '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

  /**
   * One item often carries several bonuses (an AoE variant and a single-target one, say) and
   * they all inherit the item's name, so the rows need something to tell them apart.
   *
   * The conditions do that in the user's own language -- "combat enabled + duration 10–30s".
   * The bonus id also distinguishes them, but only as generated slugs: the same two bonuses
   * come out as "combat combat short" and "combat medium plus combat", which is noise.
   */
  const conditionSummary = (entry) => (entry.gate?.leaves ?? [])
    .map((leaf) => leaf.label)
    .filter(Boolean)
    .join(' + ');

  return {
    name: 'BonusInspector',

    props: {
      result: { type: Object, required: true },
      db: { type: Object, required: true },
    },

    data: () => ({ query: '', nearMissOnly: false, open: {} }),

    computed: {
      entries() {
        const titleCounts = new Map();
        for (const entry of this.result.bonuses) {
          const title = entry.bonus?.name ?? entry.sources?.[0] ?? fromId(entry.id);
          titleCounts.set(title, (titleCounts.get(title) ?? 0) + 1);
        }

        return this.result.bonuses.map((entry) => {
          const unmet = entry.gate?.unmet ?? [];
          // The bonus's own friendly name is the most specific title; the item carrying it and
          // an id-derived fallback are progressively blunter instruments for one that has none.
          const title = entry.bonus?.name ?? entry.sources?.[0] ?? fromId(entry.id);
          return {
            raw: entry,
            id: entry.id,
            title,
            qualifier: titleCounts.get(title) > 1 ? conditionSummary(entry) : '',
            sources: entry.sources ?? [],
            slot: this.db.slotById.get(entry.slotId)?.label ?? entry.slotId,
            stacks: entry.stacks ?? 1,
            chose: this.choseLabel(entry.chose),
            payload: entry.active ? entry.appliedStats : entry.previewStats,
            perStack: entry.stacks > 1 ? entry.stats : null,
            unmet,
            nearMiss: !entry.active && !entry.excluded && unmet.length === 1,
            state: entry.excluded ? 'excluded' : (entry.active ? 'active' : 'inactive'),
          };
        });
      },

      filtered() {
        const query = this.query.trim().toLowerCase();
        return this.entries.filter((entry) => {
          if (this.nearMissOnly && !entry.nearMiss) return false;
          if (!query) return true;
          return entry.title.toLowerCase().includes(query)
            || entry.id.toLowerCase().includes(query)
            || entry.sources.some((source) => source.toLowerCase().includes(query));
        });
      },

      groups() {
        const active = this.filtered.filter((entry) => entry.state === 'active');
        const excluded = this.filtered.filter((entry) => entry.state === 'excluded');
        // Fewest unmet conditions first: what you are closest to unlocking is what you want
        // to see, and a bonus failing five conditions is not actionable.
        const inactive = this.filtered.filter((entry) => entry.state === 'inactive')
          .sort((a, b) => a.unmet.length - b.unmet.length || a.title.localeCompare(b.title));
        return [
          { id: 'inactive', label: 'Inactive', list: inactive },
          { id: 'active', label: 'Active', list: active },
          { id: 'excluded', label: 'Excluded', list: excluded },
        ];
      },

      counts() {
        const all = this.entries;
        return {
          total: all.length,
          active: all.filter((entry) => entry.state === 'active').length,
          nearMiss: all.filter((entry) => entry.nearMiss).length,
        };
      },
    },

    methods: {
      choseLabel(chose) {
        if (!chose || chose === 'stats') return '';
        const [kind, index] = chose.split(':');
        if (kind === 'tier') return `${index}-piece`;
        if (kind === 'variant') return `variant ${Number(index) + 1}`;
        return chose;
      },

      statList(stats) {
        if (!stats) return [];
        return Object.entries(stats)
          .map(([key, value]) => `${fmt().label(key)} ${fmt().signedStat(key, value)}`);
      },

      toggle(id) {
        this.open[id] = !this.open[id];
      },
    },

    template: `
      <div class="panel">
        <div class="inspector-head">
          <input class="inspector-search" type="search" v-model="query"
                 placeholder="Filter by bonus, set or item…">
          <div class="panel-meta">
            <span>{{ counts.active }}/{{ counts.total }} active</span>
            <label class="check check--inline">
              <input type="checkbox" v-model="nearMissOnly">
              <span>near misses only ({{ counts.nearMiss }})</span>
            </label>
          </div>
        </div>

        <template v-for="group in groups" :key="group.id">
          <h3 v-if="group.list.length" class="panel-head">
            {{ group.label }} <span class="dim">({{ group.list.length }})</span>
          </h3>

          <div v-for="entry in group.list" :key="entry.id"
               class="bonus" :class="'bonus--' + entry.state">
            <button type="button" class="bonus-head" @click="toggle(entry.id)">
              <span class="bonus-dot"></span>
              <span class="bonus-title">{{ entry.title }}</span>
              <span v-if="entry.qualifier" class="bonus-qualifier" :title="entry.qualifier">
                {{ entry.qualifier }}
              </span>
              <span v-if="entry.nearMiss" class="badge badge--near">1 away</span>
              <span v-if="entry.stacks > 1" class="badge">×{{ entry.stacks }}</span>
              <span v-if="entry.chose" class="badge">{{ entry.chose }}</span>
            </button>

            <!-- The payoff: for an inactive bonus, exactly which conditions failed and what
                 they would need. Rendered verbatim from the engine. -->
            <ul v-if="entry.unmet.length" class="unmet">
              <li v-for="(leaf, i) in entry.unmet" :key="i">
                <span class="unmet-label">{{ leaf.label }}</span>
                <span v-if="leaf.detail" class="unmet-detail">— {{ leaf.detail }}</span>
                <ul v-if="leaf.children?.length" class="unmet-children">
                  <li v-for="(child, j) in leaf.children" :key="j"
                      :class="{ 'is-ok': child.ok }">
                    {{ child.ok ? '✓' : '✗' }} {{ child.label }}
                    <span v-if="child.detail" class="unmet-detail">— {{ child.detail }}</span>
                  </li>
                </ul>
              </li>
            </ul>

            <p v-if="entry.raw.excluded" class="unmet">
              <span class="unmet-label">overridden by</span>
              <span class="unmet-detail">{{ entry.raw.excludedBy }}</span>
            </p>

            <div v-if="open[entry.id]" class="bonus-detail">
              <div class="bonus-stats">
                <span v-for="part in statList(entry.payload)" :key="part" class="bonus-stat">
                  {{ part }}
                </span>
                <span v-if="!statList(entry.payload).length" class="dim">no stat payload</span>
              </div>
              <p v-if="entry.perStack" class="hint">
                per stack: {{ statList(entry.perStack).join(', ') }}
              </p>
              <p class="hint">
                slot {{ entry.slot }} ·
                from {{ entry.sources.join(', ') || '—' }}
              </p>
              <p class="hint mono">{{ entry.id }}</p>
            </div>
          </div>
        </template>

        <p v-if="!filtered.length" class="dim" style="padding:10px 0">
          Nothing matches that filter.
        </p>
      </div>
    `,
  };
})();
