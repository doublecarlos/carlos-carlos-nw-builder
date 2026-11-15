// Which shared slots a build uses. A shared slot shows a row of its own in the Shared inputs
// section only while the build uses it, which each kind of slot decides in `KINDS`. Display
// only: nothing here changes what the engine resolves.
import { isSharedSlot } from "../engine/global-inputs";
import type { InputEntry } from "../engine/inputs";
import type { Build, Slot } from "../types";

type SharedSlot = Extract<Slot, { type: "build_parameter" }>;

interface SharedKind {
  /** Whether the slot's own row shows, given the names of its equipped readers. */
  rowShown(slot: SharedSlot, build: Build, users: readonly string[]): boolean;
}

const KINDS: Record<SharedSlot["type"], SharedKind> = {
  /** A param holds no pick, so it shows while an equipped bonus reads it. */
  build_parameter: { rowShown: (_slot, _build, users) => users.length > 0 },
};

/** The names of the equipped bonuses reading each shared slot, by its id, each name once and
 *  in build order. `readers` is `globalInputReaders`' map. */
export function sharedUsers(
  readers: ReadonlyMap<string, readonly InputEntry[]>,
): Map<string, string[]> {
  return new Map(
    [...readers].map(([slotId, entries]) => [
      slotId,
      [...new Set(entries.map((entry) => entry.source))],
    ]),
  );
}

/** The shared slots in `slots` whose own row shows. */
export function sharedRowIds(
  slots: readonly Slot[],
  build: Build,
  users: ReadonlyMap<string, readonly string[]>,
): Set<string> {
  const ids = new Set<string>();
  for (const slot of slots) {
    if (!isSharedSlot(slot) || slot.type !== "build_parameter") continue;
    if (KINDS[slot.type].rowShown(slot, build, users.get(slot.id) ?? []))
      ids.add(slot.id);
  }
  return ids;
}

/** The note on a shared slot's own row naming the bonuses that read it, or undefined when
 *  none does. */
export function usedByNote(users: readonly string[] | undefined) {
  return users?.length ? `Used by ${users.join(", ")}` : undefined;
}
