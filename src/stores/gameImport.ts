// Wizard state for "Import from game": parse a demo file, preview what each loadout recognises,
// and commit the picked ones as new builds. A store, not component state, so GameImport.vue
// stays a thin renderer.
import { computed, reactive, ref } from "vue";
import { parseDemo, DemoParseError, child } from "../lib/demo-format";
import { readSnapshot } from "../lib/demo-snapshot";
import { buildFromLoadout } from "../lib/demo-import";
import * as builds from "./builds";
import * as layers from "./layers";
import * as history from "./history";
import * as catalog from "../data/catalog";
import { db } from "./resolved";
import { showNotice } from "./notice";
import type {
  DemoSnapshot,
  DemoCharacter,
  DemoLoadout,
} from "../lib/demo-snapshot";
import type { Build } from "../types";
import type { ImportReport } from "../lib/demo-import";

export type WizardStep = 1 | 2 | 3 | 4;

/** One imported build with its report, one tab per entry. `character`/`loadout` are kept so
 *  `mapUnrecognisedItem` can re-run `buildFromLoadout` after `_snapshot` is cleared. */
export interface CommittedReport {
  buildId: string;
  buildName: string;
  report: ImportReport;
  character: DemoCharacter;
  loadout: DemoLoadout;
  /** Bag/slot of every outcome that was "unrecognised" at commit time, by outcome index. A
   *  mapped outcome loses its bag/slot, so this is what keeps its row on the report. */
  unrecognisedOrigin: Map<number, { bag: string; slot: number }>;
}

const _open = ref(false);
const _step = ref<WizardStep>(1);
const _parseError = ref("");
const _snapshot = ref<DemoSnapshot | null>(null);
const _selected = ref<Set<string>>(new Set());
const _names = reactive<Record<string, string>>({});
/** The last commit's reports. Kept for the session, not cleared by `reset()`, so the notice
 *  can reopen the report after the wizard closes. */
const _reports = ref<CommittedReport[]>([]);

export const isOpen = computed(() => _open.value);
export const step = computed(() => _step.value);
export const parseError = computed(() => _parseError.value);
export const snapshot = computed(() => _snapshot.value);
export const reports = computed(() => _reports.value);

/** A loadout's identity within the wizard. `Loadoutname` alone is not unique, so rows,
 *  selections and name overrides are keyed by position. */
export const rowKey = (characterIndex: number, loadoutIndex: number) =>
  `${characterIndex}:${loadoutIndex}`;

export interface LoadoutRow {
  key: string;
  characterName: string;
  loadoutName: string;
  active: boolean;
  savedAt: number | null;
  itemCount: number;
  recognisedCount: number;
  defaultName: string;
}

/** One row per loadout, in file order. Resolves against the live db only to count recognised
 *  items and name the build; writes nothing. */
export const rows = computed<LoadoutRow[]>(() => {
  const snap = _snapshot.value;
  if (!snap) return [];
  const out: LoadoutRow[] = [];
  snap.characters.forEach((character, characterIndex) => {
    for (const loadout of character.loadouts) {
      const { build, report } = buildFromLoadout(character, loadout, db.value);
      out.push({
        key: rowKey(characterIndex, loadout.index),
        characterName: character.name,
        loadoutName: loadout.name,
        active: loadout.active,
        savedAt: loadout.savedAt,
        itemCount: loadout.items.filter((item) => item.gameId != null).length,
        recognisedCount: report.counts.imported,
        defaultName: build.name,
      });
    }
  });
  return out;
});

export function nameFor(key: string): string {
  return (
    _names[key] ?? rows.value.find((row) => row.key === key)?.defaultName ?? ""
  );
}

export function setName(key: string, name: string) {
  _names[key] = name;
}

export const selected = computed(() => _selected.value);

export function isSelected(key: string): boolean {
  return _selected.value.has(key);
}

export function toggleSelected(key: string) {
  const next = new Set(_selected.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  _selected.value = next;
}

function reset() {
  _step.value = 1;
  _parseError.value = "";
  _snapshot.value = null;
  _selected.value = new Set();
  for (const key of Object.keys(_names)) delete _names[key];
}

export function openWizard() {
  reset();
  _open.value = true;
}

export function close() {
  _open.value = false;
  reset();
}

export function goToStep(target: WizardStep) {
  if (target === 3 && !_snapshot.value) return;
  _step.value = target;
}

/** Reopens the wizard on the report step, behind the post-import notice's affordance. */
export function openReport() {
  _open.value = true;
  _step.value = 4;
}

/** The active loadout of the recording character only: a demo can carry several characters,
 *  but only one was being played. */
function defaultSelection(snap: DemoSnapshot): Set<string> {
  const active = snap.characters[0]?.loadouts.find((loadout) => loadout.active);
  return active ? new Set([rowKey(0, active.index)]) : new Set();
}

export function parseFile(text: string) {
  _parseError.value = "";
  _snapshot.value = null;

  let root;
  try {
    root = parseDemo(text);
  } catch (error: unknown) {
    _parseError.value =
      error instanceof DemoParseError
        ? `Could not parse that file: ${error.message}`
        : `Could not read that file: ${error instanceof Error ? error.message : String(error)}`;
    return;
  }

  if (!child(root, "Packets")) {
    _parseError.value =
      "That doesn't look like a demo file - no Packets block was found in it.";
    return;
  }

  const parsed = readSnapshot(root);
  if (!parsed.characters.length) {
    _parseError.value =
      "This demo has no character loadouts in it - it may have been recorded on a " +
      "loading screen, or with something other than build_export.";
    return;
  }

  _snapshot.value = parsed;
  _selected.value = defaultSelection(parsed);
  _step.value = 3;
}

export function commit() {
  const snap = _snapshot.value;
  if (!snap) return;

  const newBuilds: Build[] = [];
  const newReports: ImportReport[] = [];
  const newContexts: { character: DemoCharacter; loadout: DemoLoadout }[] = [];
  snap.characters.forEach((character, characterIndex) => {
    for (const loadout of character.loadouts) {
      const key = rowKey(characterIndex, loadout.index);
      if (!_selected.value.has(key)) continue;
      const { build, report } = buildFromLoadout(character, loadout, db.value, {
        name: nameFor(key),
      });
      newBuilds.push(build);
      newReports.push(report);
      newContexts.push({ character, loadout });
    }
  });
  if (!newBuilds.length) return;

  builds.importBuilds(newBuilds, false, layers.enabledOverlays.value);
  _reports.value = newBuilds.map((build, i) => {
    const report = newReports[i];
    const unrecognisedOrigin = new Map<number, { bag: string; slot: number }>();
    report.outcomes.forEach((outcome, index) => {
      if (outcome.kind === "unrecognised") {
        unrecognisedOrigin.set(index, { bag: outcome.bag, slot: outcome.slot });
      }
    });
    return {
      buildId: build.id,
      buildName: build.name,
      report,
      character: newContexts[i].character,
      loadout: newContexts[i].loadout,
      unrecognisedOrigin,
    };
  });
  _step.value = 4;

  const recognised = newReports.reduce((sum, r) => sum + r.counts.imported, 0);
  const total = newReports.reduce(
    (sum, r) =>
      sum + r.counts.imported + r.counts.unrecognised + r.counts.overflow,
    0,
  );
  showNotice(
    `Imported ${newBuilds.length} build${newBuilds.length === 1 ? "" : "s"} from game` +
      (total ? ` (${recognised}/${total} items recognised)` : ""),
    { label: "View import report", run: openReport },
  );
}

/** Maps one outcome's game id onto `itemId` in a layer overlay, then re-resolves the loadout in
 *  place. Re-mapping first retracts the game id from any claimant sharing the new item's
 *  `filter`, the invariant catalog.ts validates; claimants under other filters are the same
 *  in-game item's other slot-dependent forms, not a mapping being corrected. */
export function mapUnrecognisedItem(
  reportIndex: number,
  outcomeIndex: number,
  itemId: string,
) {
  const entry = _reports.value[reportIndex];
  const outcome = entry?.report.outcomes[outcomeIndex];
  // The "notInDemo" check narrows the union so every `outcome.gameId` read below is safe; an
  // outcome in `unrecognisedOrigin` can never actually be one.
  if (
    !entry ||
    !outcome ||
    outcome.kind === "notInDemo" ||
    !entry.unrecognisedOrigin.has(outcomeIndex)
  )
    return;

  const composed = db.value.get(itemId);
  if (!composed) return;

  const layer = layers.ensureTargetLayer();
  history.snapshot(
    "layer",
    layer.id,
    `map-gameid:${itemId}`,
    `Map "${outcome.gameId}" → "${composed.name}"`,
    layer.overlay,
  );

  let overlay = layer.overlay;
  for (const claimantId of db.value.itemByGameId.get(outcome.gameId) ?? []) {
    if (claimantId === itemId) continue;
    const previous = db.value.get(claimantId);
    if (!previous || previous.filter !== composed.filter) continue;
    if (!previous.gameIds?.includes(outcome.gameId)) continue;
    overlay = catalog.upsert(overlay, "items", claimantId, {
      ...previous,
      gameIds: previous.gameIds.filter((id) => id !== outcome.gameId),
    });
  }
  const nextItem = {
    ...composed,
    gameIds: composed.gameIds?.includes(outcome.gameId)
      ? composed.gameIds
      : [...(composed.gameIds ?? []), outcome.gameId],
  };
  overlay = catalog.upsert(overlay, "items", itemId, nextItem);
  layers.updateOverlay(layer.id, overlay);

  // db.value already reflects the new mapping: resolved.ts's chain is a synchronous computed.
  const { report: newReport } = buildFromLoadout(
    entry.character,
    entry.loadout,
    db.value,
    { name: entry.buildName },
  );

  // A positional diff rather than a blanket copy, so live edits made since commit survive.
  // Every outcome the re-resolve actually changed is written, not just newly placed ones:
  // teaching the bag one more game id can move an item that had alternatives onto another of
  // its slots, and writing only the new placement would overwrite that item where it stood
  // without ever writing it where it went.
  newReport.outcomes.forEach((o, i) => {
    if (o.kind !== "imported") return;
    const before = entry.report.outcomes[i];
    const unchanged =
      before?.kind === "imported" &&
      before.slotId === o.slotId &&
      before.itemId === o.itemId &&
      i !== outcomeIndex;
    if (unchanged) return;
    const name = db.value.get(o.itemId)?.name ?? o.itemId;
    const label = `${db.value.slotById.get(o.slotId)?.label ?? o.slotId} → ${name} (game import)`;
    builds.setChoiceFor(entry.buildId, o.slotId, o.itemId, label);
  });

  _reports.value = _reports.value.map((r, i) =>
    i === reportIndex ? { ...r, report: newReport } : r,
  );
}
