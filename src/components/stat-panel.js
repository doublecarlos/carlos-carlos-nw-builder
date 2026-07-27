// The right column: the sheet's output block, rebuilt (plan §1.3 caps, §1.4 derived).
//
// Every table is derived from `NW_SCHEMA` rather than a hand-written stat list, so adding a
// stat to the schema makes it appear here with no edit. Overcapped values are coloured; the
// sheet's single signed "overcap" number is split into Overcap and Headroom (engine FIX #2).

window.NW = window.NW ?? {};
window.NW.components = window.NW.components ?? {};

window.NW.components.StatPanel = (() => {
  'use strict';

  const schema = () => window.NW_SCHEMA;

  // Display order only -- `data/schema.js` stays untouched. Forte sits with the defensive
  // ratings rather than right after Severity, per the user's re-grouping.
  const RATING_ORDER = [
    'power', 'acc', 'ca', 'strike', 'severity', 'defense', 'awareness', 'crit_avoid',
    'deflect', 'deflect_sev', 'forte', 'inc_healing', 'out_healing', 'control_bonus',
    'control_resist',
  ];
  const orderIndex = (key) => {
    const i = RATING_ORDER.indexOf(key);
    return i === -1 ? RATING_ORDER.length : i;
  };
  // A rule below one of these keys gets a divider, marking the boundary between the offensive
  // ratings, the defensive ones and forte.
  const SEPARATOR_AFTER = new Set(['severity', 'deflect_sev']);

  const DAMAGE_ROWS = [
    ['Average', 'average'],
    ['Crit / no deflect', 'critNoDeflect'],
    ['Crit / deflect', 'critDeflect'],
    ['No crit / no deflect', 'noCritNoDeflect'],
    ['No crit / deflect', 'noCritDeflect'],
  ];
  const HEALING_ROWS = [['Average', 'average'], ['Crit', 'crit'], ['No crit', 'noCrit']];
  const EHP_ROWS = [['Average', 'average'], ['Crit / no deflect', 'critNoDeflect']];

  return {
    name: 'StatPanel',

    props: {
      result: { type: Object, required: true },
    },

    data: () => ({ showZero: false, damageRows: DAMAGE_ROWS, healingRows: HEALING_ROWS,
      ehpRows: EHP_ROWS }),

    computed: {
      stages() { return this.result.stages; },
      derived() { return this.result.derived; },

      /** One row per rating/percent pair, in display order (§ `RATING_ORDER`, UI-only). */
      capRows() {
        return schema().ratingConversion
          .slice()
          .sort((a, b) => orderIndex(a.rating) - orderIndex(b.rating))
          .map((rule) => ({
            label: schema().statByKey[rule.rating]?.label ?? rule.rating,
            rating: this.capRow(rule.rating),
            percent: this.capRow(rule.percent),
            sepAfter: SEPARATOR_AFTER.has(rule.rating),
          }));
      },

      /** Everything with no cap of its own: flats, mults and uncapped percents. */
      otherRows() {
        const paired = new Set();
        for (const rule of schema().ratingConversion) {
          paired.add(rule.rating);
          paired.add(rule.percent);
        }
        return schema().stats
          .filter((stat) => !stat.enemy && !stat.ability && !paired.has(stat.key))
          .map((stat) => ({ key: stat.key, label: stat.label,
            value: this.stages.totals[stat.key] ?? 0 }));
      },

      abilityRows() {
        return schema().stats
          .filter((stat) => stat.ability)
          .map((stat) => ({ key: stat.key, label: stat.label,
            value: this.stages.totals[stat.key] ?? 0 }));
      },

      enemyRows() {
        return schema().stats
          .filter((stat) => stat.enemy)
          // The section heading already says "Enemy"; repeating it in all 13 rows just makes
          // the column wider. Everywhere else the full label is what disambiguates.
          .map((stat) => ({ key: stat.key, label: stat.label.replace(/^Enemy /, ''),
            value: this.stages.totals[stat.key] ?? 0 }));
      },

      bonusSummary() {
        const all = this.result.bonuses;
        return {
          total: all.length,
          active: all.filter((bonus) => bonus.active).length,
          excluded: all.filter((bonus) => bonus.excluded).length,
        };
      },
    },

    methods: {
      int: (value) => window.NW.format.int(value),
      pct: (value) => window.NW.format.pct(value),
      fmt: (key, value) => window.NW.format.stat(key, value),

      capRow(key) {
        const { totals, caps, overcap, headroom } = this.stages;
        return {
          key,
          total: totals[key] ?? 0,
          cap: caps[key] ?? 0,
          over: overcap[key] ?? 0,
          head: headroom[key] ?? 0,
        };
      },

      visible(value) {
        return this.showZero || Math.abs(value) > 1e-9;
      },

      /** Google Sheets-style conditional formatting: green sitting exactly on the cap, blue
       * with room to spare, the existing warn colour when over. `over`/`head` can't both be
       * positive -- they are max(0, total-cap) and max(0, cap-total). */
      capClass(cell) {
        if (cell.over > 0) return 'is-over';
        if (cell.head > 0) return 'is-headroom';
        return 'is-capped';
      },
    },

    template: `
      <div class="panel">
        <div v-if="result.errors.length" class="panel-errors">
          <strong>{{ result.errors.length }} problem(s)</strong>
          <ul>
            <li v-for="error in result.errors" :key="error.slotId + error.kind">
              {{ error.message }}
            </li>
          </ul>
        </div>

        <div class="tiles">
          <div class="tile">
            <span class="tile-label">Item level</span>
            <span class="tile-value">{{ int(derived.itemLevel) }}</span>
          </div>
          <div class="tile">
            <span class="tile-label">Hit points</span>
            <span class="tile-value">{{ int(derived.hp) }}</span>
          </div>
          <div class="tile">
            <span class="tile-label">Damage</span>
            <span class="tile-value">{{ int(derived.damage.average) }}</span>
          </div>
          <div class="tile">
            <span class="tile-label">Healing</span>
            <span class="tile-value">{{ int(derived.healing.average) }}</span>
          </div>
          <div class="tile">
            <span class="tile-label">EHP</span>
            <span class="tile-value">{{ int(derived.ehp.average) }}</span>
          </div>
        </div>

        <div class="panel-meta">
          <span>{{ bonusSummary.active }}/{{ bonusSummary.total }} bonuses active</span>
          <span v-if="bonusSummary.excluded">{{ bonusSummary.excluded }} excluded</span>
          <label class="check check--inline">
            <input type="checkbox" v-model="showZero"><span>show zeroes</span>
          </label>
        </div>

        <h3 class="panel-head">Ratings</h3>
        <table class="stat-table stat-table--split">
          <thead>
            <tr>
              <th></th>
              <th colspan="3" class="group-head">Percent</th>
              <th colspan="3" class="group-head group-head--rating">Rating</th>
            </tr>
            <tr>
              <th>Stat</th>
              <th>Total</th>
              <th>Overcap</th>
              <th>Headroom</th>
              <th class="rating-col">Total</th>
              <th class="rating-col">Overcap</th>
              <th class="rating-col">Headroom</th>
            </tr>
          </thead>
          <tbody>
            <!-- Coloured by the rating cell; percent and rating agree on cap status in
                 practice, and a row can only have one background. -->
            <tr v-for="row in capRows" :key="row.rating.key"
                v-show="visible(row.rating.total)"
                :class="[capClass(row.rating), { 'row-sep': row.sepAfter }]">
              <td>{{ row.label }}</td>
              <td class="num">{{ pct(row.percent.total) }}</td>
              <td class="num over">{{ row.percent.over > 0 ? pct(row.percent.over) : '—' }}</td>
              <td class="num dim">{{ row.percent.head > 0 ? pct(row.percent.head) : '—' }}</td>
              <td class="num dim rating-col">{{ int(row.rating.total) }}</td>
              <td class="num dim rating-col over">
                {{ row.rating.over > 0 ? int(row.rating.over) : '—' }}
              </td>
              <td class="num dim rating-col">{{ row.rating.head > 0 ? int(row.rating.head) : '—' }}</td>
            </tr>
          </tbody>
        </table>

        <h3 class="panel-head">Other stats</h3>
        <table class="stat-table stat-table--pairs">
          <tbody>
            <tr v-for="row in otherRows" :key="row.key" v-show="visible(row.value)">
              <td>{{ row.label }}</td>
              <td class="num">{{ fmt(row.key, row.value) }}</td>
            </tr>
          </tbody>
        </table>

        <h3 class="panel-head">Ability scores</h3>
        <table class="stat-table stat-table--pairs">
          <tbody>
            <tr v-for="row in abilityRows" :key="row.key">
              <td>{{ row.label }}</td>
              <td class="num">{{ int(row.value) }}</td>
            </tr>
          </tbody>
        </table>

        <h3 class="panel-head">Enemy</h3>
        <table class="stat-table stat-table--pairs">
          <tbody>
            <tr v-for="row in enemyRows" :key="row.key" v-show="visible(row.value)">
              <td>{{ row.label }}</td>
              <td class="num">{{ fmt(row.key, row.value) }}</td>
            </tr>
          </tbody>
        </table>

        <h3 class="panel-head">Damage</h3>
        <table class="stat-table stat-table--pairs">
          <tbody>
            <tr v-for="[label, key] in damageRows" :key="key"
                :class="{ 'is-lead': key === 'average' }">
              <td>{{ label }}</td>
              <td class="num">{{ int(derived.damage[key]) }}</td>
            </tr>
            <tr><td class="dim">Base damage</td><td class="num dim">{{ int(derived.baseDamage) }}</td></tr>
            <tr>
              <td class="dim">Effective magical/physical</td>
              <td class="num dim">{{ pct(derived.effectiveMagPhys) }}</td>
            </tr>
          </tbody>
        </table>

        <h3 class="panel-head">Healing</h3>
        <table class="stat-table stat-table--pairs">
          <tbody>
            <tr v-for="[label, key] in healingRows" :key="key"
                :class="{ 'is-lead': key === 'average' }">
              <td>{{ label }}</td>
              <td class="num">{{ int(derived.healing[key]) }}</td>
            </tr>
            <tr>
              <td class="dim">Overall outgoing healing</td>
              <td class="num dim">{{ pct(derived.overallHealing) }}</td>
            </tr>
          </tbody>
        </table>

        <h3 class="panel-head">Effective hit points</h3>
        <table class="stat-table stat-table--pairs">
          <tbody>
            <tr v-for="[label, key] in ehpRows" :key="key"
                :class="{ 'is-lead': key === 'average' }">
              <td>{{ label }}</td>
              <td class="num">{{ int(derived.ehp[key]) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `,
  };
})();
