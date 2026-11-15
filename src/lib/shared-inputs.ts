// Which shared slots a build uses, and where their controls show. A shared slot shows a row of
// its own in the Shared inputs section only while the build uses it, which each kind of slot
// decides in `KINDS`. Display only: nothing here changes what the engine resolves.
import { isSharedSlot } from "../engine/shared-inputs";
import type { InputEntry } from "../engine/inputs";
import { isCarried } from "./bonus-inspector";
import type { Build, Db, EvaluatedBonus, ItemPickerSlot, Slot } from "../types";

/** What a note naming rows and sections reads. */
type LabelDb = Pick<Db, "slotFor" | "slotById">;

type SharedSlot = Extract<Slot, { type: "build_parameter" | "item_picker" }>;

interface SharedKind {
  /** Whether the slot's own row shows, given the rows its equipped readers anchor on. */
  rowShown(slot: SharedSlot, build: Build, readers: readonly string[]): boolean;
}

const KINDS: Record<SharedSlot["type"], SharedKind> = {
  /** A param holds no pick, so it shows while an equipped bonus reads it. */
  build_parameter: {
    rowShown: (_slot, _build, readers) => readers.length > 0,
  },
  /** A pick is equipped whatever reads it, so its row stays while it holds one: a pick is
   *  never equipped without a row showing it. */
  item_picker: {
    rowShown: (slot, build, readers) =>
      readers.length > 0 || Boolean(build.choices[slot.id]),
  },
};

const isShared = (slot: Slot): slot is SharedSlot => isSharedSlot(slot);

/** The equipped bonuses reading each shared picker, by its slot id, in build order. */
export function sharedPickerReaders(
  db: Pick<Db, "sharedReaders">,
  bonuses: readonly EvaluatedBonus[],
): Map<string, EvaluatedBonus[]> {
  const map = new Map<string, EvaluatedBonus[]>();
  for (const [slotId, readerIds] of db.sharedReaders) {
    const ids = new Set(readerIds);
    const carried = bonuses.filter(
      (bonus) => ids.has(bonus.bonusId) && isCarried(bonus),
    );
    if (carried.length) map.set(slotId, carried);
  }
  return map;
}

const unique = (ids: string[]) => [...new Set(ids)];

/** The rows the equipped readers of each shared slot anchor on, by its id, each row once and
 *  in build order. `params` is `sharedInputReaders`' map, `pickers` `sharedPickerReaders`'. */
export function sharedReaderRows(
  params: ReadonlyMap<string, readonly InputEntry[]>,
  pickers: ReadonlyMap<string, readonly EvaluatedBonus[]> = new Map(),
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [slotId, entries] of params)
    map.set(slotId, unique(entries.map((entry) => entry.slotId)));
  for (const [slotId, bonuses] of pickers)
    map.set(slotId, unique(bonuses.map((bonus) => bonus.slotId)));
  return map;
}

/** The shared slots in `slots` whose own row shows. */
export function sharedRowIds(
  slots: readonly Slot[],
  build: Build,
  readerRows: ReadonlyMap<string, readonly string[]>,
): Set<string> {
  const ids = new Set<string>();
  for (const slot of slots)
    if (
      isShared(slot) &&
      KINDS[slot.type].rowShown(slot, build, readerRows.get(slot.id) ?? [])
    )
      ids.add(slot.id);
  return ids;
}

/** A slot's canonical name: what every reference to it reads, not what its own row reads. */
const slotName = (db: LabelDb, slotId: string) =>
  db.slotFor(slotId)?.label ?? slotId;

/** A row named in a shared slot's notes, by its slot id and label. */
export interface SharedRowLink {
  key: string;
  label: string;
}

/** The rows reading a shared slot, as its own row's "Used by" links. Empty when none does. */
export function usedByLinks(
  db: LabelDb,
  rows: readonly string[] | undefined,
): SharedRowLink[] {
  return (rows ?? []).map((row) => ({ key: row, label: slotName(db, row) }));
}

/** The tooltip on a shared control on reader row `ownRow`, naming the other reader rows. */
export function sharedTooltip(
  db: LabelDb,
  ownRow: string,
  rows: readonly string[] | undefined,
): string {
  const others = (rows ?? [])
    .filter((row) => row !== ownRow)
    .map((row) => slotName(db, row));
  const last = others.pop();
  if (last === undefined) return "Shared input";
  const list = others.length ? `${others.join(", ")} and ${last}` : last;
  return `Shared input, also on ${list}`;
}

/** A shared picker's control on one reader's row. */
export interface SharedPickerControl {
  slot: ItemPickerSlot;
  /** Where else it is set, as the tooltip on its shared mark. */
  shared: string;
}

/** The shared picker controls each row shows, by row slot id: one per shared picker an
 *  equipped bonus anchored on the row reads, however many of them read it. `readerRows` is
 *  `sharedReaderRows`' map. */
export function sharedPickersByRow(
  db: LabelDb,
  readerRows: ReadonlyMap<string, readonly string[]>,
): Map<string, SharedPickerControl[]> {
  const map = new Map<string, SharedPickerControl[]>();
  for (const [slotId, rows] of readerRows) {
    const slot = db.slotById.get(slotId);
    if (slot?.type !== "item_picker") continue;
    for (const row of rows) {
      const control = { slot, shared: sharedTooltip(db, row, rows) };
      const bucket = map.get(row);
      if (bucket) bucket.push(control);
      else map.set(row, [control]);
    }
  }
  return map;
}
