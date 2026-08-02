<script setup lang="ts">
// The right column: the sheet's output block, rebuilt.
//
// Every table is derived from NW_SCHEMA rather than a hand-written stat list, so adding a
// stat to the schema makes it appear here with no edit. Overcapped values are coloured; the
// rating/percent pair each get their own merged overcap-or-headroom column (signed: positive
// over the cap, negative is spare headroom), coloured independently since they cap separately.
import { ref, computed } from "vue";
import { onClickOutside } from "@vueuse/core";
import ComboBox from "./ui/ComboBox.vue";
import BaseCheckbox from "./ui/BaseCheckbox.vue";
import IconButton from "./ui/IconButton.vue";
import StatSourceCard from "./game/StatSourceCard.vue";
import BaseTooltip from "./ui/BaseTooltip.vue";
import BasePanel from "./ui/BasePanel.vue";
import PanelHead from "./ui/PanelHead.vue";
import StatPairsTable from "./ui/StatPairsTable.vue";
import { sectionsFor } from "../engine/stat-sources";
import { NW_SCHEMA } from "../data/data";
import { int as fmtInt, pct as fmtPct, stat as fmtStat } from "../lib/format";
import * as builds from "../stores/builds";
import * as compare from "../stores/compare";
import * as engine from "../stores/resolved";

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

const damageRows: [string, string][] = [
  ["Average", "average"],
  ["Crit / no deflect", "critNoDeflect"],
  ["Crit / deflect", "critDeflect"],
  ["No crit / no deflect", "noCritNoDeflect"],
  ["No crit / deflect", "noCritDeflect"],
];
const healingRows: [string, string][] = [
  ["Average", "average"],
  ["Crit", "crit"],
  ["No crit", "noCrit"],
];
const ehpRows: [string, string][] = [
  ["Average", "average"],
  ["Crit / no deflect", "critNoDeflect"],
];

// The summary widget's picker spans all three `derived` tables below, not just damage --
// `source` says which one, and doubles as the row key's namespace since 'average' repeats
// across all three.
const SUMMARY_GROUPS = [
  { source: "damage", label: "Damage", rows: damageRows },
  { source: "healing", label: "Healing", rows: healingRows },
  { source: "ehp", label: "EHP", rows: ehpRows },
];

// Only ever mounted when `engine.resolved.value.ok` -- the throw documents
// that invariant instead of a defensive fallback for a state that can't happen.
const result = computed(() => {
  const r = engine.resolved.value;
  if (!r.ok) throw new Error("StatPanel requires a resolved build");
  return r.result;
});
// The sheet-style compare row under the picker: another build's own `derived`, resolved
// against the same db. `null` means "not comparing" and the widget collapses back to a
// single centred value.
const compareResult = computed(() =>
  engine.compareResolved.value?.ok ? engine.compareResolved.value.result : null,
);
// Only needed for the stat source popover's forte picks and dynamic weapon mod values -- the
// rest of the panel reads entirely off `result`.
const build = builds.build;

const summaryCalcKey = ref("damage:average");

const stages = computed(() => result.value.stages);
const derived = computed(() => result.value.derived);

/** Options for the summary widget's calculation picker, across all three `derived`
 * tables below (damage, healing, EHP) -- value is `source:key` so `summaryValue` can
 * look the row straight back up. */
const summaryOptions = SUMMARY_GROUPS.flatMap(({ source, label, rows }) =>
  rows.map(([rowLabel, key]) => ({
    value: `${source}:${key}`,
    label: `${label} · ${rowLabel}`,
  })),
);

// `derived`'s top-level fields are heterogeneous (itemLevel: number, damage: DamageOutputs,
// ...), so a dynamic `source` key (from the summary picker's `source:key` value) can't be
// looked up without a cast -- each of the three sub-tables it can name is number-valued
// throughout, hence `Record<string, number>` rather than `unknown`.
const summaryValue = computed(() => {
  const [source, key] = summaryCalcKey.value.split(":");
  return (
    (derived.value as unknown as Record<string, Record<string, number>>)[
      source
    ]?.[key] ?? 0
  );
});

const compareSummaryValue = computed(() => {
  if (!compareResult.value) return null;
  const [source, key] = summaryCalcKey.value.split(":");
  return (
    (
      compareResult.value.derived as unknown as Record<
        string,
        Record<string, number>
      >
    )[source]?.[key] ?? 0
  );
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
const thisVsOtherPct = computed(() =>
  relativePct(compareSummaryValue.value, summaryValue.value),
);
const otherVsThisPct = computed(() =>
  relativePct(summaryValue.value, compareSummaryValue.value),
);

/** Green ahead of the compare build, red behind it, plain exactly even -- only "this
 * build"'s own row reads this; the compare row is informational, not judged. */
const summaryRowCls = computed(() => {
  const pctVal = thisVsOtherPct.value;
  if (pctVal == null || Math.abs(pctVal) < 1e-9) return "";
  return pctVal > 0 ? "text-ok font-semibold" : "text-danger font-semibold";
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
    key,
    total,
    cap,
    capped: capped[key] ?? total,
    over,
    primaryCls:
      over > redOver
        ? "bg-warn/15 font-semibold"
        : over > -1e-9
          ? "bg-ok/15"
          : "",
    overCls:
      over > 1e-9
        ? "bg-warn/15 font-semibold"
        : over < -1e-9
          ? "bg-accent/10"
          : "",
  };
}

/** One row per rating/percent pair, in display order (§ `RATING_ORDER`, UI-only). */
const capRows = computed(() =>
  NW_SCHEMA.ratingConversion
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
    })),
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
      onInfo: (event: MouseEvent) => toggleCard(event, stat.key),
    }));
});

const abilityRows = computed(() =>
  NW_SCHEMA.stats
    .filter((stat) => stat.ability)
    .map((stat) => ({
      key: stat.key,
      label: stat.label,
      value: int(stages.value.totals[stat.key] ?? 0),
      onInfo: (event: MouseEvent) => toggleCard(event, stat.key),
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
      onInfo: (event: MouseEvent) => toggleCard(event, stat.key),
    })),
);

const ilHpRows = computed(() => [
  {
    key: "itemLevel",
    label: "Item level",
    value: int(derived.value.itemLevel),
    lead: true,
  },
  { key: "hp", label: "Hit points", value: int(derived.value.hp), lead: true },
]);

const damageTableRows = computed(() => [
  ...damageRows.map(([label, key]) => ({
    key,
    label,
    value: int(derived.value.damage[key as keyof typeof derived.value.damage]),
    lead: key === "average",
  })),
  {
    key: "baseDamage",
    label: "Base damage",
    value: int(derived.value.baseDamage),
    muted: true,
  },
  {
    key: "effectiveMagPhys",
    label: "Effective magical/physical",
    value: pct(derived.value.effectiveMagPhys),
    muted: true,
  },
]);

const healingTableRows = computed(() => [
  ...healingRows.map(([label, key]) => ({
    key,
    label,
    value: int(
      derived.value.healing[key as keyof typeof derived.value.healing],
    ),
    lead: key === "average",
  })),
  {
    key: "overallHealing",
    label: "Overall outgoing healing",
    value: pct(derived.value.overallHealing),
    muted: true,
  },
]);

const ehpTableRows = computed(() =>
  ehpRows.map(([label, key]) => ({
    key,
    label,
    value: int(derived.value.ehp[key as keyof typeof derived.value.ehp]),
    lead: key === "average",
  })),
);

const bonusSummary = computed(() => {
  const all = result.value.bonuses;
  return {
    total: all.length,
    active: all.filter((bonus) => bonus.active).length,
    excluded: all.filter((bonus) => bonus.excluded).length,
  };
});

function fmtPctSigned(value: number | null) {
  if (value == null || Math.abs(value) < 1e-9) return "—";
  return (value > 0 ? "+" : "") + pct(value);
}

/** Signed display for a merged overcap/headroom cell: `—` exactly on the cap, otherwise
 * an explicit `+`/`-` since these columns have no other cue for direction. */
function signedPct(value: number) {
  if (Math.abs(value) < 1e-9) return "—";
  return (value > 0 ? "+" : "") + pct(value);
}
function signedInt(value: number) {
  if (Math.abs(value) < 1e-9) return "—";
  return (value > 0 ? "+" : "") + int(value);
}

// The stat source popover ("why is this number what it is", per stat) -- source attribution
// itself lives in stat-sources.ts, since it's pure data derivation with no template of its
// own. Click-triggered (a circle-alert button ahead of each row's label), not hover-triggered:
// a dense stat table put the pointer's path from a row to its own hover card through *other*
// rows' triggers often enough that a hover card kept getting swapped out from under the
// pointer before it ever arrived -- a deliberate click has no such transit to go wrong.
const root = ref<InstanceType<typeof BasePanel> | null>(null);
const tooltip = ref<InstanceType<typeof BaseTooltip> | null>(null);

interface OpenCard {
  key: string;
}
const openCard = ref<OpenCard | null>(null);

const openLabel = computed(
  () =>
    NW_SCHEMA.statByKey[openCard.value?.key ?? ""]?.label ??
    openCard.value?.key ??
    "",
);
const openSections = computed(() =>
  openCard.value
    ? sectionsFor(result.value, build.value, openCard.value.key)
    : [],
);

/**
 * Anchored to the trigger button: delegates to BaseTooltip's place() which handles
 * horizontal flip and vertical overflow detection.
 */
function placeCard(key: string, rect: DOMRect) {
  tooltip.value?.place(rect);
  openCard.value = { key };
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

/** Closes the popover on any click outside it -- `onClickOutside` ignores clicks on
 * the card itself (`.statcard`) and on other stat info buttons (`.stat-info-btn`),
 * so a click on a different row's trigger reaches `toggleCard` and switches the card
 * over instead of closing it first. */
onClickOutside(root, () => closeCard(), {
  ignore: [".statcard", ".stat-info-btn"],
  capture: false,
});
</script>

<template>
  <BasePanel ref="root" flush>
    <div
      v-if="result.errors.length"
      class="mb-2.5 rounded-md bg-danger-soft px-2.5 py-1.5 text-danger"
    >
      <strong>{{ result.errors.length }} problem(s)</strong>
      <ul class="mt-1 pl-5">
        <li v-for="error in result.errors" :key="error.slotId + error.kind">
          {{ error.message }}
        </li>
      </ul>
    </div>

    <!-- The one number the sheet keeps most visible: pick a damage calculation, see its
         value here. A comparison table below shows the other build's value and the gap
         between them, with the compare-build selector and display toggles embedded in
         the table itself. -->
    <div class="flex flex-col gap-1 rounded-md bg-surface-2 px-2.5 py-2">
      <ComboBox
        v-model="summaryCalcKey"
        class="w-full"
        :options="summaryOptions"
      />

      <table class="mt-0.5 w-full border-collapse border border-line">
        <tbody>
          <tr class="border border-line">
            <td class="px-1 py-0.5">This build</td>
            <td
              class="px-1 py-0.5 text-right text-xl font-semibold tabular-nums w-40"
              :class="summaryRowCls"
            >
              {{ int(summaryValue) }}
            </td>
            <td
              class="px-1 py-0.5 text-right tabular-nums w-20"
              :class="summaryRowCls"
            >
              {{ fmtPctSigned(thisVsOtherPct) }}
            </td>
          </tr>
          <tr class="border border-line">
            <td class="px-1 py-0.5">
              <ComboBox
                class="compare-select"
                :model-value="build.compare.id"
                :options="compare.compareOptions.value"
                @update:model-value="compare.setCompareBuild"
              />
            </td>
            <td
              class="px-1 py-0.5 text-right text-xl font-semibold tabular-nums"
            >
              {{ compareResult ? int(compareSummaryValue) : "—" }}
            </td>
            <td class="px-1 py-0.5 text-right tabular-nums text-muted">
              {{ compareResult ? fmtPctSigned(otherVsThisPct) : "—" }}
            </td>
          </tr>
          <tr class="border border-line">
            <td colspan="3" class="px-1 py-0.5">
              <BaseCheckbox
                :model-value="build.compare.highlight"
                :disabled="!compareResult"
                @update:model-value="
                  (v) => compare.setCompareFlag('highlight', v as boolean)
                "
                >Highlight changes</BaseCheckbox
              >
            </td>
          </tr>
          <tr class="border border-line">
            <td colspan="3" class="px-1 py-0.5">
              <BaseCheckbox
                :model-value="build.compare.onlyDiff"
                :disabled="!compareResult"
                @update:model-value="
                  (v) => compare.setCompareFlag('onlyDiff', v as boolean)
                "
                >Only show changes</BaseCheckbox
              >
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="flex items-center gap-3 py-2 text-sm text-muted">
      <span
        >{{ bonusSummary.active }}/{{ bonusSummary.total }} bonuses active</span
      >
      <span v-if="bonusSummary.excluded"
        >{{ bonusSummary.excluded }} excluded</span
      >
    </div>

    <StatPairsTable :rows="ilHpRows" />

    <PanelHead>Ratings</PanelHead>
    <table class="w-full border-collapse border border-line">
      <tbody>
        <!-- Each cell coloured off its own column's 'over', not the row: rating and
             percentage cap independently, so one can read green while the other reads
             red on the same row. -->
        <tr
          v-for="row in capRows"
          :key="row.key"
          class="even:bg-surface-2/55"
          :class="row.sepAfter && 'border-b-2 border-b-line'"
        >
          <td class="flex items-center gap-0.5 border border-line px-1 py-0.5">
            <IconButton
              icon="circle-alert"
              title="Show contributing sources"
              class="stat-info-btn flex-none"
              :data-stat-key="row.key"
              @click="toggleCard($event, row.key)"
            />
            <span>{{ row.label }}</span>
          </td>
          <td
            class="border border-line px-1 py-0.5 text-right tabular-nums"
            :class="row.rating.primaryCls"
          >
            {{ int(row.rating.total) }}
          </td>
          <td
            class="border border-line px-1 py-0.5 text-right tabular-nums"
            :class="row.percent.primaryCls"
          >
            {{ pct(row.percent.capped) }}
          </td>
          <td
            class="border border-line px-1 py-0.5 text-right tabular-nums text-muted"
            :class="row.percent.overCls"
          >
            {{ signedPct(row.percent.over) }}
          </td>
          <td
            class="border border-line px-1 py-0.5 text-right tabular-nums text-muted"
            :class="row.rating.overCls"
          >
            {{ signedInt(row.rating.over) }}
          </td>
        </tr>
      </tbody>
    </table>

    <PanelHead>Other stats</PanelHead>
    <StatPairsTable :rows="otherRows" />

    <PanelHead>Ability scores</PanelHead>
    <StatPairsTable :rows="abilityRows" />

    <PanelHead>Enemy</PanelHead>
    <StatPairsTable :rows="enemyRows" />

    <PanelHead>Damage</PanelHead>
    <StatPairsTable :rows="damageTableRows" />

    <PanelHead>Healing</PanelHead>
    <StatPairsTable :rows="healingTableRows" />

    <PanelHead>Effective hit points</PanelHead>
    <StatPairsTable :rows="ehpTableRows" />

    <BaseTooltip ref="tooltip" :width="256">
      <StatSourceCard
        v-if="openCard"
        :label="openLabel"
        :sections="openSections"
        :data-stat-key="openCard.key"
        @close="closeCard"
      />
    </BaseTooltip>
  </BasePanel>
</template>
