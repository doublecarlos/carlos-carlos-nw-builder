// Picking an item into a slot, with every side effect a hand pick has. The editor, presets and
// the picker's preview all go through here, so a preview matches what clicking the row does.
// Vue-free so it is unit-testable.
import { normalizeGroup, stableRef } from "../engine/insignia";
import { setPath } from "./build-path";
import { SLOT_FIELDS, clearSlotData } from "./slot-fields";
import type { Build, Db } from "../types";

/**
 * Writes `itemId` into `slotId` of `build` in place, or clears the slot when it is empty.
 *
 * A pick seeds the item's `defaultParams`, a clear drops everything the slot stores. Either way
 * the slot's stable group is re-paired afterward.
 */
export function applyChoice(
  db: Db,
  build: Build,
  slotId: string,
  itemId: string,
) {
  if (itemId) {
    build.choices[slotId] = itemId;
    const item = db.get(itemId);
    for (const [paramSlotId, value] of Object.entries(
      item?.defaultParams ?? {},
    )) {
      const paramSlot = db.slotById.get(paramSlotId);
      if (paramSlot?.type === "build_parameter")
        setPath(build.context, paramSlot.path, value);
    }
  } else {
    // Only on a clear. Swapping one pick for another keeps the off state, since the checkbox
    // stays on screen; an emptied row shows none, so a state left there could not be undone.
    clearSlotData(build, slotId);
  }
  normalizeStable(db, build, slotId);
}

/**
 * Re-pair a group's insignia with the slots they sit in: upgrade the ones whose slot prefers
 * their shape, drop the ones their slot does not take.
 *
 * Changing a mount re-pairs the whole group, changing one insignia only its own slot. It runs
 * inside the caller's edit, so a mount swap and its evictions undo as one step.
 */
function normalizeStable(db: Db, build: Build, slotId: string) {
  const ref = stableRef(db, slotId);
  if (!ref || ref.role === "bonus") return;
  for (const [target, id] of Object.entries(
    normalizeGroup(db, build, ref.group),
  )) {
    if (ref.role === "insignia" && target !== slotId) continue;
    if (id) build.choices[target] = id;
    else clearSlotData(build, target);
  }
}

/** `build` as `applyChoice` would leave it, without touching `build`: the fields the pick can
 *  write are copied first. */
export function withChoice(
  db: Db,
  build: Build,
  slotId: string,
  itemId: string,
): Build {
  // Only a pick with `defaultParams` writes into `context`, so the deep copy is skipped otherwise.
  const writesContext = !!itemId && !!db.get(itemId)?.defaultParams;
  const copy: Build = {
    ...build,
    context: writesContext ? plain(build.context) : build.context,
  };
  for (const key of SLOT_FIELDS) copySlotField(copy, build, key);
  applyChoice(db, copy, slotId, itemId);
  return copy;
}

const copySlotField = <K extends (typeof SLOT_FIELDS)[number]>(
  target: Build,
  source: Build,
  key: K,
) => {
  target[key] = { ...source[key] };
};

/** A deep copy by JSON round trip, since `structuredClone` rejects a reactive proxy. */
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
