// Moves the scenario flag picks of the retired `options.scenario` list onto the boolean global
// inputs that replaced them.
//
// Called from `normalize` after `migrateListSlots`, which has already moved the older fixed
// location and enemy type slots onto the list's rows. Idempotent: it writes no row it reads,
// and a flag the context already holds is left as stored.
import { getPath, setPath } from "../lib/build-path";
import { parseRowSlotId } from "../lib/item-picker-list";
import { mapSlotIds } from "../lib/slot-fields";
import type { SlotData } from "../lib/slot-fields";
import type { CatalogOverlay, SectionPreset } from "../types";

const RETIRED_LIST = "options.scenario";

/** The global input path each flag item became. Frozen: a record of what shipped, not a view
 *  of `data/slots.json`. The Non-boss flag maps to nothing, as the Boss flag off says it. */
export const FLAG_PATHS: Record<string, string | null> = {
  "enemy-type-boss": "globals.enemyTier.boss",
  "enemy-type-non-boss": null,
  "location-chult": "globals.location.chult",
  "location-thay": "globals.location.thay",
  "location-wildspace": "globals.location.wildspace",
};

const isRetiredRow = (slotId: string) =>
  parseRowSlotId(slotId)?.listId === RETIRED_LIST;

/**
 * A build's stored rows with the retired list's rows dropped, and the context paths its flag
 * picks set. A pick of any other item is dropped with its row, as no slot shows it.
 */
export function migrateScenarioFlags(stored: SlotData): {
  stored: SlotData;
  flags: string[];
} {
  const flags: string[] = [];
  for (const [slotId, itemId] of Object.entries(stored.choices ?? {})) {
    const path = isRetiredRow(slotId) ? FLAG_PATHS[itemId] : null;
    if (path && !flags.includes(path)) flags.push(path);
  }
  const hasRows = Object.values(stored).some((field) =>
    Object.keys(field ?? {}).some(isRetiredRow),
  );
  return {
    stored: hasRows
      ? mapSlotIds(stored, (slotId) => (isRetiredRow(slotId) ? null : slotId))
      : stored,
    flags,
  };
}

/** Sets each of `flags` in `context` unless it already holds a value there. */
export function applyScenarioFlags(
  context: Record<string, unknown>,
  flags: readonly string[],
): void {
  for (const path of flags)
    if (getPath(context, path) === undefined) setPath(context, path, true);
}

/** `listRows` without the retired list's count. */
export function withoutScenarioRows(
  listRows: Record<string, number>,
): Record<string, number> {
  if (!(RETIRED_LIST in listRows)) return listRows;
  const { [RETIRED_LIST]: _retired, ...rest } = listRows;
  return rest;
}

/** One preset with the retired list's rows dropped. Its flags are not carried: a preset sets
 *  the slots of its own section, and the global inputs have none it can name. */
function migratePreset(preset: SectionPreset): SectionPreset {
  const named = [
    ...Object.keys(preset.choices ?? {}),
    ...Object.keys(preset.values ?? {}),
    ...Object.keys(preset.assignments ?? {}),
    ...(preset.clears ?? []),
  ];
  if (!named.some(isRetiredRow)) return preset;
  const drop = <T>(field: Record<string, T> | undefined) =>
    field &&
    Object.fromEntries(
      Object.entries(field).filter(([slotId]) => !isRetiredRow(slotId)),
    );
  const migrated: SectionPreset = { ...preset };
  if (preset.choices) migrated.choices = drop(preset.choices);
  if (preset.values) migrated.values = drop(preset.values);
  if (preset.assignments) migrated.assignments = drop(preset.assignments);
  if (preset.clears)
    migrated.clears = preset.clears.filter((slotId) => !isRetiredRow(slotId));
  return migrated;
}

/** An overlay's authored presets, migrated. */
export function migrateOverlayScenarioFlags(
  overlay: CatalogOverlay,
): CatalogOverlay {
  const sectionPresets: CatalogOverlay["sectionPresets"] = {};
  for (const [id, preset] of Object.entries(overlay.sectionPresets))
    sectionPresets[id] = preset ? migratePreset(preset) : preset;
  return { ...overlay, sectionPresets };
}
