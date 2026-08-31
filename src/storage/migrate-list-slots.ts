// Renaming what a pre-`item_picker_list` build stored onto the rows those lists expand into.
//
// Called from `normalise`/`normaliseLayer`, so every door a build or layer arrives through --
// IndexedDB, an import, a bundle, a share link -- is covered by one pass. Idempotent: no id it
// produces is one it renames.
import { rowSlotId } from "../lib/item-picker-list";
import type { CatalogOverlay, SectionPreset } from "../types";

/** The fixed slots each list replaced, in the order they were authored. A record of what
 * shipped rather than a view of `data/slots.json`: relabelling or reordering a list slot must
 * not change what an old build migrates to. */
const RETIRED_SLOTS: Record<string, string[]> = {
  "classStuff.classStuff": numbered("classStuff.classStuff", 10),
  "group.group": numbered("group.group", 28),
  "artifactCall.artifactCall": numbered("artifactCall.artifactCall", 26),
  "misc.misc": numbered("misc.misc", 8),
  // Two slots into one list, location first -- the order the Options section listed them in.
  "options.scenario": ["options.location", "options.enemyType"],
};

function numbered(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`);
}

const RETIRED_IDS = new Set(Object.values(RETIRED_SLOTS).flat());

/**
 * Old slot id -> the row it becomes. Occupied slots are renumbered densely in the order they
 * were authored: these lists never had per-position meaning, so compacting a sparse old build
 * (the shipped fixture holds 12 Group picks spread over slots 1-22) loses nothing and leaves no
 * empty rows to delete by hand.
 */
function renamesFor(
  occupied: (slotId: string) => boolean,
): Map<string, string> {
  const renames = new Map<string, string>();
  for (const [listId, oldIds] of Object.entries(RETIRED_SLOTS)) {
    let row = 0;
    for (const oldId of oldIds) {
      if (!occupied(oldId)) continue;
      row += 1;
      renames.set(oldId, rowSlotId(listId, row));
    }
  }
  return renames;
}

/** `source` re-keyed, dropping a retired id that earned no row. */
function moveKeys<T>(
  source: Record<string, T> | undefined,
  renames: Map<string, string>,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, value] of Object.entries(source ?? {})) {
    const renamed = renames.get(key);
    if (renamed) out[renamed] = value;
    else if (!RETIRED_IDS.has(key)) out[key] = value;
  }
  return out;
}

export interface StoredRows {
  choices: Record<string, string>;
  values: Record<string, Record<string, number>>;
  assignments: Record<string, Record<string, number>>;
}

/**
 * A build's stored rows, migrated. Occupancy is the pick alone: a retired id carrying a
 * magnitude or a repetition count but no choice is an orphan (`setChoice` drops both when a
 * slot is cleared), so it is dropped rather than given a row of its own.
 *
 * No row counts come back -- `normalise`'s own `rowCounts` already grows a list to cover every
 * row its stored keys name, and compaction leaves those keys contiguous.
 */
export function migrateListSlots(stored: StoredRows): StoredRows {
  const renames = renamesFor((slotId) => Boolean(stored.choices?.[slotId]));
  return {
    choices: moveKeys(stored.choices, renames),
    values: moveKeys(stored.values, renames),
    assignments: moveKeys(stored.assignments, renames),
  };
}

/**
 * One `SectionPreset`, migrated. Unlike a build, a preset counts a slot named only in `clears`
 * as occupied: clearing row 5 asserts there is a row 5, which is how a preset says "this list
 * ends here" rather than merging into whatever was already there.
 */
export function migratePresetListSlots(preset: SectionPreset): SectionPreset {
  const cleared = new Set(preset.clears ?? []);
  const renames = renamesFor(
    (slotId) =>
      Boolean(preset.choices?.[slotId]) ||
      slotId in (preset.values ?? {}) ||
      slotId in (preset.assignments ?? {}) ||
      cleared.has(slotId),
  );
  if (!renames.size) return preset;

  const migrated: SectionPreset = { ...preset };
  if (preset.choices) migrated.choices = moveKeys(preset.choices, renames);
  if (preset.values) migrated.values = moveKeys(preset.values, renames);
  if (preset.assignments)
    migrated.assignments = moveKeys(preset.assignments, renames);
  if (preset.clears) {
    migrated.clears = preset.clears
      .map((slotId) => renames.get(slotId) ?? slotId)
      .filter((slotId) => !RETIRED_IDS.has(slotId));
  }
  return migrated;
}

/** An overlay's authored presets, migrated. Its `slots` entries are left alone: an overlay
 * redefining a retired id now simply adds that slot back, which is what its author wrote. */
export function migrateOverlayListSlots(
  overlay: CatalogOverlay,
): CatalogOverlay {
  const sectionPresets: CatalogOverlay["sectionPresets"] = {};
  for (const [id, preset] of Object.entries(overlay.sectionPresets)) {
    sectionPresets[id] = preset ? migratePresetListSlots(preset) : preset;
  }
  return { ...overlay, sectionPresets };
}
