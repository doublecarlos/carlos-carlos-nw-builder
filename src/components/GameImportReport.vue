<script setup lang="ts">
// Coverage report for "Import from game" (#175): what came across, what didn't, and why.
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
import { reports, mapUnrecognisedItem } from "../stores/gameImport";
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
  /** This outcome's index in `report.outcomes` -- doubles as the row's identity for the open
   *  picker and the argument `mapUnrecognisedItem` re-resolves against. */
  outcomeIndex: number;
  /** Whether the bag names any app slot at all -- an unmapped/unknown bag has nothing to map
   *  to, so "Map to an item…" is hidden rather than offered and failing silently. */
  canMap: boolean;
  /** Set once this row has been manually mapped -- the row keeps its place in the list either
   *  way (keyed off `unrecognisedOrigin`, not the outcome's current kind) so a wrong pick can
   *  be corrected instead of the whole row vanishing. */
  mappedItem: Item | null;
  /** Mapped, but every candidate slot for it was already filled -- shown as a note rather than
   *  silently looking unmapped. */
  overflow: boolean;
}
interface UnrecognisedBag {
  bag: string;
  rows: UnrecognisedRow[];
}

const unrecognisedByBag = computed<UnrecognisedBag[]>(() => {
  const entry = reports.value[activeIndex.value];
  const report = activeReport.value;
  if (!entry || !report) return [];
  const byBag = new Map<string, UnrecognisedRow[]>();
  for (const [outcomeIndex, origin] of entry.unrecognisedOrigin) {
    const outcome = report.outcomes[outcomeIndex];
    // Every outcome named in `unrecognisedOrigin` started as "unrecognised" and can only have
    // moved to "imported"/"overflow" since -- this check is for narrowing, not a real case.
    if (!outcome || outcome.kind === "notInDemo") continue;
    const mappedItemId =
      outcome.kind === "imported" || outcome.kind === "overflow"
        ? outcome.itemId
        : null;
    const row: UnrecognisedRow = {
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
const unrecognisedGameIds = computed(() =>
  unrecognisedByBag.value.flatMap((group) =>
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
      ? entry?.unrecognisedOrigin.get(openOutcomeIndex.value)
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
  mapUnrecognisedItem(activeIndex.value, outcomeIndex, itemId);
  openOutcomeIndex.value = null;
}

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
          <div
            v-for="group in unrecognisedByBag"
            :key="group.bag"
            class="flex flex-col gap-1"
          >
            <p class="text-xs font-semibold text-muted">{{ group.bag }}</p>
            <div class="rounded-md border border-line">
              <div
                class="grid grid-cols-[1fr_1fr_auto] gap-x-3 rounded-t-md bg-surface-2/70 px-2 py-1 text-xs font-semibold text-muted"
              >
                <span>Item id</span>
                <span>Mapped to</span>
                <span></span>
              </div>
              <template v-for="row in group.rows" :key="row.outcomeIndex">
                <div
                  class="grid grid-cols-[1fr_1fr_auto] items-center gap-x-3 border-t border-line px-2 py-1.5 text-sm"
                  data-testid="game-import-report-unrecognised-row"
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
