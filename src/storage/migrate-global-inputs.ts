// Moving stored input values the catalog relocated: a bonus input promoted to a global input
// lands on the global slot's path, and a global input demoted back to a reader's own input
// lands on that reader.
//
// Not part of `normalize`, like migrate-item-ids.ts: the moves are read off the composed
// catalog, which `normalize` cannot see. Unlike that one it needs no player decision, so the
// builds store runs it wherever a build meets its catalog.
//
// Every migration is one primitive, a move: copy the value at a source to each target that
// holds nothing, then clear the source unless something still reads it. A value never changes
// meaning in place, so a move never overwrites and a source it clears is dead. Idempotent: a
// second run finds the sources empty or the targets full.
import { getPath, setPath } from "../lib/build-path";
import {
  bonusInputAddress,
  storedInput,
  writeInput,
} from "../lib/build-inputs";
import { expandSlots } from "../lib/item-picker-list";
import { isDisabled } from "../lib/slot-toggle";
import { isGlobalRef } from "../engine/global-inputs";
import type {
  Build,
  BuildParameterSlot,
  BuildSnapshot,
  Db,
  InputAddress,
} from "../types";

/** One relocated value. */
export interface InputMove {
  /** Candidate sources in catalog order. The first holding a value is moved, after reordering
   *  the bonus sources by `equippedRank`. */
  from: InputAddress[];
  /** Where the value lands. A target already holding a value keeps it. */
  to: InputAddress[];
  /** The targets' value type. A source holding the other type is dropped rather than moved,
   *  as its meaning would change. */
  type: "boolean" | "number";
  /** Set when the sources are still read after the move, so they keep their value. */
  keepFrom?: boolean;
}

const valueType = (slot: BuildParameterSlot): InputMove["type"] =>
  slot.paramType === "boolean" ? "boolean" : "number";

const pathAddress = (path: string): InputAddress => ({
  store: "context",
  path,
});

const promotionCache = new WeakMap<Db, InputMove[]>();

/** A promotion per global input: its readers' own addresses, under the local name each reads
 *  it by, move to the slot's path. The references are the migration data, so promoting keeps
 *  the local name. */
export function promotionMoves(db: Db): InputMove[] {
  const cached = promotionCache.get(db);
  if (cached) return cached;
  const readers = new Map<string, InputAddress[]>();
  for (const bonus of db.bonuses)
    for (const [name, decl] of Object.entries(bonus.inputs ?? {})) {
      if (!isGlobalRef(decl) || !db.globalInputs.has(decl.global)) continue;
      const list = readers.get(decl.global) ?? [];
      list.push(bonusInputAddress(bonus.id, name));
      readers.set(decl.global, list);
    }
  const moves = [...readers].map(([slotId, from]) => {
    const slot = db.globalInputs.get(slotId)!;
    return { from, to: [pathAddress(slot.path)], type: valueType(slot) };
  });
  promotionCache.set(db, moves);
  return moves;
}

/** Every context path `db` reads: plain parameters, and global inputs with a reader. */
function readPaths(db: Db): Set<string> {
  const referenced = new Set<string>();
  for (const bonus of db.bonuses)
    for (const decl of Object.values(bonus.inputs ?? {}))
      if (isGlobalRef(decl)) referenced.add(decl.global);
  const paths = new Set<string>();
  for (const slot of db.slots)
    if (
      slot.type === "build_parameter" &&
      (!slot.globalInput || referenced.has(slot.id))
    )
      paths.add(slot.path);
  return paths;
}

/** A demotion per global input of `prev` that a reader stopped referencing for an own input of
 *  the same name in `next`: the path's value moves to that reader. Only a catalog change can
 *  tell, as `next` alone does not say which global input an own input used to be. */
export function demotionMoves(prev: Db, next: Db): InputMove[] {
  const targets = new Map<string, InputAddress[]>();
  for (const bonus of prev.bonuses)
    for (const [name, decl] of Object.entries(bonus.inputs ?? {})) {
      if (!isGlobalRef(decl) || !prev.globalInputs.has(decl.global)) continue;
      const own = next.bonusById.get(bonus.id)?.inputs?.[name];
      if (!own || isGlobalRef(own)) continue;
      const slot = prev.globalInputs.get(decl.global)!;
      if ((own.type === "boolean") !== (slot.paramType === "boolean")) continue;
      const list = targets.get(decl.global) ?? [];
      list.push(bonusInputAddress(bonus.id, name));
      targets.set(decl.global, list);
    }
  if (!targets.size) return [];
  const read = readPaths(next);
  return [...targets].map(([slotId, to]) => {
    const slot = prev.globalInputs.get(slotId)!;
    return {
      from: [pathAddress(slot.path)],
      to,
      type: valueType(slot),
      keepFrom: read.has(slot.path),
    };
  });
}

const transitionCache = new WeakMap<Db, WeakMap<Db, InputMove[]>>();

/** Demotions from `prev` to `next`, then every promotion in `next`. Cached per pair, as one
 *  catalog change syncs every stored build. */
function transitionMoves(prev: Db, next: Db): InputMove[] {
  let byNext = transitionCache.get(prev);
  if (!byNext) transitionCache.set(prev, (byNext = new WeakMap()));
  const cached = byNext.get(next);
  if (cached) return cached;
  const moves = [...demotionMoves(prev, next), ...promotionMoves(next)];
  byNext.set(next, moves);
  return moves;
}

/** Each bonus held by `build`'s picks, by the place of the first slot holding it: the order in
 *  which disagreeing sources are preferred. A switched-off slot holds nothing. */
function equippedRank(db: Db, build: BuildSnapshot): Map<string, number> {
  const rank = new Map<string, number>();
  const hold = (itemId: string | undefined) => {
    const item = itemId ? db.get(itemId) : null;
    if (!item) return;
    for (const { bonus } of db.bonusesFor(item))
      if (!rank.has(bonus.id)) rank.set(bonus.id, rank.size);
  };
  for (const slot of expandSlots(db.slots, build)) {
    if (isDisabled(build, slot)) continue;
    if (slot.type === "item_picker") hold(build.choices[slot.id]);
    else if (slot.type === "point_assignment")
      for (const [itemId, count] of Object.entries(
        build.assignments[slot.id] ?? {},
      ))
        if (count > 0) hold(itemId);
  }
  return rank;
}

/** Clears `address`, dropping a context branch it leaves empty, so a value moved away and back
 *  leaves the context as it found it. */
function clearInput(build: BuildSnapshot, address: InputAddress) {
  writeInput(build, address, null);
  if (address.store !== "context") return;
  const keys = address.path.split(".");
  for (let depth = keys.length - 1; depth > 0; depth -= 1) {
    const branch = keys.slice(0, depth).join(".");
    const node = getPath(build.context, branch);
    if (!node || typeof node !== "object" || Object.keys(node).length) return;
    setPath(build.context, branch, undefined);
  }
}

/** Applies `moves` to `build` in place. True when anything changed. */
export function applyMoves(
  db: Db,
  build: BuildSnapshot,
  moves: readonly InputMove[],
): boolean {
  let changed = false;
  let rank: Map<string, number> | undefined;
  for (const move of moves) {
    const held = move.from.filter(
      (address) => storedInput(build, address) !== undefined,
    );
    if (!held.length) continue;
    if (held.length > 1) {
      rank ??= equippedRank(db, build);
      const of = (address: InputAddress) =>
        address.store === "bonusValues"
          ? (rank!.get(address.bonusId) ?? Number.MAX_SAFE_INTEGER)
          : Number.MAX_SAFE_INTEGER;
      held.sort((a, b) => of(a) - of(b));
    }
    const source = held.find(
      (address) => typeof storedInput(build, address) === move.type,
    );
    const value = source && storedInput(build, source);
    for (const target of move.to)
      if (value !== undefined && storedInput(build, target) === undefined) {
        writeInput(build, target, value);
        changed = true;
      }
    if (move.keepFrom) continue;
    for (const address of held) clearInput(build, address);
    changed = true;
  }
  return changed;
}

/**
 * Brings `build` and its downloaded snapshot onto `db`'s input addresses in place: demotions
 * since `prev` when the catalog it was last in line with is known, then every promotion. The
 * snapshot is moved the same way, or `sameContent` would read every promoted build as changed
 * since its download. True when anything changed.
 */
export function migrateGlobalInputs(db: Db, build: Build, prev?: Db): boolean {
  const moves =
    prev && prev !== db ? transitionMoves(prev, db) : promotionMoves(db);
  if (!moves.length) return false;
  const snapshot = build.downloaded?.snapshot;
  const changed = applyMoves(db, build, moves);
  const snapshotChanged = snapshot ? applyMoves(db, snapshot, moves) : false;
  return changed || snapshotChanged;
}
