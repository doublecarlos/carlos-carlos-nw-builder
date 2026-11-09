<script setup lang="ts">
// The right column: the sheet's output block, rebuilt.
//
// Every table is derived from NW_SCHEMA rather than a hand-written stat list, so adding a
// stat to the schema makes it appear here with no edit. Overcapped values are colored; the
// rating/percent pair each get their own merged overcap-or-headroom column (signed: positive
// over the cap, negative is spare headroom), colored independently since they cap separately.
import { computed } from "vue";
import CompareSummary from "./game/CompareSummary.vue";
import BaseLink from "./ui/BaseLink.vue";
import StatInfoButton from "./game/StatInfoButton.vue";
import StatPanelSourceCard from "./game/StatPanelSourceCard.vue";
import BasePopover from "./ui/BasePopover.vue";
import BasePanel from "./ui/BasePanel.vue";
import PanelHead from "./ui/PanelHead.vue";
import StatPanelPairsTable from "./game/StatPanelPairsTable.vue";
import CompareLine from "./ui/CompareLine.vue";
import { useStatSourcePopover } from "../composables/useStatSourcePopover";
import { anyPickerOpen } from "../composables/useOpenPickers";
import { NW_SCHEMA } from "../data/data";
import { int as fmtInt, pct as fmtPct, stat as fmtStat } from "../lib/format";
import { delta } from "../lib/compare-delta";
import { DERIVED_TABLES, type DerivedTable } from "../lib/derived-tables";
import * as compare from "../stores/compare";
import * as engine from "../stores/resolved";
import type { Build, EngineError, ResolvedBuild } from "../types";

// Display order only -- data/schema.json stays untouched. Forte sits with the defensive
// ratings rather than right after Severity, per the user's re-grouping.
const RATING_ORDER = [
  "power",
  "acc",
  "ca",
  "strike",
  "severity",
  "defense",
  "awareness",
  "crit_avoid",
  "deflect",
  "deflect_sev",
  "forte",
  "inc_healing",
  "out_healing",
  "control_bonus",
  "control_resist",
];
const orderIndex = (key: string) => {
  const i = RATING_ORDER.indexOf(key);
  return i === -1 ? RATING_ORDER.length : i;
};
// A rule below one of these keys gets a divider, marking the boundary between the offensive
// ratings, the defensive ones and forte.
const SEPARATOR_AFTER = new Set(["severity", "deflect_sev"]);

// Above this much wasted rating, the Rating column goes red -- an arbitrary-looking number
// that exists only to match the threshold the game's own UI uses, for familiarity.
const RATING_OVER_WARN = 1000;

// Only ever mounted when `engine.resolved.value.ok` -- the throw documents
// that invariant instead of a defensive fallback for a state that can't happen.
const result = computed(() => {
  const r = engine.resolved.value;
  if (!r.ok) throw new Error("StatPanel requires a resolved build");
  return r.result;
});
// The compare build, resolved against the same db. `null` means "not comparing".
const compareResult = computed(() =>
  engine.compareResolved.value?.ok ? engine.compareResolved.value.result : null,
);
// Only needed for the compare controls; the rest of the panel reads entirely off `result`.
const props = defineProps<{ build: Build }>();
const build = computed(() => props.build);

// The compare build's own numbers, stacked under this build's inside the same cell (see
// CompareLine.vue). Off unless the user asked for them *and* there is a compare build
// resolved to read from.
const statLines = computed(
  () => build.value.compare.statLines && Boolean(compareResult.value),
);
const compareName = computed(() => compare.compareBuild.value?.name ?? "");
const compareStages = computed(() => compareResult.value?.stages ?? null);
const compareDerived = computed(() => compareResult.value?.derived ?? null);

const stages = computed(() => result.value.stages);
const derived = computed(() => result.value.derived);
const errorList = computed(() =>
  result.value.errors.filter((e) => e.severity !== "warning"),
);
const warningList = computed(() =>
  result.value.errors.filter((e) => e.severity === "warning"),
);
// The message alone doesn't say which slot it's about -- unlike engine.ts's own hardcoded
// checks, a bonus-authored `problem` message is free text the item's author wrote, with no
// guarantee it names the item itself. A problem grant's own `label` (types.ts's
// `GrantProblem.label`) takes precedence when set, since the slot it's attributed to is often
// incidental to what the problem is actually about (e.g. a boon-progression warning).
const slotLabel = (slotId: string) =>
  engine.db.value.slotFor(slotId)?.label ?? slotId;
const errorLabel = (error: EngineError) =>
  error.label ?? slotLabel(error.slotId);

const int = (value: unknown) => fmtInt(value);
const pct = (value: unknown) => fmtPct(value);
const fmt = (key: string, value: unknown) => fmtStat(key, value);

/** `over` is signed: positive means over the cap, negative means headroom to spare --
 * one merged column instead of the sheet's separate overcap/headroom pair. `capped` is
 * `min(total, cap)`, i.e. what the stat actually contributes once excess is thrown away.
 * `primaryCls`/`overCls` split the coloring in two: Rating/Percentage read green (at or
 * over cap) or default (headroom) -- they already show the effective value, so "over"
 * isn't itself a problem -- while the excess, red when wasted / blue when there's room to
 * spare, lives in the Overcap columns. `redOver` is the one exception: rating alone turns
 * red once its own overcap passes it, to match the game client's own display. */
function capCell(
  source: ResolvedBuild["stages"],
  key: string,
  redOver = Infinity,
) {
  const { totals, caps, capped } = source;
  const total = totals[key] ?? 0;
  const cap = caps[key] ?? 0;
  const over = total - cap;
  return {
    key,
    total,
    cap,
    capped: capped[key] ?? total,
    over,
    primaryCls:
      over > redOver
        ? "text-overcapped font-semibold"
        : over > -1e-9
          ? "text-capped font-semibold"
          : "",
    overCls:
      over > 1e-9
        ? "text-overcapped font-semibold"
        : over < -1e-9
          ? "text-capped font-semibold"
          : "",
  };
}

/** One row per rating/percent pair, in display order (§ `RATING_ORDER`, UI-only). */
const capRows = computed(() =>
  NW_SCHEMA.ratingConversion
    .slice()
    .sort((a, b) => orderIndex(a.rating) - orderIndex(b.rating))
    .map((rule) => {
      // Rating goes red once its overcap passes RATING_OVER_WARN, matching the game's own
      // in-client display -- percentage has no such threshold, it's green-or-default.
      const rating = capCell(stages.value, rule.rating, RATING_OVER_WARN);
      const percent = capCell(stages.value, rule.percent);
      return {
        key: rule.rating,
        label: NW_SCHEMA.statByKey[rule.rating]?.label ?? rule.rating,
        rating,
        percent,
        compare: capCompare(rule, rating, percent),
        sepAfter: SEPARATOR_AFTER.has(rule.rating),
      };
    }),
);

/** Everything with no cap of its own: flats, mults and uncapped percents. */
const otherRows = computed(() => {
  const paired = new Set();
  for (const rule of NW_SCHEMA.ratingConversion) {
    paired.add(rule.rating);
    paired.add(rule.percent);
  }
  return NW_SCHEMA.stats
    .filter((stat) => !stat.enemy && !stat.ability && !paired.has(stat.key))
    .map((stat) => ({
      key: stat.key,
      label: stat.label,
      value: fmt(stat.key, stages.value.totals[stat.key] ?? 0),
      compare: statCompare(
        stat.key,
        stages.value.totals[stat.key] ?? 0,
        compareStages.value?.totals[stat.key] ?? 0,
      ),
      infoKey: stat.key,
    }));
});

const abilityRows = computed(() =>
  NW_SCHEMA.stats
    .filter((stat) => stat.ability)
    .map((stat) => ({
      key: stat.key,
      label: stat.label,
      value: int(stages.value.totals[stat.key] ?? 0),
      compare: pairCompare(
        stages.value.totals[stat.key] ?? 0,
        compareStages.value?.totals[stat.key] ?? 0,
        int,
      ),
      infoKey: stat.key,
    })),
);

const enemyRows = computed(() =>
  NW_SCHEMA.stats
    .filter((stat) => stat.enemy)
    // The section heading already says "Enemy"; repeating it in all 13 rows just makes
    // the column wider. Everywhere else the full label is what disambiguates.
    .map((stat) => ({
      key: stat.key,
      label: stat.label.replace(/^Enemy /, ""),
      value: fmt(stat.key, stages.value.totals[stat.key] ?? 0),
      compare: statCompare(
        stat.key,
        stages.value.totals[stat.key] ?? 0,
        compareStages.value?.totals[stat.key] ?? 0,
      ),
      infoKey: stat.key,
    })),
);

const ilHpRows = computed(() => [
  {
    key: "itemLevel",
    label: "Item level",
    value: int(derived.value.itemLevel),
    compare: intCompare(
      derived.value.itemLevel,
      compareDerived.value?.itemLevel,
    ),
    lead: true,
    infoKey: "il",
  },
  {
    key: "hp",
    label: "Hit points",
    value: int(derived.value.hp),
    compare: intCompare(derived.value.hp, compareDerived.value?.hp),
    lead: true,
  },
  {
    key: "baseDamage",
    label: "Damage",
    value: int(derived.value.baseDamage),
    compare: intCompare(
      derived.value.baseDamage,
      compareDerived.value?.baseDamage,
    ),
    lead: true,
  },
]);

// One row per table's own [label, key] cases, plus its fixed top-level extras: the shape
// damage, healing and ehp all share, built once rather than three times. Only the cases carry
// a delta: they are the outcomes worth judging a build by, where a delta on every stat is noise.
function derivedTableRows(group: DerivedTable) {
  const table = derived.value[group.source];
  const compareTable = compareDerived.value?.[group.source];
  const base = group.rows.map(([label, key]) => {
    const compare = intCompare(table[key], compareTable?.[key]);
    return {
      key,
      label,
      value: int(table[key]),
      compare,
      delta: compare ? delta(table[key], compareTable?.[key]) : null,
      lead: key === "average",
    };
  });
  const extras = (group.extra ?? []).map((extra) => {
    const format = extra.format === "int" ? int : pct;
    const mine = derived.value[extra.key];
    const other = compareDerived.value?.[extra.key];
    return {
      key: extra.key,
      label: extra.label,
      value: format(mine),
      compare: pairCompare(mine, other, format),
      muted: true,
    };
  });
  return [...base, ...extras];
}

const [damageTable, healingTable, ehpTable] = DERIVED_TABLES;
const damageTableRows = computed(() => derivedTableRows(damageTable));
const healingTableRows = computed(() => derivedTableRows(healingTable));
const ehpTableRows = computed(() => derivedTableRows(ehpTable));

/** Signed display for a merged overcap/headroom cell: `-` exactly on the cap, otherwise
 * an explicit `+`/`-` since these columns have no other cue for direction. */
function signedPct(value: number) {
  if (Math.abs(value) < 1e-9) return "-";
  return (value > 0 ? "+" : "") + pct(value);
}
function signedInt(value: number) {
  if (Math.abs(value) < 1e-9) return "-";
  return (value > 0 ? "+" : "") + int(value);
}

/** A `StatPanelPairsTable` row's compare line, or `null` for no second line at all -- when the
 * panel isn't comparing, or when the two builds agree and there is nothing worth the height.
 *
 * The compare build's plain value, with no signed delta beside it: a "(-11,709)" suffix is
 * wide enough to drive the whole column wider than this build's own numbers need, which
 * shifts the table's layout the moment the lines are switched on. The two numbers sit one
 * above the other, so the direction is readable without spelling it out. */
function pairCompare(
  mine: number,
  other: number | null | undefined,
  format: (value: number) => string,
) {
  if (!statLines.value || other == null || Math.abs(other - mine) < 1e-9)
    return null;
  return format(other);
}

/** As `pairCompare`, for the whole-number `derived` outputs (item level, HP, damage, EHP). */
function intCompare(mine: number, other: number | null | undefined) {
  return pairCompare(mine, other, int);
}

/** As `pairCompare`, for a schema stat -- formatting follows the stat's own kind. */
function statCompare(
  key: string,
  mine: number,
  other: number | null | undefined,
) {
  return pairCompare(mine, other, (value) => fmt(key, value));
}

/** A ratings row's compare pair, or `null` when the two builds agree on both columns. Gated
 * per row rather than per cell: once a row is showing a second line, the column that didn't
 * move still repeats its value, so the line reads as the compare build's whole row instead
 * of a lone number floating under one column.
 *
 * `cls` is run through `capCell` against the *compare* build's own totals and caps, not
 * inherited from the cell above: the color means "this number is capped/overcapped", so
 * borrowing this build's would state something untrue about the other build. `text-text`
 * resets it when the compare build has headroom and the cell above does not. */
function capCompare(
  rule: { rating: string; percent: string },
  rating: { total: number },
  percent: { capped: number },
) {
  const source = compareStages.value;
  if (!statLines.value || !source) return null;
  const other = {
    rating: capCell(source, rule.rating, RATING_OVER_WARN),
    percent: capCell(source, rule.percent),
  };
  if (
    Math.abs(other.rating.total - rating.total) < 1e-9 &&
    Math.abs(other.percent.capped - percent.capped) < 1e-9
  )
    return null;
  return {
    rating: {
      text: int(other.rating.total),
      cls: other.rating.primaryCls || "text-text",
    },
    percent: {
      text: pct(other.percent.capped),
      cls: other.percent.primaryCls || "text-text",
    },
  };
}

// The stat source popover ("why is this number what it is", per stat) -- source attribution
// itself lives in stat-sources.ts, since it's pure data derivation with no template of its
// own. See useStatSourcePopover for how the card opens, pins and closes.
const {
  tooltip,
  openKey,
  pinned,
  fadeIn,
  pin,
  closeCard,
  onCardEnter,
  onCardLeave,
  openLabel,
  openSections,
  goToSlot,
} = useStatSourcePopover(result);
</script>

<template>
  <BasePanel data-stat-panel>
    <div
      v-if="errorList.length"
      class="mb-2.5 rounded-md bg-danger-soft px-2.5 py-1.5 text-danger"
    >
      <strong>{{ errorList.length }} problem(s)</strong>
      <ul class="mt-1 pl-5">
        <li v-for="error in errorList" :key="error.slotId + error.kind">
          <!-- The label jumps to the slot the problem is about, as a source card's rows do. -->
          <strong
            ><BaseLink
              data-testid="stat-panel-error-link"
              @click="goToSlot(error.slotId)"
              >{{ errorLabel(error) }}</BaseLink
            >:</strong
          >
          {{ error.message }}
        </li>
      </ul>
    </div>

    <div
      v-if="warningList.length"
      class="mb-2.5 rounded-md border border-warn/40 bg-warn/10 px-2.5 py-1.5 text-warn"
    >
      <strong>{{ warningList.length }} warning(s)</strong>
      <ul class="mt-1 pl-5">
        <li v-for="warning in warningList" :key="warning.slotId + warning.kind">
          <strong
            ><BaseLink
              data-testid="stat-panel-warning-link"
              @click="goToSlot(warning.slotId)"
              >{{ errorLabel(warning) }}</BaseLink
            >:</strong
          >
          {{ warning.message }}
        </li>
      </ul>
    </div>

    <CompareSummary
      :build="build"
      :derived="derived"
      :compare-derived="compareDerived"
      :compare-name="compareName"
    />

    <StatPanelPairsTable
      class="my-4"
      :rows="ilHpRows"
      :compare-label="compareName"
    />

    <PanelHead>Ratings</PanelHead>
    <!-- Scrolls on its own below lg, as StatPanelPairsTable's tables do. -->
    <div class="max-lg:overflow-x-auto" data-testid="stat-table-scroll">
      <table class="w-full border-collapse border border-line">
        <thead>
          <tr>
            <td
              colspan="1"
              class="border border-line text-center font-semibold px-1 py-0.5 bg-surface-2/55"
            >
              Stat
            </td>
            <td
              colspan="2"
              class="border border-line text-center font-semibold px-1 py-0.5 bg-surface-2/55"
            >
              Value
            </td>
            <td
              colspan="2"
              class="border border-line text-center font-semibold px-1 py-0.5 bg-surface-2/55"
            >
              Overcap
            </td>
          </tr>
        </thead>
        <tbody>
          <!-- Each cell colored off its own column's 'over', not the row: rating and
             percentage cap independently, so one can read green while the other reads
             red on the same row. -->
          <tr
            v-for="row in capRows"
            :key="row.key"
            class="even:bg-surface-2/55 group hover:outline hover:outline-2 hover:outline-accent max-lg:-outline-offset-2"
            :data-stat-row="row.key"
          >
            <td
              class="border border-line px-1 py-0.5 align-bottom"
              :class="row.sepAfter && 'border-b-2 border-b-text/50'"
            >
              <div class="flex items-center">
                <StatInfoButton :stat-key="row.key" :label="row.label" />
                <span>{{ row.label }}</span>
              </div>
              <CompareLine
                v-if="row.compare"
                text="↳ Other"
                :title="compareName"
                fit-right
              />
            </td>
            <td
              class="border border-line px-1 py-0.5 text-right align-bottom tabular-nums gap-0.5"
              :class="[
                row.rating.primaryCls,
                row.sepAfter && 'border-b-2 border-b-text/50',
              ]"
              data-testid="stat-value"
            >
              {{ int(row.rating.total) }}
              <CompareLine
                v-if="row.compare"
                class="tabular-nums"
                :class="row.compare.rating.cls"
                :text="row.compare.rating.text"
              />
            </td>
            <td
              class="border border-line px-1 py-0.5 text-right align-bottom tabular-nums"
              :class="[
                row.percent.primaryCls,
                row.sepAfter && 'border-b-2 border-b-text/50',
              ]"
            >
              {{ pct(row.percent.capped) }}
              <CompareLine
                v-if="row.compare"
                class="tabular-nums"
                :class="row.compare.percent.cls"
                :text="row.compare.percent.text"
              />
            </td>
            <td
              class="border border-line px-1 py-0.5 text-right align-bottom tabular-nums text-muted"
              :class="[
                row.percent.overCls,
                row.sepAfter && 'border-b-2 border-b-text/50',
              ]"
            >
              {{ signedPct(row.percent.over) }}
              <!-- Keeps this column level with the compared ones beside it. -->
              <span
                v-if="row.compare"
                class="block border-t border-transparent leading-tight"
                aria-hidden="true"
                >&nbsp;</span
              >
            </td>
            <td
              class="border border-line px-1 py-0.5 text-right align-bottom tabular-nums text-muted"
              :class="[
                row.rating.overCls,
                row.sepAfter && 'border-b-2 border-b-text/50',
              ]"
            >
              {{ signedInt(row.rating.over) }}
              <!-- Keeps this column level with the compared ones beside it. -->
              <span
                v-if="row.compare"
                class="block border-t border-transparent leading-tight"
                aria-hidden="true"
                >&nbsp;</span
              >
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <PanelHead>Other stats</PanelHead>
    <StatPanelPairsTable :rows="otherRows" :compare-label="compareName" />

    <PanelHead>Ability scores</PanelHead>
    <StatPanelPairsTable :rows="abilityRows" :compare-label="compareName" />

    <PanelHead>Enemy</PanelHead>
    <StatPanelPairsTable :rows="enemyRows" :compare-label="compareName" />

    <PanelHead>Damage</PanelHead>
    <StatPanelPairsTable
      :rows="damageTableRows"
      :compare-label="compareName"
      data-stat-table="damage"
    />

    <PanelHead>Healing</PanelHead>
    <StatPanelPairsTable
      :rows="healingTableRows"
      :compare-label="compareName"
      data-stat-table="healing"
    />

    <PanelHead>Effective hit points</PanelHead>
    <StatPanelPairsTable
      :rows="ehpTableRows"
      :compare-label="compareName"
      data-stat-table="ehp"
    />

    <BasePopover ref="tooltip" :width="320" :animate="fadeIn">
      <StatPanelSourceCard
        v-if="openKey && !(pinned && anyPickerOpen)"
        :label="openLabel"
        :sections="openSections"
        :db="engine.db.value"
        :pinned="pinned"
        :data-stat-key="openKey"
        @pin="pin"
        @close="closeCard"
        @go-to-slot="goToSlot"
        @mouseenter="onCardEnter"
        @mouseleave="onCardLeave"
      />
    </BasePopover>
  </BasePanel>
</template>
