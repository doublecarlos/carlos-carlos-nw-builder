// Which build editor rows an undo or redo changed, so the editor can show them. Read straight
// off the two builds: a row's pick, its own settings, inline repetitions, list row count,
// on/off switch, a build parameter's value, and the settings of the bonuses its pick carries.
import { deepEqual } from "./deep-equal";
import { getPath } from "./build-path";
import { expandSlots } from "./item-picker-list";
import type { Build, Db, Slot } from "../types";

/** What one row shows of a build, for telling two builds apart row by row. */
function rowState(db: Db, build: Build, slot: Slot) {
  const choice = build.choices[slot.id];
  const bonusIds = db.get(choice)?.bonuses ?? [];
  return {
    choice,
    values: build.values[slot.id],
    assignments: build.assignments[slot.id],
    listRows: build.listRows[slot.id],
    disabled: build.disabledSlots[slot.id],
    param:
      slot.type === "build_parameter"
        ? getPath(build.context, slot.path)
        : undefined,
    bonusValues: bonusIds.map((id) => build.bonusValues[id]),
  };
}

/** The ids of the rows that differ between `before` and `after`, in editor order. A row that
 *  exists in only one of them counts as changed when it does in `after`. */
export function changedSlots(db: Db, before: Build, after: Build): string[] {
  const previous = new Map(
    expandSlots(db.slots, before).map((slot) => [slot.id, slot]),
  );
  return expandSlots(db.slots, after)
    .filter((slot) => {
      const old = previous.get(slot.id);
      return (
        !old || !deepEqual(rowState(db, before, old), rowState(db, after, slot))
      );
    })
    .map((slot) => slot.id);
}
