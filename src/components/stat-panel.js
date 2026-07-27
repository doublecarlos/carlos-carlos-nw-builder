// The right column: the sheet's output block, rebuilt (plan §1.3 caps, §1.4 derived).
//
// Every table is derived from `NW_SCHEMA` rather than a hand-written stat list, so adding a
// stat to the schema makes it appear here with no edit. Overcapped values are coloured; the
// rating/percent pair each get their own merged overcap-or-headroom column (signed: positive
// over the cap, negative is spare headroom), coloured independently since they cap separately.

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

  // Above this much wasted rating, the Rating column goes red -- an arbitrary-looking number
  // that exists only to match the threshold the game's own UI uses, for familiarity.
  const RATING_OVER_WARN = 1000;

  const DAMAGE_ROWS = [
    ['Average', 'average'],
    ['Crit / no deflect', 'critNoDeflect'],
    ['Crit / deflect', 'critDeflect'],
    ['No crit / no deflect', 'noCritNoDeflect'],
    ['No crit / deflect', 'noCritDeflect'],
  ];
  const HEALING_ROWS = [['Average', 'average'], ['Crit', 'crit'], ['No crit', 'noCrit']];
  const EHP_ROWS = [['Average', 'average'], ['Crit / no deflect', 'critNoDeflect']];

  // The summary widget's picker spans all three `derived` tables below, not just damage --
  // `source` says which one, and doubles as the row key's namespace since 'average' repeats
  // across all three.
  const SUMMARY_GROUPS = [
    { source: 'damage', label: 'Damage', rows: DAMAGE_ROWS },
    { source: 'healing', label: 'Healing', rows: HEALING_ROWS },
    { source: 'ehp', label: 'EHP', rows: EHP_ROWS },
  ];

  return {
    name: 'StatPanel',

    components: {
      ComboBox: window.NW.components.ComboBox,
    },

    props: {
      result: { type: Object, required: true },
    },

    data: () => ({ showZero: false, damageRows: DAMAGE_ROWS, healingRows: HEALING_ROWS,
      ehpRows: EHP_ROWS, summaryCalcKey: 'damage:average' }),

    computed: {
      stages() { return this.result.stages; },
      derived() { return this.result.derived; },

      /** Options for the summary widget's calculation picker, across all three `derived`
       * tables below (damage, healing, EHP) -- value is `source:key` so `summaryValue` can
       * look the row straight back up. */
      summaryOptions() {
        return SUMMARY_GROUPS.flatMap(({ source, label, rows }) => rows.map(([rowLabel, key]) => (
          { value: `${source}:${key}`, label: `${label} · ${rowLabel}` }
        )));
      },

      summaryValue() {
        const [source, key] = this.summaryCalcKey.split(':');
        return this.derived[source]?.[key] ?? 0;
      },

      /** One row per rating/percent pair, in display order (§ `RATING_ORDER`, UI-only). */
      capRows() {
        return schema().ratingConversion
          .slice()
          .sort((a, b) => orderIndex(a.rating) - orderIndex(b.rating))
          .map((rule) => ({
            key: rule.rating,
            label: schema().statByKey[rule.rating]?.label ?? rule.rating,
            // Rating goes red once its overcap passes RATING_OVER_WARN, matching the game's own
            // in-client display -- percentage has no such threshold, it's green-or-default.
            rating: this.capCell(rule.rating, RATING_OVER_WARN),
            percent: this.capCell(rule.percent),
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

      /** `over` is signed: positive means over the cap, negative means headroom to spare --
       * one merged column instead of the sheet's separate overcap/headroom pair. `capped` is
       * `min(total, cap)`, i.e. what the stat actually contributes once excess is thrown away.
       * `primaryCls`/`overCls` split the colouring in two: Rating/Percentage read green (at or
       * over cap) or default (headroom) -- they already show the effective value, so "over"
       * isn't itself a problem -- while the excess, red when wasted / blue when there's room to
       * spare, lives in the Overcap columns. `redOver` is the one exception: rating alone turns
       * red once its own overcap passes it, to match the game client's own display. */
      capCell(key, redOver = Infinity) {
        const { totals, caps, capped } = this.stages;
        const total = totals[key] ?? 0;
        const cap = caps[key] ?? 0;
        const over = total - cap;
        return {
          key, total, cap, capped: capped[key] ?? total, over,
          primaryCls: over > redOver ? 'is-over' : (over > -1e-9 ? 'is-capped' : ''),
          overCls: over > 1e-9 ? 'is-over' : (over < -1e-9 ? 'is-headroom' : ''),
        };
      },

      visible(value) {
        return this.showZero || Math.abs(value) > 1e-9;
      },

      /** Signed display for a merged overcap/headroom cell: `—` exactly on the cap, otherwise
       * an explicit `+`/`-` since these columns have no other cue for direction. */
      signedPct(value) {
        if (Math.abs(value) < 1e-9) return '—';
        return (value > 0 ? '+' : '') + this.pct(value);
      },
      signedInt(value) {
        if (Math.abs(value) < 1e-9) return '—';
        return (value > 0 ? '+' : '') + this.int(value);
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

        <!-- The one number the sheet keeps most visible: pick a damage calculation, see its
             value here. This will grow a second, comparison value once that feature lands. -->
        <div class="summary-calc">
          <ComboBox class="summary-calc-select" v-model="summaryCalcKey" :options="summaryOptions" />
          <span class="tile-value">{{ int(summaryValue) }}</span>
        </div>

        <div class="panel-meta">
          <span>{{ bonusSummary.active }}/{{ bonusSummary.total }} bonuses active</span>
          <span v-if="bonusSummary.excluded">{{ bonusSummary.excluded }} excluded</span>
          <label class="check check--inline">
            <input type="checkbox" v-model="showZero"><span>show zeroes</span>
          </label>
        </div>

        <table class="stat-table stat-table--pairs">
          <tbody>
            <tr class="is-lead"><td>Item level</td><td class="num">{{ int(derived.itemLevel) }}</td></tr>
            <tr class="is-lead"><td>Hit points</td><td class="num">{{ int(derived.hp) }}</td></tr>
          </tbody>
        </table>

        <h3 class="panel-head">Ratings</h3>
        <table class="stat-table stat-table--split">
          <thead>
            <tr>
              <th>Stat</th>
              <th class="rating-col">Rating</th>
              <th>Percentage</th>
              <th>Overcap %</th>
              <th class="rating-col">Overcap rating</th>
            </tr>
          </thead>
          <tbody>
            <!-- Each cell coloured off its own column's 'over', not the row: rating and
                 percentage cap independently, so one can read green while the other reads
                 red on the same row. -->
            <tr v-for="row in capRows" :key="row.key"
                v-show="visible(row.rating.total)"
                :class="{ 'row-sep': row.sepAfter }">
              <td>{{ row.label }}</td>
              <td class="num rating-col" :class="row.rating.primaryCls">{{ int(row.rating.total) }}</td>
              <td class="num" :class="row.percent.primaryCls">{{ pct(row.percent.capped) }}</td>
              <td class="num dim" :class="row.percent.overCls">{{ signedPct(row.percent.over) }}</td>
              <td class="num dim rating-col" :class="row.rating.overCls">{{ signedInt(row.rating.over) }}</td>
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
