// Moves the scenario flag picks of the retired `options.scenario` list onto what replaced them:
// the Boss flag onto its boolean global input, a location onto the shared Location pick. Also
// moves Sword Coast Tactician's private "active" input onto that pick.
//
// Called from `normalize` after `migrateListSlots`, which has already moved the older fixed
// location and enemy type slots onto the list's rows. Idempotent: it writes no row it reads,
// and a flag or pick the build already holds is left as stored.
import { getPath, setPath } from "../lib/build-path";
import { parseRowSlotId } from "../lib/item-picker-list";
import { mapSlotIds } from "../lib/slot-fields";
import type { SlotData } from "../lib/slot-fields";
import type { BonusValues, CatalogOverlay, SectionPreset } from "../types";

const RETIRED_LIST = "options.scenario";

/** The shared Location pick. Frozen, like the tables below: a record of what shipped, not a
 *  view of `data/slots.json`. */
export const LOCATION_SLOT = "globals.location";

/** The global input path each enemy flag item became. The Non-boss flag maps to nothing, as
 *  the Boss flag off says it. */
export const FLAG_PATHS: Record<string, string | null> = {
  "enemy-type-boss": "globals.enemyTier.boss",
  "enemy-type-non-boss": null,
};

/** The location flag items, which kept their ids as Location picks. */
export const LOCATION_FLAGS: readonly string[] = [
  "location-chult",
  "location-thay",
  "location-wildspace",
];

const isRetiredRow = (slotId: string) =>
  parseRowSlotId(slotId)?.listId === RETIRED_LIST;

/**
 * A build's stored rows with the retired list's rows dropped, the context paths its enemy flag
 * picks set, and its first location pick in stored order moved onto Location unless that
 * already holds one. A pick of any other item is dropped with its row, as no slot shows it.
 */
export function migrateScenarioFlags(stored: SlotData): {
  stored: SlotData;
  flags: string[];
} {
  const flags: string[] = [];
  let location: string | undefined;
  for (const [slotId, itemId] of Object.entries(stored.choices ?? {})) {
    if (!isRetiredRow(slotId)) continue;
    const path = FLAG_PATHS[itemId];
    if (path && !flags.includes(path)) flags.push(path);
    if (LOCATION_FLAGS.includes(itemId)) location ??= itemId;
  }
  const hasRows = Object.values(stored).some((field) =>
    Object.keys(field ?? {}).some(isRetiredRow),
  );
  const out = hasRows
    ? mapSlotIds(stored, (slotId) => (isRetiredRow(slotId) ? null : slotId))
    : stored;
  return { stored: withLocation(out, location), flags };
}

/** `stored` with `location` picked on Location, unless it holds a pick already. */
function withLocation(stored: SlotData, location: string | undefined) {
  if (!location || stored.choices?.[LOCATION_SLOT]) return stored;
  return {
    ...stored,
    choices: { ...stored.choices, [LOCATION_SLOT]: location },
  };
}

const SWORD_COAST_BONUS = "sword-coast-tactician-2";
const SWORD_COAST_INPUT = "active";
const SWORD_COAST = "location-sword-coast";

/**
 * Sword Coast Tactician's private "on Sword Coast" input, moved onto Location: `true` picks
 * Sword Coast while Location is empty, and either value is dropped, as the bonus now reads the
 * pick. Returns the maps unchanged when the input is not stored.
 */
export function migrateSwordCoastInput(
  choices: Record<string, string>,
  bonusValues: Record<string, BonusValues>,
): {
  choices: Record<string, string>;
  bonusValues: Record<string, BonusValues>;
} {
  const values = bonusValues[SWORD_COAST_BONUS];
  const stored = values?.input?.[SWORD_COAST_INPUT];
  if (stored === undefined) return { choices, bonusValues };
  const { [SWORD_COAST_INPUT]: _dropped, ...input } = values!.input!;
  const { input: _input, ...rest } = values!;
  const kept: BonusValues = Object.keys(input).length
    ? { ...rest, input }
    : rest;
  const { [SWORD_COAST_BONUS]: _bonus, ...others } = bonusValues;
  return {
    choices:
      stored === true && !choices[LOCATION_SLOT]
        ? { ...choices, [LOCATION_SLOT]: SWORD_COAST }
        : choices,
    bonusValues: Object.keys(kept).length
      ? { ...others, [SWORD_COAST_BONUS]: kept }
      : others,
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
