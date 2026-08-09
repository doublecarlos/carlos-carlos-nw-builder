<script setup lang="ts">
// Coverage report for "Import from game" (#175): what came across, what didn't, and why.
// Rendered both as the wizard's own step 4 and reopened later from the post-import notice --
// both read straight from stores/gameImport.ts's `reports`, which keeps the last commit's data
// for the session, so this component needs no props of its own.
import { computed, ref } from "vue";
import TabStrip from "./ui/TabStrip.vue";
import TabButton from "./ui/TabButton.vue";
import BaseButton from "./ui/BaseButton.vue";
import { db } from "../stores/resolved";
import { reports } from "../stores/gameImport";
import { notInDemoGroups, KNOWN_LOSSY_NOTES } from "../lib/demo-slots";

const activeIndex = ref(0);

const activeReport = computed(
  () => reports.value[activeIndex.value]?.report ?? null,
);

const combined = computed(() => {
  let recognised = 0;
  let total = 0;
  for (const { report } of reports.value) {
    recognised += report.counts.imported;
    total +=
      report.counts.imported +
      report.counts.unrecognised +
      report.counts.overflow;
  }
  return { recognised, total };
});

interface ImportedRow {
  slotLabel: string;
  itemName: string;
}
interface ImportedSection {
  sectionLabel: string;
  rows: ImportedRow[];
}

/** Every `imported` outcome, grouped by the real build section (in section order) rather than
 *  by bag -- this is the reassurance panel, so it should read the way the build editor does. */
const importedBySection = computed<ImportedSection[]>(() => {
  const report = activeReport.value;
  if (!report) return [];
  const bySection = new Map<string, ImportedRow[]>();
  for (const outcome of report.outcomes) {
    if (outcome.kind !== "imported") continue;
    const slot = db.value.slotById.get(outcome.slotId);
    if (!slot) continue;
    const row: ImportedRow = {
      slotLabel: slot.label ?? outcome.slotId,
      itemName: db.value.get(outcome.itemId)?.name ?? outcome.itemId,
    };
    const list = bySection.get(slot.section);
    if (list) list.push(row);
    else bySection.set(slot.section, [row]);
  }
  return db.value.sections
    .filter((section) => bySection.has(section.id))
    .map((section) => ({
      sectionLabel: section.label,
      rows: bySection.get(section.id)!,
    }));
});

interface UnrecognisedRow {
  slot: number;
  gameId: string;
}
interface UnrecognisedBag {
  bag: string;
  rows: UnrecognisedRow[];
}

const unrecognisedByBag = computed<UnrecognisedBag[]>(() => {
  const report = activeReport.value;
  if (!report) return [];
  const byBag = new Map<string, UnrecognisedRow[]>();
  for (const outcome of report.outcomes) {
    if (outcome.kind !== "unrecognised") continue;
    const row: UnrecognisedRow = { slot: outcome.slot, gameId: outcome.gameId };
    const list = byBag.get(outcome.bag);
    if (list) list.push(row);
    else byBag.set(outcome.bag, [row]);
  }
  return [...byBag.entries()].map(([bag, rows]) => ({ bag, rows }));
});

const unrecognisedGameIds = computed(() =>
  unrecognisedByBag.value.flatMap((group) =>
    group.rows.map((row) => row.gameId),
  ),
);

/** Recognised but every candidate slot for its bag was already full -- a real placement
 *  conflict rather than a catalogue gap, called out as a note instead of its own group. */
const overflowCount = computed(() => activeReport.value?.counts.overflow ?? 0);

const notInDemoRows = computed(() => {
  const report = activeReport.value;
  if (!report) return [];
  const slotIds: string[] = [];
  for (const outcome of report.outcomes) {
    if (outcome.kind === "notInDemo") slotIds.push(outcome.slotId);
  }
  return notInDemoGroups(db.value, slotIds);
});

async function copyUnrecognisedIds() {
  try {
    await navigator.clipboard.writeText(unrecognisedGameIds.value.join("\n"));
  } catch {
    // Clipboard permission denied -- the ids are still readable/selectable in the list.
  }
}
</script>

<template>
  <div class="flex flex-col gap-3" data-testid="game-import-report">
    <p class="text-sm text-muted" data-testid="game-import-report-summary">
      {{ combined.recognised }}/{{ combined.total }} items recognised across
      {{ reports.length }} build{{ reports.length === 1 ? "" : "s" }}
    </p>

    <TabStrip v-if="reports.length > 1">
      <TabButton
        v-for="(entry, index) in reports"
        :key="index"
        :active="activeIndex === index"
        data-testid="game-import-report-tab"
        @click="activeIndex = index"
        >{{ entry.buildName }}</TabButton
      >
    </TabStrip>

    <div
      v-if="activeReport"
      class="flex flex-col gap-3 rounded-md border border-line p-3"
    >
      <details data-testid="game-import-report-imported">
        <summary class="cursor-pointer text-sm font-semibold">
          Imported ({{ activeReport.counts.imported }})
        </summary>
        <div class="mt-2 flex flex-col gap-2">
          <div v-for="section in importedBySection" :key="section.sectionLabel">
            <p class="text-xs font-semibold text-muted">
              {{ section.sectionLabel }}
            </p>
            <p
              v-for="(row, index) in section.rows"
              :key="index"
              class="text-sm"
              data-testid="game-import-report-imported-row"
            >
              {{ row.slotLabel }} → {{ row.itemName }}
            </p>
          </div>
        </div>
      </details>

      <details open data-testid="game-import-report-unrecognised">
        <summary class="cursor-pointer text-sm font-semibold">
          Not recognised ({{ activeReport.counts.unrecognised }})
        </summary>
        <div class="mt-2 flex flex-col gap-2">
          <p class="text-sm text-muted">
            The catalogue models a curated subset of the game's items — an
            unrecognised id means "not modelled yet", not "your file is broken".
          </p>
          <p v-if="overflowCount" class="text-sm text-muted">
            {{ overflowCount }} more item{{
              overflowCount === 1 ? " was" : "s were"
            }}
            recognised, but every matching slot was already filled.
          </p>
          <BaseButton
            v-if="unrecognisedGameIds.length"
            variant="link"
            data-testid="game-import-report-copy-unrecognised"
            @click="copyUnrecognisedIds"
            >Copy all ids</BaseButton
          >
          <div v-for="group in unrecognisedByBag" :key="group.bag">
            <p class="text-xs font-semibold text-muted">{{ group.bag }}</p>
            <p
              v-for="(row, index) in group.rows"
              :key="index"
              class="text-sm"
              data-testid="game-import-report-unrecognised-row"
            >
              {{ group.bag }}/{{ row.slot }} → {{ row.gameId }}
            </p>
          </div>
        </div>
      </details>

      <details open data-testid="game-import-report-not-in-demo">
        <summary class="cursor-pointer text-sm font-semibold">
          Not in the demo ({{ notInDemoRows.length }})
        </summary>
        <div class="mt-2 flex flex-col gap-1.5">
          <p
            v-for="group in notInDemoRows"
            :key="group.label"
            class="text-sm"
            data-testid="game-import-report-notindemo-row"
          >
            <strong>{{ group.label }}</strong> — {{ group.reason }}
          </p>
          <p
            v-for="note in KNOWN_LOSSY_NOTES"
            :key="note"
            class="text-xs text-muted"
          >
            {{ note }}
          </p>
        </div>
      </details>
    </div>
  </div>
</template>
