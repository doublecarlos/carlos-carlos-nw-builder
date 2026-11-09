<script setup lang="ts">
// The stat panel's head-to-head block: the build to compare against, one headline row per
// derived table (damage, healing, EHP) so every tradeoff reads at a glance, and the compare
// toggles. Each row picks its own case; the tables below the summary list them all.
import { computed, useId } from "vue";
import ChoiceMenu from "../ui/ChoiceMenu.vue";
import BaseCheckbox from "../ui/BaseCheckbox.vue";
import BuildComboBox from "./BuildComboBox.vue";
import {
  DERIVED_TABLES,
  derivedValue,
  type DerivedSource,
} from "../../lib/derived-tables";
import { delta, TREND_TONE } from "../../lib/compare-delta";
import { int } from "../../lib/format";
import * as compare from "../../stores/compare";
import { summaryCases, setSummaryCase } from "../../stores/summaryCases";
import type { Build, DerivedOutputs } from "../../types";

const props = defineProps<{
  build: Build;
  derived: DerivedOutputs;
  /** `null` while not comparing: the compare column reads `-`. */
  compareDerived: DerivedOutputs | null;
  compareName: string;
}>();

const idBase = useId();
const compareId = `${idBase}-compare`;

const CASE_OPTIONS = Object.fromEntries(
  DERIVED_TABLES.map((table) => [
    table.source,
    table.rows.map(([label, value]) => ({ value, label })),
  ]),
) as Record<DerivedSource, { value: string; label: string }[]>;

const rows = computed(() =>
  DERIVED_TABLES.map(({ source, label }) => {
    const key = summaryCases[source];
    const mine = derivedValue(props.derived, source, key);
    const other = props.compareDerived
      ? derivedValue(props.compareDerived, source, key)
      : null;
    const lead = delta(mine, other);
    return {
      source,
      label,
      key,
      mine: int(mine),
      other: other == null ? "-" : int(other),
      delta: lead.text,
      trend: lead.trend,
    };
  }),
);

const comparing = computed(() => props.compareDerived != null);
</script>

<template>
  <div
    class="flex flex-col gap-1.5 rounded-md bg-surface-2 px-2.5 py-2"
    data-testid="compare-summary"
  >
    <div class="flex items-center gap-2">
      <label :for="compareId" class="flex-none">Compare with</label>
      <BuildComboBox
        class="compare-select min-w-0 flex-1"
        :input-id="compareId"
        :model-value="build.compare.id"
        :options="compare.compareOptions.value"
        @update:model-value="compare.setCompareBuild"
      />
    </div>

    <table class="w-full border-collapse border border-line">
      <thead>
        <tr class="border border-line text-muted">
          <th class="px-1 py-0.5 text-left font-normal">
            <span class="sr-only">Stat</span>
          </th>
          <th class="px-1 py-0.5 text-right font-normal">This</th>
          <!-- The picker above already names the compare build; the tooltip repeats it. -->
          <th
            class="px-1 py-0.5 text-right font-normal"
            :title="compareName || undefined"
          >
            Other
          </th>
          <th class="px-1 py-0.5 text-right font-normal">Δ</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in rows"
          :key="row.source"
          class="border border-line"
          :data-summary-row="row.source"
          :data-summary-case="row.key"
        >
          <td class="w-full px-1 py-0.5">
            <div class="flex min-w-0 items-baseline gap-1.5">
              <span class="flex-none font-semibold">{{ row.label }}</span>
              <ChoiceMenu
                class="text-xs"
                :model-value="row.key"
                :options="CASE_OPTIONS[row.source]"
                :label="`${row.label} case`"
                testid="summary-case"
                @update:model-value="
                  (key: string) => setSummaryCase(row.source, key)
                "
              />
            </div>
          </td>
          <td
            class="whitespace-nowrap px-1 py-0.5 text-right font-semibold tabular-nums"
            :class="TREND_TONE[row.trend]"
            :data-trend="row.trend"
            data-testid="summary-value"
          >
            {{ row.mine }}
          </td>
          <td
            class="whitespace-nowrap px-1 py-0.5 text-right tabular-nums"
            data-testid="summary-compare-value"
          >
            {{ row.other }}
          </td>
          <td
            class="whitespace-nowrap px-1 py-0.5 text-right font-semibold tabular-nums"
            :class="TREND_TONE[row.trend]"
            :data-trend="row.trend"
            data-testid="summary-delta"
          >
            {{ row.delta }}
          </td>
        </tr>
      </tbody>
    </table>

    <div class="flex flex-col gap-0.5">
      <BaseCheckbox
        :model-value="build.compare.highlight"
        :disabled="!comparing"
        @update:model-value="
          (v) => compare.setCompareFlag('highlight', v as boolean)
        "
        >Highlight changes</BaseCheckbox
      >
      <BaseCheckbox
        :model-value="build.compare.onlyDiff"
        :disabled="!comparing"
        @update:model-value="
          (v) => compare.setCompareFlag('onlyDiff', v as boolean)
        "
        >Only show changes</BaseCheckbox
      >
      <BaseCheckbox
        :model-value="build.compare.statLines"
        :disabled="!comparing"
        @update:model-value="
          (v) => compare.setCompareFlag('statLines', v as boolean)
        "
        >Compare stats</BaseCheckbox
      >
    </div>
  </div>
</template>
