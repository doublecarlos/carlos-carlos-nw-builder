// Wizard state for "Import from game": parse a demo file, preview which loadouts recognise
// what, let the user pick which to bring in, and commit them as new builds. Kept as a store
// (not local component state) so GameImport.vue can stay a thin renderer of this, matching how
// every other multi-step/overlay flow in the app separates state from markup.
import { computed, reactive, ref } from "vue";
import { parseDemo, DemoParseError, child } from "../lib/demo-format";
import { readSnapshot } from "../lib/demo-snapshot";
import { buildFromLoadout } from "../lib/demo-import";
import * as builds from "./builds";
import * as layers from "./layers";
import { db } from "./resolved";
import { showNotice } from "./notice";
import type { DemoSnapshot } from "../lib/demo-snapshot";
import type { Build } from "../types";
import type { ImportReport } from "../lib/demo-import";

export type WizardStep = 1 | 2 | 3 | 4;

/** One imported build paired with its coverage report -- what step 4 (and a reopened report)
 *  renders, one tab per entry. */
export interface CommittedReport {
  buildName: string;
  report: ImportReport;
}

const _open = ref(false);
const _step = ref<WizardStep>(1);
const _parseError = ref("");
const _snapshot = ref<DemoSnapshot | null>(null);
const _selected = ref<Set<string>>(new Set());
const _names = reactive<Record<string, string>>({});
/** The last commit's reports -- kept for the session (not `reset()`) so the "View import
 *  report" notice affordance can reopen step 4 with the same data after the wizard closes. */
const _reports = ref<CommittedReport[]>([]);

export const isOpen = computed(() => _open.value);
export const step = computed(() => _step.value);
export const parseError = computed(() => _parseError.value);
export const snapshot = computed(() => _snapshot.value);
export const reports = computed(() => _reports.value);

/** A loadout's identity within the wizard -- `Loadoutname` alone isn't unique (two loadouts,
 *  or two characters, can share one), so every row/selection/name override is keyed by
 *  position instead. */
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

/** One row per loadout across every character, in file order. Runs the resolver in preview
 *  mode against the live (layers-included) db purely to compute a recognised-item count and a
 *  default build name -- nothing here writes anything. */
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

/** Reopens the wizard straight on the coverage-report step, showing the last commit's reports
 *  -- the "View import report" affordance on the post-import notice. */
export function openReport() {
  _open.value = true;
  _step.value = 4;
}

/** The active loadout of the first (recording) character only -- a demo can carry more than
 *  one character, but only one was actually being played when it was captured. */
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
      "That doesn't look like a demo file — no Packets block was found in it.";
    return;
  }

  const parsed = readSnapshot(root);
  if (!parsed.characters.length) {
    _parseError.value =
      "This demo has no character loadouts in it — it may have been recorded on a " +
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
  snap.characters.forEach((character, characterIndex) => {
    for (const loadout of character.loadouts) {
      const key = rowKey(characterIndex, loadout.index);
      if (!_selected.value.has(key)) continue;
      const { build, report } = buildFromLoadout(character, loadout, db.value, {
        name: nameFor(key),
      });
      newBuilds.push(build);
      newReports.push(report);
    }
  });
  if (!newBuilds.length) return;

  builds.importBuilds(newBuilds, false, layers.enabledOverlays.value);
  _reports.value = newBuilds.map((build, i) => ({
    buildName: build.name,
    report: newReports[i],
  }));
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
