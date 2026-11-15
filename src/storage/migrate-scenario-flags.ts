// Moves what a retired catalog entry stood for onto its replacement: the scenario flag picks of
// the retired `options.scenario` list onto the shared enemy rank input and Location pick, and a
// retired private bonus input onto the shared input the bonus now reads.
//
// Called from `normalize` after `migrateListSlots`, which has already moved the older fixed
// location and enemy type slots onto the list's rows. Idempotent: it writes no row it reads,
// and a value the build already holds is left as stored.
import { getPath, setPath } from "../lib/build-path";
import { parseRowSlotId } from "../lib/item-picker-list";
import { mapSlotIds } from "../lib/slot-fields";
import type { SlotData } from "../lib/slot-fields";
import type {
  BonusValues,
  CatalogOverlay,
  InputValue,
  SectionPreset,
} from "../types";

const RETIRED_LIST = "options.scenario";

/** The shared Location pick. Frozen, like the tables below: a record of what shipped, not a
 *  view of `data/slots.json`. */
export const LOCATION_SLOT = "shared.location";

/** A value written at a shared input's path. */
export interface ContextWrite {
  path: string;
  value: number;
}

/** The enemy rank each enemy flag item became. Boss is the rank's default, so Non-boss needs
 *  a value of its own: Solo, the strongest rank below Boss. */
export const FLAG_VALUES: Record<string, ContextWrite> = {
  "enemy-type-boss": { path: "shared.enemyRank", value: 6 },
  "enemy-type-non-boss": { path: "shared.enemyRank", value: 5 },
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
 * A build's stored rows with the retired list's rows dropped, the context values its enemy
 * flag picks set, the first stored winning a path, and its first location pick in stored order moved onto Location unless that
 * already holds one. A pick of any other item is dropped with its row, as no slot shows it.
 */
export function migrateScenarioFlags(stored: SlotData): {
  stored: SlotData;
  flags: ContextWrite[];
} {
  const flags: ContextWrite[] = [];
  let location: string | undefined;
  for (const [slotId, itemId] of Object.entries(stored.choices ?? {})) {
    if (!isRetiredRow(slotId)) continue;
    const flag = FLAG_VALUES[itemId];
    if (flag && !flags.some(({ path }) => path === flag.path)) flags.push(flag);
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

/** What a retired private input's stored value became. */
type RetiredTarget =
  | { kind: "value"; path: string; value: number }
  | { kind: "pick"; slot: string; item: string };

/** A private input a catalog change retired, and the replacement its stored value moves to.
 *  Frozen, like the tables above: a record of what shipped, not a view of `data/slots.json`. */
interface RetiredInput {
  bonus: string;
  input: string;
  /** The stored value the replacement can express. The input's other value is only dropped. */
  when: InputValue;
  becomes: RetiredTarget;
}

export const RETIRED_INPUTS: readonly RetiredInput[] = [
  {
    bonus: "sword-coast-tactician-2",
    input: "active",
    when: true,
    becomes: {
      kind: "pick",
      slot: LOCATION_SLOT,
      item: "location-sword-coast",
    },
  },
  {
    bonus: "fleeting-haste-2",
    input: "active",
    when: false,
    becomes: { kind: "value", path: "shared.actionPoints", value: 1 },
  },
  {
    bonus: "master-cruelty",
    input: "active",
    when: false,
    becomes: { kind: "value", path: "shared.stamina", value: 0.5 },
  },
  {
    bonus: "master-s-precision",
    input: "active",
    when: true,
    becomes: { kind: "value", path: "shared.stamina", value: 0.5 },
  },
  {
    bonus: "trainer-s-restoration",
    input: "active",
    when: true,
    becomes: { kind: "value", path: "shared.actionPoints", value: 1 },
  },
];

/**
 * A build's stored private inputs with the retired ones dropped: the value a `RETIRED_INPUTS`
 * entry names lands on its replacement unless that already holds one, while the input's other
 * value is dropped with it, as it has no replacement. Returns the maps unchanged when no
 * retired input is stored.
 */
export function migrateRetiredInputs(
  choices: Record<string, string>,
  bonusValues: Record<string, BonusValues>,
): {
  choices: Record<string, string>;
  bonusValues: Record<string, BonusValues>;
  values: ContextWrite[];
} {
  let nextChoices = choices;
  let nextBonusValues = bonusValues;
  const values: ContextWrite[] = [];
  for (const { bonus, input, when, becomes } of RETIRED_INPUTS) {
    const stored = nextBonusValues[bonus]?.input?.[input];
    if (stored === undefined) continue;
    nextBonusValues = withoutInput(nextBonusValues, bonus, input);
    if (stored !== when) continue;
    if (becomes.kind === "value")
      values.push({ path: becomes.path, value: becomes.value });
    else if (!nextChoices[becomes.slot])
      nextChoices = { ...nextChoices, [becomes.slot]: becomes.item };
  }
  return { choices: nextChoices, bonusValues: nextBonusValues, values };
}

/** `bonusValues` without one bonus input, dropping containers it leaves empty. */
function withoutInput(
  bonusValues: Record<string, BonusValues>,
  bonusId: string,
  input: string,
): Record<string, BonusValues> {
  const values = bonusValues[bonusId]!;
  const { [input]: _dropped, ...kept } = values.input!;
  const { input: _inputs, ...rest } = values;
  const next: BonusValues = Object.keys(kept).length
    ? { ...rest, input: kept }
    : rest;
  const out = { ...bonusValues };
  if (Object.keys(next).length) out[bonusId] = next;
  else delete out[bonusId];
  return out;
}

/** Sets each of `writes` in `context` unless it already holds a value there. */
export function applyContextWrites(
  context: Record<string, unknown>,
  writes: readonly ContextWrite[],
): void {
  for (const { path, value } of writes)
    if (getPath(context, path) === undefined) setPath(context, path, value);
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
 *  the slots of its own section, and the shared inputs have none it can name. */
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
