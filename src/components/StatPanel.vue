<script setup lang="ts">
// The right column: the sheet's output block, rebuilt (plan §1.3 caps, §1.4 derived).
//
// Every table is derived from NW_SCHEMA rather than a hand-written stat list, so adding a
// stat to the schema makes it appear here with no edit. Overcapped values are coloured; the
// rating/percent pair each get their own merged overcap-or-headroom column (signed: positive
// over the cap, negative is spare headroom), coloured independently since they cap separately.
import { ref, computed, nextTick, onMounted, onUnmounted } from 'vue';
import ComboBox from './ComboBox.vue';
import IconButton from './IconButton.vue';
import StatSourceCard from './StatSourceCard.vue';
import { sectionsFor } from '../stat-sources';
import { NW_SCHEMA } from '../data';
import { int as fmtInt, pct as fmtPct, stat as fmtStat } from '../format';
import type { ResolvedBuild, Build } from '../types';

// Display order only -- data/schema.json stays untouched. Forte sits with the defensive
// ratings rather than right after Severity, per the user's re-grouping.
const RATING_ORDER = [
  'power', 'acc', 'ca', 'strike', 'severity', 'defense', 'awareness', 'crit_avoid',
  'deflect', 'deflect_sev', 'forte', 'inc_healing', 'out_healing', 'control_bonus',
  'control_resist',
];
const orderIndex = (key: string) => {
  const i = RATING_ORDER.indexOf(key);
  return i === -1 ? RATING_ORDER.length : i;
};
// A rule below one of these keys gets a divider, marking the boundary between the offensive
// ratings, the defensive ones and forte.
const SEPARATOR_AFTER = new Set(['severity', 'deflect_sev']);

// Above this much wasted rating, the Rating column goes red -- an arbitrary-looking number
// that exists only to match the threshold the game's own UI uses, for familiarity.
const RATING_OVER_WARN = 1000;

const damageRows: [string, string][] = [
  ['Average', 'average'],
  ['Crit / no deflect', 'critNoDeflect'],
  ['Crit / deflect', 'critDeflect'],
  ['No crit / no deflect', 'noCritNoDeflect'],
  ['No crit / deflect', 'noCritDeflect'],
];
const healingRows: [string, string][] = [['Average', 'average'], ['Crit', 'crit'], ['No crit', 'noCrit']];
const ehpRows: [string, string][] = [['Average', 'average'], ['Crit / no deflect', 'critNoDeflect']];

// The summary widget's picker spans all three `derived` tables below, not just damage --
// `source` says which one, and doubles as the row key's namespace since 'average' repeats
// across all three.
const SUMMARY_GROUPS = [
  { source: 'damage', label: 'Damage', rows: damageRows },
  { source: 'healing', label: 'Healing', rows: healingRows },
  { source: 'ehp', label: 'EHP', rows: ehpRows },
];

const props = withDefaults(defineProps<{
  result: ResolvedBuild;
  // The sheet-style compare row under the picker: another build's own `derived`, resolved
  // by App.vue against the same db. `null` means "not comparing" and the widget collapses
  // back to a single centred value.
  compareResult?: ResolvedBuild | null;
  compareName?: string;
  // Only needed for the stat source popover's forte picks and dynamic weapon mod values --
  // the rest of the panel reads entirely off `result`.
  build?: Build | null;
}>(), {
  compareResult: null,
  compareName: '',
  build: null,
});

const summaryCalcKey = ref('damage:average');

const stages = computed(() => props.result.stages);
const derived = computed(() => props.result.derived);

/** Options for the summary widget's calculation picker, across all three `derived`
 * tables below (damage, healing, EHP) -- value is `source:key` so `summaryValue` can
 * look the row straight back up. */
const summaryOptions = SUMMARY_GROUPS.flatMap(({ source, label, rows }) => rows.map(([rowLabel, key]) => (
  { value: `${source}:${key}`, label: `${label} · ${rowLabel}` }
)));

// `derived`'s top-level fields are heterogeneous (itemLevel: number, damage: DamageOutputs,
// ...), so a dynamic `source` key (from the summary picker's `source:key` value) can't be
// looked up without a cast -- each of the three sub-tables it can name is number-valued
// throughout, hence `Record<string, number>` rather than `unknown`.
const summaryValue = computed(() => {
  const [source, key] = summaryCalcKey.value.split(':');
  return (derived.value as unknown as Record<string, Record<string, number>>)[source]?.[key] ?? 0;
});

const compareSummaryValue = computed(() => {
  if (!props.compareResult) return null;
  const [source, key] = summaryCalcKey.value.split(':');
  return (props.compareResult.derived as unknown as Record<string, Record<string, number>>)[source]?.[key] ?? 0;
});

/** `value` relative to `base`, signed: positive means `value` is the bigger of the two.
 * `null` when there's nothing to compare against (no compare build) or `base` is zero
 * (nothing to be a percentage of). */
function relativePct(base: number | null, value: number | null) {
  if (base == null || value == null || Math.abs(base) < 1e-9) return null;
  return (value - base) / Math.abs(base);
}

/** Sheet-style: each row's percentage reads relative to the *other* row, not a shared
 * baseline -- "this build" is +9% over the compare build, and read the other way round
 * the compare build is some different, smaller magnitude under this one. */
const thisVsOtherPct = computed(() => relativePct(compareSummaryValue.value, summaryValue.value));
const otherVsThisPct = computed(() => relativePct(summaryValue.value, compareSummaryValue.value));

/** Green ahead of the compare build, red behind it, plain exactly even -- only "this
 * build"'s own row reads this; the compare row is informational, not judged. */
const summaryRowCls = computed(() => {
  const pctVal = thisVsOtherPct.value;
  if (pctVal == null || Math.abs(pctVal) < 1e-9) return '';
  return pctVal > 0 ? 'is-positive' : 'is-negative';
});

const int = (value: unknown) => fmtInt(value);
const pct = (value: unknown) => fmtPct(value);
const fmt = (key: string, value: unknown) => fmtStat(key, value);

/** `over` is signed: positive means over the cap, negative means headroom to spare --
 * one merged column instead of the sheet's separate overcap/headroom pair. `capped` is
 * `min(total, cap)`, i.e. what the stat actually contributes once excess is thrown away.
 * `primaryCls`/`overCls` split the colouring in two: Rating/Percentage read green (at or
 * over cap) or default (headroom) -- they already show the effective value, so "over"
 * isn't itself a problem -- while the excess, red when wasted / blue when there's room to
 * spare, lives in the Overcap columns. `redOver` is the one exception: rating alone turns
 * red once its own overcap passes it, to match the game client's own display. */
function capCell(key: string, redOver = Infinity) {
  const { totals, caps, capped } = stages.value;
  const total = totals[key] ?? 0;
  const cap = caps[key] ?? 0;
  const over = total - cap;
  return {
    key, total, cap, capped: capped[key] ?? total, over,
    primaryCls: over > redOver ? 'is-over' : (over > -1e-9 ? 'is-capped' : ''),
    overCls: over > 1e-9 ? 'is-over' : (over < -1e-9 ? 'is-headroom' : ''),
  };
}

/** One row per rating/percent pair, in display order (§ `RATING_ORDER`, UI-only). */
const capRows = computed(() => NW_SCHEMA.ratingConversion
  .slice()
  .sort((a, b) => orderIndex(a.rating) - orderIndex(b.rating))
  .map((rule) => ({
    key: rule.rating,
    label: NW_SCHEMA.statByKey[rule.rating]?.label ?? rule.rating,
    // Rating goes red once its overcap passes RATING_OVER_WARN, matching the game's own
    // in-client display -- percentage has no such threshold, it's green-or-default.
    rating: capCell(rule.rating, RATING_OVER_WARN),
    percent: capCell(rule.percent),
    sepAfter: SEPARATOR_AFTER.has(rule.rating),
  })));

/** Everything with no cap of its own: flats, mults and uncapped percents. */
const otherRows = computed(() => {
  const paired = new Set();
  for (const rule of NW_SCHEMA.ratingConversion) {
    paired.add(rule.rating);
    paired.add(rule.percent);
  }
  return NW_SCHEMA.stats
    .filter((stat) => !stat.enemy && !stat.ability && !paired.has(stat.key))
    .map((stat) => ({ key: stat.key, label: stat.label,
      value: stages.value.totals[stat.key] ?? 0 }));
});

const abilityRows = computed(() => NW_SCHEMA.stats
  .filter((stat) => stat.ability)
  .map((stat) => ({ key: stat.key, label: stat.label,
    value: stages.value.totals[stat.key] ?? 0 })));

const enemyRows = computed(() => NW_SCHEMA.stats
  .filter((stat) => stat.enemy)
  // The section heading already says "Enemy"; repeating it in all 13 rows just makes
  // the column wider. Everywhere else the full label is what disambiguates.
  .map((stat) => ({ key: stat.key, label: stat.label.replace(/^Enemy /, ''),
    value: stages.value.totals[stat.key] ?? 0 })));

const bonusSummary = computed(() => {
  const all = props.result.bonuses;
  return {
    total: all.length,
    active: all.filter((bonus) => bonus.active).length,
    excluded: all.filter((bonus) => bonus.excluded).length,
  };
});

function fmtPctSigned(value: number | null) {
  if (value == null || Math.abs(value) < 1e-9) return '—';
  return (value > 0 ? '+' : '') + pct(value);
}

/** Signed display for a merged overcap/headroom cell: `—` exactly on the cap, otherwise
 * an explicit `+`/`-` since these columns have no other cue for direction. */
function signedPct(value: number) {
  if (Math.abs(value) < 1e-9) return '—';
  return (value > 0 ? '+' : '') + pct(value);
}
function signedInt(value: number) {
  if (Math.abs(value) < 1e-9) return '—';
  return (value > 0 ? '+' : '') + int(value);
}

// The stat source popover ("why is this number what it is", per stat) -- source attribution
// itself lives in stat-sources.ts, since it's pure data derivation with no template of its
// own. Click-triggered (a circle-alert button ahead of each row's label), not hover-triggered:
// a dense stat table put the pointer's path from a row to its own hover card through *other*
// rows' triggers often enough that a hover card kept getting swapped out from under the
// pointer before it ever arrived -- a deliberate click has no such transit to go wrong.
const root = ref<HTMLElement | null>(null);
const CARD_W = 260;   // must match StatSourceCard.vue's own width

interface OpenCard { key: string; left: number; top: number }
const openCard = ref<OpenCard | null>(null);

const openLabel = computed(() => NW_SCHEMA.statByKey[openCard.value?.key ?? '']?.label ?? openCard.value?.key ?? '');
const openSections = computed(() => (
  openCard.value ? sectionsFor(props.result, props.build, openCard.value.key) : []
));

/**
 * Anchored to the trigger button: to its right normally, flipped to its left if that would
 * run off the viewport. The vertical flip needs the card's real height, not its CSS
 * max-height, so it's measured once the card exists and nudged only if it actually overflows
 * -- same two-step approach as SlotList.vue's own item hover card.
 */
function placeCard(key: string, rect: DOMRect) {
  const margin = 10;
  let left = rect.right + 8;
  if (left + CARD_W > window.innerWidth - margin) left = rect.left - CARD_W - 8;
  openCard.value = { key, left: Math.max(left, margin), top: rect.top };

  nextTick(() => {
    const card = root.value?.querySelector('.statcard') as HTMLElement | null;
    if (!card || !openCard.value) return;
    const height = card.offsetHeight;
    if (openCard.value.top + height <= window.innerHeight - margin) return;
    openCard.value = { ...openCard.value, top: Math.max(window.innerHeight - margin - height, margin) };
  });
}

function closeCard() {
  openCard.value = null;
}

/** A second click on the same row's own button closes it again; a click on a *different*
 * row's button just switches the card straight over. */
function toggleCard(event: MouseEvent, key: string) {
  if (openCard.value?.key === key) {
    closeCard();
    return;
  }
  placeCard(key, (event.currentTarget as HTMLElement).getBoundingClientRect());
}

/**
 * Closes the popover on any click outside it -- same pattern as SlotList.vue's own "copy
 * section from" popover. `composedPath()`, not a live `closest()` walk, for the same reason
 * documented there: a click that lands on a *different* row's trigger button must reach
 * `toggleCard` and switch the card over, not have this handler close it first.
 */
function onDocumentClick(event: MouseEvent) {
  if (!openCard.value) return;
  const path = event.composedPath?.() ?? [];
  if (path.some((el) => (el as Element).classList?.contains?.('statcard')
    || (el as Element).classList?.contains?.('stat-info-btn'))) return;
  closeCard();
}

onMounted(() => document.addEventListener('mousedown', onDocumentClick));
onUnmounted(() => document.removeEventListener('mousedown', onDocumentClick));
</script>

<template>
  <div class="panel" ref="root">
    <div v-if="result.errors.length" class="panel-errors">
      <strong>{{ result.errors.length }} problem(s)</strong>
      <ul>
        <li v-for="error in result.errors" :key="error.slotId + error.kind">
          {{ error.message }}
        </li>
      </ul>
    </div>

    <!-- The one number the sheet keeps most visible: pick a damage calculation, see its
         value here. With a compare build selected (App.vue's quick-compare picker) this
         grows the sheet's own layout -- this build's row, then the other's, then how far
         apart they are. -->
    <div class="summary-calc">
      <ComboBox class="summary-calc-select" v-model="summaryCalcKey" :options="summaryOptions" />

      <span v-if="!compareResult" class="tile-value">{{ int(summaryValue) }}</span>

      <table v-else class="stat-table summary-compare">
        <tbody>
          <tr :class="summaryRowCls">
            <td>This build</td>
            <td class="num summary-compare-value">{{ int(summaryValue) }}</td>
            <td class="num">{{ fmtPctSigned(thisVsOtherPct) }}</td>
          </tr>
          <tr>
            <td>{{ compareName }}</td>
            <td class="num summary-compare-value">{{ int(compareSummaryValue) }}</td>
            <td class="num dim">{{ fmtPctSigned(otherVsThisPct) }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="panel-meta">
      <span>{{ bonusSummary.active }}/{{ bonusSummary.total }} bonuses active</span>
      <span v-if="bonusSummary.excluded">{{ bonusSummary.excluded }} excluded</span>
    </div>

    <table class="stat-table stat-table--pairs">
      <tbody>
        <tr class="is-lead"><td>Item level</td><td class="num">{{ int(derived.itemLevel) }}</td></tr>
        <tr class="is-lead"><td>Hit points</td><td class="num">{{ int(derived.hp) }}</td></tr>
      </tbody>
    </table>

    <h3 class="panel-head">Ratings</h3>
    <table class="stat-table stat-table--split rating-table">
      <tbody>
        <!-- Each cell coloured off its own column's 'over', not the row: rating and
             percentage cap independently, so one can read green while the other reads
             red on the same row. -->
        <tr v-for="row in capRows" :key="row.key"
            :class="{ 'row-sep': row.sepAfter }">
          <td class="stat-label-cell">
            <IconButton icon="circle-alert" title="Show contributing sources" class="stat-info-btn"
                        :data-stat-key="row.key" @click="toggleCard($event, row.key)" />
            <span>{{ row.label }}</span>
          </td>
          <td class="num" :class="row.rating.primaryCls">{{ int(row.rating.total) }}</td>
          <td class="num" :class="row.percent.primaryCls">{{ pct(row.percent.capped) }}</td>
          <td class="num dim" :class="row.percent.overCls">{{ signedPct(row.percent.over) }}</td>
          <td class="num dim" :class="row.rating.overCls">{{ signedInt(row.rating.over) }}</td>
        </tr>
      </tbody>
    </table>

    <h3 class="panel-head">Other stats</h3>
    <table class="stat-table stat-table--pairs">
      <tbody>
        <tr v-for="row in otherRows" :key="row.key">
          <td class="stat-label-cell">
            <IconButton icon="circle-alert" title="Show contributing sources" class="stat-info-btn"
                        :data-stat-key="row.key" @click="toggleCard($event, row.key)" />
            <span>{{ row.label }}</span>
          </td>
          <td class="num">{{ fmt(row.key, row.value) }}</td>
        </tr>
      </tbody>
    </table>

    <h3 class="panel-head">Ability scores</h3>
    <table class="stat-table stat-table--pairs">
      <tbody>
        <tr v-for="row in abilityRows" :key="row.key">
          <td class="stat-label-cell">
            <IconButton icon="circle-alert" title="Show contributing sources" class="stat-info-btn"
                        :data-stat-key="row.key" @click="toggleCard($event, row.key)" />
            <span>{{ row.label }}</span>
          </td>
          <td class="num">{{ int(row.value) }}</td>
        </tr>
      </tbody>
    </table>

    <h3 class="panel-head">Enemy</h3>
    <table class="stat-table stat-table--pairs">
      <tbody>
        <tr v-for="row in enemyRows" :key="row.key">
          <td class="stat-label-cell">
            <IconButton icon="circle-alert" title="Show contributing sources" class="stat-info-btn"
                        :data-stat-key="row.key" @click="toggleCard($event, row.key)" />
            <span>{{ row.label }}</span>
          </td>
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

    <StatSourceCard v-if="openCard" :label="openLabel" :sections="openSections"
                    :data-stat-key="openCard.key"
                    :style="{ left: openCard.left + 'px', top: openCard.top + 'px' }"
                    @close="closeCard" />
  </div>
</template>

<style scoped>
.panel-errors {
  background: var(--danger-soft);
  border-radius: var(--radius);
  color: var(--danger);
  margin-bottom: 10px;
  padding: 7px 10px;
}
.panel-errors ul { margin: 4px 0 0; padding-left: 18px; }

/* The summary widget: pick a damage calculation, see it front and centre -- the sheet's most
 * visible number, where the IL/HP tiles used to sit. Picker on its own row, the value stacked
 * below and centred -- closer to the sheet's own layout than a side-by-side row. */
.summary-calc {
  background: var(--surface-2);
  border-radius: var(--radius);
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
}
.summary-calc-select { width: 100%; }
.tile-value { font-size: 1.6rem; font-weight: 600; text-align: center; white-space: nowrap; }

/* The compare-mode layout: this build's row, the other build's row, its Δ% in the third
 * column -- the sheet's own compare block, label/value/percentage. `.stat-table`'s own font
 * size is too small for what is still meant to be the headline number, so the value column
 * gets `.tile-value`'s treatment (just a size down, to fit two rows instead of one). */
.summary-compare { margin-top: 2px; }
.summary-compare td { padding: 3px 4px; }
.summary-compare td:first-child { color: var(--muted); }
.summary-compare-value { font-size: 1.25rem; font-weight: 600; }
/* Only "this build"'s own row is judged -- ahead (green) or behind (red) the compare build --
 * the label cell stays muted regardless via `:not(:first-child)`, so it never fights the
 * `td:first-child` rule above on specificity. */
.summary-compare tr.is-positive td:not(:first-child) { color: var(--ok); font-weight: 600; }
.summary-compare tr.is-negative td:not(:first-child) { color: var(--danger); font-weight: 600; }

.stat-table {
  border: 1px solid var(--line);
  border-collapse: collapse;
  width: 100%;
}

.stat-table.rating-table td {
  border: 1px solid var(--line);
}

.stat-table td { padding: 2px 4px;}
.stat-table td.num { text-align: right; }

/* The label cell now carries the "show sources" trigger ahead of its text -- a plain
 * `display: flex` on the `<td>` itself, same trick `.slot-label-col` uses in SlotList.vue. */
.stat-label-cell { align-items: center; display: flex; gap: 2px; }
.stat-info-btn { flex: none; }
.stat-table tbody tr:nth-child(even) { background: color-mix(in srgb, var(--surface-2) 55%, transparent); }

.stat-table td.is-capped { background: color-mix(in srgb, var(--ok) 16%, transparent); }
.stat-table td.is-headroom { background: color-mix(in srgb, var(--accent) 12%, transparent); }
.stat-table td.is-over { background: color-mix(in srgb, var(--warn) 14%, transparent); font-weight: 600; }

.stat-table tr.is-lead td { font-weight: 600; }
.stat-table tr.row-sep td { border-bottom: 2px solid var(--line); }

.stat-table tr:hover {
  outline: 2px solid black;
}

.panel-head {
  border: none;
}
</style>
