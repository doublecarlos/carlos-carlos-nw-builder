// Which shared slots a build uses, and where their controls show. A shared slot shows a row of
// its own in the Shared inputs section only while the build uses it, which each kind of slot
// decides in `KINDS`. Display only: nothing here changes what the engine resolves.
import { isSharedSlot } from "../engine/global-inputs";
import type { InputEntry } from "../engine/inputs";
import { isCarried } from "./bonus-inspector";
import type { Build, Db, EvaluatedBonus, ItemPickerSlot, Slot } from "../types";

type SharedSlot = Extract<Slot, { type: "build_parameter" | "item_picker" }>;

interface SharedKind {
  /** Whether the slot's own row shows, given the names of its equipped readers. */
  rowShown(slot: SharedSlot, build: Build, users: readonly string[]): boolean;
}

const KINDS: Record<SharedSlot["type"], SharedKind> = {
  /** A param holds no pick, so it shows while an equipped bonus reads it. */
  build_parameter: { rowShown: (_slot, _build, users) => users.length > 0 },
  /** A pick is equipped whatever reads it, so its row stays while it holds one: a pick is
   *  never equipped without a row showing it. */
  item_picker: {
    rowShown: (slot, build, users) =>
      users.length > 0 || Boolean(build.choices[slot.id]),
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

const unique = (names: string[]) => [...new Set(names)];

/** The names of the equipped bonuses reading each shared slot, by its id, each name once and
 *  in build order. `params` is `globalInputReaders`' map, `pickers` `sharedPickerReaders`'. */
export function sharedUsers(
  params: ReadonlyMap<string, readonly InputEntry[]>,
  pickers: ReadonlyMap<string, readonly EvaluatedBonus[]> = new Map(),
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [slotId, entries] of params)
    map.set(slotId, unique(entries.map((entry) => entry.source)));
  for (const [slotId, bonuses] of pickers)
    map.set(
      slotId,
      unique(bonuses.map((bonus) => bonus.bonus.name ?? bonus.bonusId)),
    );
  return map;
}

/** The shared slots in `slots` whose own row shows. */
export function sharedRowIds(
  slots: readonly Slot[],
  build: Build,
  users: ReadonlyMap<string, readonly string[]>,
): Set<string> {
  const ids = new Set<string>();
  for (const slot of slots)
    if (
      isShared(slot) &&
      KINDS[slot.type].rowShown(slot, build, users.get(slot.id) ?? [])
    )
      ids.add(slot.id);
  return ids;
}

/** The note on a shared slot's own row naming the bonuses that read it, or undefined when
 *  none does. */
export function usedByNote(users: readonly string[] | undefined) {
  return users?.length ? `Used by ${users.join(", ")}` : undefined;
}

/** A shared picker's control on one reader's row. */
export interface SharedPickerControl {
  slot: ItemPickerSlot;
  /** The readers on other rows, as the shared note under the control. */
  shared?: string;
}

/** The shared picker controls each row shows, by row slot id: one per shared picker an
 *  equipped bonus anchored on the row reads, however many of them read it. */
export function sharedPickersByRow(
  db: Pick<Db, "slotById">,
  readers: ReadonlyMap<string, readonly EvaluatedBonus[]>,
): Map<string, SharedPickerControl[]> {
  const map = new Map<string, SharedPickerControl[]>();
  for (const [slotId, bonuses] of readers) {
    const slot = db.slotById.get(slotId);
    if (slot?.type !== "item_picker") continue;
    for (const row of unique(bonuses.map((bonus) => bonus.slotId))) {
      const others = unique(
        bonuses
          .filter((bonus) => bonus.slotId !== row)
          .map((bonus) => bonus.bonus.name ?? bonus.bonusId),
      );
      const control: SharedPickerControl = {
        slot,
        ...(others.length && { shared: `Shared with ${others.join(", ")}` }),
      };
      const bucket = map.get(row);
      if (bucket) bucket.push(control);
      else map.set(row, [control]);
    }
  }
  return map;
}
