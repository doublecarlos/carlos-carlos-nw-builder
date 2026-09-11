<script setup lang="ts">
// Coverage report for "Import from game": what came across, what didn't, and why.
// Rendered both as the wizard's own step 4 and reopened later from the post-import notice --
// both read straight from stores/gameImport.ts's `reports`, which keeps the last commit's data
// for the session, so this component needs no props of its own.
import { computed, ref, watch } from "vue";
import TabStrip from "./ui/TabStrip.vue";
import TabButton from "./ui/TabButton.vue";
import BaseButton from "./ui/BaseButton.vue";
import ItemPicker from "./game/ItemPicker.vue";
import { db } from "../stores/resolved";
import * as builds from "../stores/builds";
import { reports, mapUnrecognizedItem } from "../stores/gameImport";
import {
  notInDemoGroups,
  candidateSlotIds,
  KNOWN_LOSSY_NOTES,
} from "../lib/demo-slots";
import { forSlotAndBuild } from "../data/db";
import type { Item } from "../types";

const activeIndex = ref(0);

/** Index into `activeReport.outcomes` of the row whose "map to an item" picker is open, if
 *  any -- outcome position is stable across a re-resolve (buildFromLoadout's per-bag pass is
 *  deterministic), so it stays valid even once the picked mapping replaces the report below. */
const openOutcomeIndex = ref<number | null>(null);
watch(activeIndex, () => {
  openOutcomeIndex.value = null;
});

const activeReport = computed(
  () => reports.value[activeIndex.value]?.report ?? null,
);

const combined = computed(() => {
  let recognized = 0;
  let total = 0;
  for (const { report } of reports.value) {
    recognized += report.counts.imported;
    total +=
      report.counts.imported +
      report.counts.unrecognized +
      report.counts.overflow;
  }
  return { recognized, total };
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

interface UnrecognizedRow {
  slot: number;
  gameId: string;
  /** This outcome's index in `report.outcomes` -- doubles as the row's identity for the open
   *  picker and the argument `mapUnrecognizedItem` re-resolves against. */
  outcomeIndex: number;
  /** Whether the bag names any app slot at all -- an unmapped/unknown bag has nothing to map
   *  to, so "Map to an item…" is hidden rather than offered and failing silently. */
  canMap: boolean;
  /** Set once this row has been manually mapped -- the row keeps its place in the list either
   *  way (keyed off `unrecognizedOrigin`, not the outcome's current kind) so a wrong pick can
   *  be corrected instead of the whole row vanishing. */
  mappedItem: Item | null;
  /** Mapped, but every candidate slot for it was already filled -- shown as a note rather than
   *  silently looking unmapped. */
  overflow: boolean;
}
interface UnrecognizedBag {
  bag: string;
  rows: UnrecognizedRow[];
}

const unrecognizedByBag = computed<UnrecognizedBag[]>(() => {
  const entry = reports.value[activeIndex.value];
  const report = activeReport.value;
  if (!entry || !report) return [];
  const byBag = new Map<string, UnrecognizedRow[]>();
  for (const [outcomeIndex, origin] of entry.unrecognizedOrigin) {
    const outcome = report.outcomes[outcomeIndex];
    // Every outcome named in `unrecognizedOrigin` started as "unrecognized" and can only have
    // moved to "imported"/"overflow" since -- this check is for narrowing, not a real case.
    if (!outcome || outcome.kind === "notInDemo") continue;
    const mappedItemId =
      outcome.kind === "imported" || outcome.kind === "overflow"
        ? outcome.itemId
        : null;
    const row: UnrecognizedRow = {
      slot: origin.slot,
      gameId: outcome.gameId,
      outcomeIndex,
      canMap: candidateSlotIds(origin.bag, origin.slot).length > 0,
      mappedItem: mappedItemId ? (db.value.get(mappedItemId) ?? null) : null,
      overflow: outcome.kind === "overflow",
    };
    const list = byBag.get(origin.bag);
    if (list) list.push(row);
    else byBag.set(origin.bag, [row]);
  }
  return [...byBag.entries()].map(([bag, rows]) => ({ bag, rows }));
});

/** Ids still needing a mapping -- excludes rows already mapped, unlike the list below which
 *  keeps showing those too. */
const unrecognizedGameIds = computed(() =>
  unrecognizedByBag.value.flatMap((group) =>
    group.rows.filter((row) => !row.mappedItem).map((row) => row.gameId),
  ),
);

/** Candidate items for whichever row's picker is currently open -- the union of every
 *  candidate app slot's selectable items (filter- and class/race-narrowed against the
 *  report's own build, not necessarily the active one), deduped by item id. */
const openCandidates = computed<Item[]>(() => {
  const entry = reports.value[activeIndex.value];
  const origin =
    openOutcomeIndex.value != null
      ? entry?.unrecognizedOrigin.get(openOutcomeIndex.value)
      : undefined;
  if (!entry || !origin) return [];
  const build = builds.get(entry.buildId);
  if (!build) return [];
  const seen = new Map<string, Item>();
  for (const slotId of candidateSlotIds(origin.bag, origin.slot)) {
    for (const item of forSlotAndBuild(db.value, slotId, build)) {
      seen.set(item.id, item);
    }
  }
  return [...seen.values()];
});

function toggleMapPicker(outcomeIndex: number) {
  openOutcomeIndex.value =
    openOutcomeIndex.value === outcomeIndex ? null : outcomeIndex;
}

function onPick(outcomeIndex: number, itemId: string) {
  if (!itemId) return; // the picker's empty option
  mapUnrecognizedItem(activeIndex.value, outcomeIndex, itemId);
  openOutcomeIndex.value = null;
}

/** Recognized but every candidate slot for its bag was already full -- a real placement
 *  conflict rather than a catalog gap, called out as a note instead of its own group. */
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

async function copyUnrecognizedIds() {
  try {
    await navigator.clipboard.writeText(unrecognizedGameIds.value.join("\n"));
  } catch {
    // Clipboard permission denied -- the ids are still readable/selectable in the list.
  }
}
</script>

<template>
  <div class="flex flex-col gap-3" data-testid="game-import-report">
    <p class="text-muted" data-testid="game-import-report-summary">
      {{ combined.recognized }}/{{ combined.total }} items recognized across
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
        <summary class="cursor-pointer font-semibold">
          Imported ({{ activeReport.counts.imported }})
        </summary>
        <div class="mt-2 flex flex-col gap-2">
          <div v-for="section in importedBySection" :key="section.sectionLabel">
            <p class="text-sm font-semibold text-muted">
              {{ section.sectionLabel }}
            </p>
            <p
              v-for="(row, index) in section.rows"
              :key="index"
              data-testid="game-import-report-imported-row"
            >
              {{ row.slotLabel }} → {{ row.itemName }}
            </p>
          </div>
        </div>
      </details>

      <details open data-testid="game-import-report-unrecognized">
        <summary class="cursor-pointer font-semibold">
          Not recognized ({{ activeReport.counts.unrecognized }})
        </summary>
        <div class="mt-2 flex flex-col gap-2">
          <p>
            The following Internal game IDs exist in your export but aren't
            recognized.<br />
            You can map the IDs to items here.
          </p>
          <p>
            <BaseButton
              v-if="unrecognizedGameIds.length"
              data-testid="game-import-report-copy-unrecognized"
              class="my-2"
              @click="copyUnrecognizedIds"
              >Copy all IDs</BaseButton
            >
          </p>
          <p v-if="overflowCount" class="text-muted">
            {{ overflowCount }} more item{{
              overflowCount === 1 ? " was" : "s were"
            }}
            recognized, but every matching slot was already filled.
          </p>

          <div
            v-for="group in unrecognizedByBag"
            :key="group.bag"
            class="flex flex-col gap-1"
          >
            <p class="text-sm font-semibold text-muted">{{ group.bag }}</p>
            <div class="rounded-md border border-line">
              <div
                class="grid grid-cols-[1fr_1fr_auto] gap-x-3 rounded-t-md bg-surface-2/70 px-2 py-1 text-sm font-semibold text-muted"
              >
                <span>Item id</span>
                <span>Mapped to</span>
                <span></span>
              </div>
              <template v-for="row in group.rows" :key="row.outcomeIndex">
                <div
                  class="grid grid-cols-[1fr_1fr_auto] items-center gap-x-3 border-t border-line px-2 py-1.5"
                  data-testid="game-import-report-unrecognized-row"
                >
                  <span>{{ group.bag }}/{{ row.slot }} → {{ row.gameId }}</span>
                  <span :class="row.mappedItem ? 'text-text' : 'text-muted'">
                    <template v-if="row.mappedItem">
                      {{ row.mappedItem.name
                      }}<span v-if="row.overflow" class="text-muted">
                        (slot already full)</span
                      >
                    </template>
                    <template v-else>Not mapped</template>
                  </span>
                  <BaseButton
                    v-if="row.canMap"
                    data-testid="game-import-report-map-item"
                    @click="toggleMapPicker(row.outcomeIndex)"
                    >{{
                      row.mappedItem ? "Change mapping…" : "Map to an item…"
                    }}</BaseButton
                  >
                </div>
                <div
                  v-if="openOutcomeIndex === row.outcomeIndex"
                  class="border-t border-line bg-surface-2/40 px-2 py-2"
                >
                  <ItemPicker
                    :items="openCandidates"
                    :selected-item="row.mappedItem"
                    :db="db"
                    :model-value="row.mappedItem?.id ?? ''"
                    data-testid="game-import-report-map-picker"
                    @update:model-value="onPick(row.outcomeIndex, $event)"
                  />
                </div>
              </template>
            </div>
          </div>
        </div>
      </details>

      <details open data-testid="game-import-report-not-in-demo">
        <summary class="cursor-pointer font-semibold">
          Not in the export ({{ notInDemoRows.length }})
        </summary>
        <div class="mt-2 flex flex-col gap-1.5">
          <p
            v-for="group in notInDemoRows"
            :key="group.label"
            data-testid="game-import-report-notindemo-row"
          >
            <strong>{{ group.label }}</strong>
          </p>
          <p
            v-for="note in KNOWN_LOSSY_NOTES"
            :key="note"
            class="text-sm text-muted"
          >
            {{ note }}
          </p>
        </div>
      </details>
    </div>
  </div>
</template>
