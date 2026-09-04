// Rewriting a build's stored item ids onto the items that superseded them (`Item.replacedBy`).
//
// Not part of `normalise`, unlike migrate-list-slots.ts's slot renames: that table is a frozen
// record of what shipped, while this one is a view of the composed catalogue, which varies per
// build and which `normalise` cannot see. Runs only when the player accepts the offer.
//
// Pure and idempotent: an id it produces is one nothing supersedes.
import { retiredChoices } from "../data/db";
import { getPath, setPath } from "../lib/build-path";
import { dynamicValueKey } from "../lib/dynamic-stats";
import type { Build, BuildContext, Db } from "../types";

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
  // point-assignment row or a leftover occurrence count can name a retired item on its own.
  for (const counts of Object.values(build.assignments ?? {}))
    for (const id of Object.keys(counts)) note(id);
  for (const id of Object.keys(build.occurrenceInputs ?? {})) note(id);
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

  const values = seedValues(db, build);

  const assignments: Record<string, Record<string, number>> = {};
  for (const [slotId, counts] of Object.entries(build.assignments ?? {}))
    assignments[slotId] = moveCounts(counts, map);

  // Two passes so the result does not depend on key order: retired counts land first, the
  // replacement's own overwrite them per bonus.
  const occurrenceInputs: Record<string, Record<string, number>> = {};
  const entries = Object.entries(build.occurrenceInputs ?? {});
  for (const [itemId, byBonus] of entries) {
    const moved = map.get(itemId);
    if (moved)
      occurrenceInputs[moved] = { ...occurrenceInputs[moved], ...byBonus };
  }
  for (const [itemId, byBonus] of entries) {
    if (!map.has(itemId))
      occurrenceInputs[itemId] = { ...occurrenceInputs[itemId], ...byBonus };
  }

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

  return { ...build, choices, values, assignments, occurrenceInputs, context };
}

/**
 * `build.values` with each retired pick's carried magnitude written under its slot, so the
 * replacement starts on that number rather than its own `default`.
 *
 * Never overwrites a value the player typed, and skips a stat the replacement declares no
 * `dynamicStats` entry for, which nothing would read. `choices` only: a point_assignment row's
 * items share one slot, so per-item magnitudes could not be told apart there.
 */
function seedValues(db: Db, build: Build, only?: string): Build["values"] {
  let values = build.values;
  for (const [slotId, itemId] of Object.entries(build.choices ?? {})) {
    if (!itemId || (only !== undefined && slotId !== only)) continue;
    const seeds = db.replacementSeeds(itemId);
    // The replacement's configs, since that is the item the slot is about to hold.
    const declared = new Set(
      (db.replacementFor(itemId)?.dynamicStats ?? []).map(
        (config) => config.stat,
      ),
    );
    for (const [stat, value] of Object.entries(seeds)) {
      if (value === undefined || !declared.has(stat)) continue;
      const key = dynamicValueKey(stat);
      if (values[slotId]?.[key] !== undefined) continue;
      if (values === build.values) values = { ...build.values };
      values[slotId] = { ...values[slotId], [key]: value };
    }
  }
  return values;
}

/**
 * One slot's retired pick swapped, leaving the rest of the build alone -- the per-row "update".
 *
 * `occurrenceInputs` is keyed by item id with no slot to scope it, so those counts move only
 * once nothing else in the build still holds the retired item.
 */
export function migrateSlotItem(db: Db, build: Build, slotId: string): Build {
  const from = build.choices?.[slotId];
  const to = from ? db.replacementFor(from) : null;
  if (!from || !to) return build;

  const choices = { ...build.choices, [slotId]: to.id };
  const values = seedValues(db, { ...build, choices: build.choices }, slotId);

  const stillHeld =
    Object.values(choices).includes(from) ||
    Object.values(build.assignments ?? {}).some((counts) => from in counts);
  const counts = build.occurrenceInputs?.[from];
  const occurrenceInputs =
    stillHeld || !counts
      ? build.occurrenceInputs
      : (() => {
          const { [from]: moved, ...rest } = build.occurrenceInputs;
          return { ...rest, [to.id]: { ...rest[to.id], ...moved } };
        })();

  return { ...build, choices, values, occurrenceInputs };
}
