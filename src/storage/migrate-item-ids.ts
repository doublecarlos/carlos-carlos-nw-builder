// Rewriting a build's stored item ids onto the items that superseded them (`Item.replacedBy`).
//
// Not part of `normalize`, unlike migrate-list-slots.ts's slot renames: that table is a frozen
// record of what shipped, while this one is a view of the composed catalog, which varies per
// build and which `normalize` cannot see. Runs only when the player accepts the offer.
//
// Pure and idempotent: an id it produces is one nothing supersedes.
import { retiredChoices } from "../data/db";
import { getPath, setPath } from "../lib/build-path";
import { writeTypedValues, type TypedValues } from "../lib/build-inputs";
import { parseRowSlotId } from "../lib/item-picker-list";
import { bonusStatConfigs } from "../engine/inputs";
import { privateInputs } from "../engine/global-inputs";
import type {
  BonusValues,
  Build,
  BuildContext,
  Db,
  SlotValues,
} from "../types";

/** Every stored id in `build` that `db` now resolves to a different item, old id to new. */
export function replacements(db: Db, build: Build): Map<string, string> {
  const map = new Map<string, string>();
  const note = (id: string | undefined) => {
    if (!id || map.has(id)) return;
    const to = db.replacementFor(id);
    if (to) map.set(id, to.id);
  };

  for (const { from, to } of retiredChoices(db, build)) map.set(from, to.id);
  // Reached through `choices` too whenever the same item is also picked somewhere, but a
  // point-assignment row can name a retired item on its own.
  for (const counts of Object.values(build.assignments ?? {}))
    for (const id of Object.keys(counts)) note(id);
  for (const path of optionsFromPaths(db)) {
    const current = getPath(build.context, path);
    if (typeof current === "string") note(current);
  }
  return map;
}

/** Context paths whose stored value is an item id: a `list` param with `optionsFrom`, whose
 *  option `value` is the id itself. Every other param holds a scalar. */
function optionsFromPaths(db: Db): string[] {
  return db.slots
    .filter((slot) => slot.type === "build_parameter" && slot.optionsFrom)
    .map((slot) => (slot as { path: string }).path);
}

/** `counts` re-keyed onto replacements. A count already under the replacement wins, since
 *  summing the two would silently double a stack. */
function moveCounts(
  counts: Record<string, number>,
  map: Map<string, string>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, count] of Object.entries(counts)) {
    const key = map.get(id) ?? id;
    if (!(key in out) || !map.has(id)) out[key] = count;
  }
  return out;
}

/**
 * `build` with every retired item id rewritten, or the same object when there is nothing to do.
 *
 * `Build.values` is keyed by slot and stat rather than by item, so typed magnitudes survive
 * untouched; the only thing written into it is a seed (`seedValues`), which is what keeps the
 * swap stat-neutral.
 */
export function migrateItemIds(db: Db, build: Build): Build {
  const map = replacements(db, build);
  if (!map.size) return build;

  const choices: Record<string, string> = {};
  for (const [slotId, itemId] of Object.entries(build.choices ?? {}))
    choices[slotId] = map.get(itemId) ?? itemId;

  const seeded = seedValues(db, build);

  const assignments: Record<string, Record<string, number>> = {};
  for (const [slotId, counts] of Object.entries(build.assignments ?? {}))
    assignments[slotId] = moveCounts(counts, map);

  // Cloned, not shallow-copied: a param path may address a nested branch a shallow copy would
  // still share with the input.
  let context = build.context;
  for (const path of optionsFromPaths(db)) {
    const current = getPath(context, path);
    const moved = typeof current === "string" ? map.get(current) : undefined;
    if (!moved) continue;
    if (context === build.context)
      context = structuredClone(build.context) as BuildContext;
    setPath(context, path, moved);
  }

  return { ...build, ...seeded, choices, assignments, context };
}

/**
 * `build`'s typed values with each retired pick's carried settings written in, so the
 * replacement starts on them rather than its own defaults.
 *
 * Never overwrites a value the player set, and skips a setting the replacement does not
 * declare, which nothing would read. Bonus settings are per build, so when two picks seed one,
 * the first in slot order wins. `choices` only: a point_assignment row's items share one slot,
 * so per-item magnitudes could not be told apart there.
 */
function seedValues(
  db: Db,
  build: Build,
  only?: string,
): Pick<Build, "values" | "bonusValues"> {
  // Top-level copies are enough: `writeInput` replaces the inner maps it touches.
  const out = {
    ...build,
    values: { ...build.values },
    bonusValues: { ...build.bonusValues },
  };
  const picks = Object.entries(build.choices ?? {}).sort(
    ([a], [b]) => slotRank(db, a) - slotRank(db, b),
  );
  for (const [slotId, itemId] of picks) {
    if (!itemId || (only !== undefined && slotId !== only)) continue;
    writeTypedValues(out, seedsFor(db, slotId, itemId), { overwrite: false });
  }
  return { values: out.values, bonusValues: out.bonusValues };
}

/** A slot's place in the layout; a list row sorts after its list's earlier rows. */
function slotRank(db: Db, slotId: string): number {
  const row = parseRowSlotId(slotId);
  const base = db.slots.findIndex(
    (slot) => slot.id === (row?.listId ?? slotId),
  );
  if (base < 0) return Infinity;
  return row ? base + row.index / (row.index + 1) : base;
}

/** What a retired pick at `slotId` seeds, limited to what its replacement declares. */
function seedsFor(db: Db, slotId: string, itemId: string): TypedValues {
  // The replacement's declarations, since that is the item the slot is about to hold.
  const to = db.replacementFor(itemId);
  const declared = new Set(
    (to?.dynamicStats ?? []).map((config) => config.stat),
  );
  const stat: SlotValues["stat"] = {};
  for (const [key, value] of Object.entries(db.replacementSeeds(itemId)))
    if (value !== undefined && declared.has(key)) stat[key] = value;

  const seeds = db.replacementBonusSeeds(itemId);
  const bonusValues: Record<string, BonusValues> = {};
  for (const { bonus } of to ? db.bonusesFor(to) : []) {
    const seed = seeds[bonus.id];
    if (!seed) continue;
    const stats = new Set(bonusStatConfigs(bonus).map((config) => config.stat));
    const ownInputs = new Set(privateInputs(bonus).map(([name]) => name));
    bonusValues[bonus.id] = {
      stat: pick(seed.stat, (key) => stats.has(key)),
      input: pick(seed.input, (name) => ownInputs.has(name)),
    };
  }
  return { values: { [slotId]: { stat } }, bonusValues };
}

/** The entries of `record` whose key passes `keep`. */
function pick<T>(
  record: Record<string, T> | undefined,
  keep: (key: string) => boolean,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record ?? {}).filter(([key]) => keep(key)),
  );
}

/** One slot's retired pick swapped, leaving the rest of the build alone -- the per-row "update". */
export function migrateSlotItem(db: Db, build: Build, slotId: string): Build {
  const from = build.choices?.[slotId];
  const to = from ? db.replacementFor(from) : null;
  if (!from || !to) return build;

  const choices = { ...build.choices, [slotId]: to.id };
  const seeded = seedValues(db, build, slotId);

  return { ...build, ...seeded, choices };
}
