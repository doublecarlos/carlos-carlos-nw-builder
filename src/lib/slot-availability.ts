// Conditional slots. A slot carrying `availableWhen` exists only while its condition holds, and
// a nested slot only while its parent is available and holds a pick. One that fails is hidden
// and holds nothing, in storage and in the engine. What the build stores is what the editor
// shows.
//
// The condition reads the build's stored picks, never the resolved results, so a slot's
// visibility cannot depend on what the engine made of it.
import { collect } from "../engine/bonus";
import { evaluate } from "../engine/conditions";
import { withDerivedBonuses } from "../engine/insignia";
import { expandSlots, parseRowSlotId } from "./item-picker-list";
import { SLOT_FIELDS, clearSlotData, storedSlotIds } from "./slot-fields";
import { nestedParentId } from "./slot-parent";
import type { Build, ConditionWhen, Db, EvalContext, Slot } from "../types";

/** A slot's `availableWhen`, or undefined for one that has none or whose type cannot carry one. */
export function availabilityOf(slot: Slot): ConditionWhen | undefined {
  return slot.type === "item_picker" || slot.type === "item_picker_list"
    ? slot.availableWhen
    : undefined;
}

/** The context `availableWhen` is evaluated against, built from the stored picks. */
export function availabilityContext(db: Db, build: Build): EvalContext {
  return collect(db, withDerivedBonuses(db, build)).ctx;
}

export function slotAvailable(slot: Slot, ctx: EvalContext): boolean {
  const when = availabilityOf(slot);
  return !when || evaluate(when, ctx);
}

/** Whether `slot` renders, given the build's hidden slot ids. A list row follows its
 *  container. */
export function slotShown(slot: Slot, hidden: ReadonlySet<string>): boolean {
  if (!hidden.size) return true;
  if (hidden.has(slot.id)) return false;
  return !(slot.type === "item_picker" && slot.list && hidden.has(slot.list));
}

export interface ComparedSlots {
  /** In render order, a list expanded into its rows. */
  slots: Slot[];
  /** Ids of the rows `build` hides but the compare build fills. */
  compareOnly: ReadonlySet<string>;
}

/**
 * `build`'s slots as the editor lists them: the ones it shows, plus, in place of each one it
 * hides, the rows `compare` fills there. A hidden slot holds nothing of its own, so without
 * these a compare build's pick in it would have no row to differ on.
 */
export function slotsWithCompare(
  slots: Slot[],
  build: Build,
  hidden: ReadonlySet<string>,
  compare: Build | null,
): ComparedSlots {
  const out: Slot[] = [];
  const compareOnly = new Set<string>();
  for (const slot of slots) {
    if (!hidden.has(slot.id)) {
      out.push(...expandSlots([slot], build));
      continue;
    }
    if (!compare) continue;
    const rows =
      slot.type === "item_picker_list"
        ? expandSlots([slot], compare).filter((row) => row !== slot)
        : [slot];
    for (const row of rows) {
      if (!compare.choices?.[row.id]) continue;
      out.push(row);
      compareOnly.add(row.id);
    }
  }
  return { slots: out, compareOnly };
}

/** The stored ids a slot's contents live under: its own, or every row of a list. */
function contentIds(build: Build, slot: Slot): string[] {
  if (slot.type !== "item_picker_list") return [slot.id];
  return storedSlotIds(build).filter(
    (slotId) => parseRowSlotId(slotId)?.listId === slot.id,
  );
}

function holdsAnything(build: Build, slot: Slot): boolean {
  if (slot.type === "item_picker_list" && build.listRows?.[slot.id])
    return true;
  return contentIds(build, slot).some((slotId) =>
    SLOT_FIELDS.some((key) =>
      Boolean((build[key] as Record<string, unknown> | undefined)?.[slotId]),
    ),
  );
}

/** Empties `slot` in place. `bonusValues` is kept, as for any cleared slot. */
export function clearSlotContents(build: Build, slot: Slot) {
  for (const slotId of contentIds(build, slot)) clearSlotData(build, slotId);
  if (slot.type === "item_picker_list" && build.listRows)
    delete build.listRows[slot.id];
}

/** A copy whose slot-keyed maps can be cleared without touching `build`. */
const withOwnSlotState = (build: Build): Build => ({
  ...build,
  choices: { ...build.choices },
  values: { ...build.values },
  assignments: { ...build.assignments },
  disabledSlots: { ...build.disabledSlots },
  listRows: { ...build.listRows },
});

export interface PruneResult {
  /** `build` itself when nothing was cleared, else a pruned copy. */
  build: Build;
  /** Ids of the slots that held something and were emptied, in the order they were. */
  cleared: string[];
  /** Ids of every slot whose condition fails for the pruned build. */
  hidden: ReadonlySet<string>;
}

const NOTHING_HIDDEN: ReadonlySet<string> = new Set();

/** The parent a nested slot depends on, or undefined for a top-level one. */
function parentSlot(db: Db, slot: Slot): Slot | undefined {
  const parentId = nestedParentId(slot, db.slotById);
  return parentId ? db.slotById.get(parentId) : undefined;
}

/**
 * Empties every slot whose `availableWhen` fails, or whose parent is hidden or empty. Pure:
 * `build` is never written.
 *
 * Repeats until a pass clears nothing, since emptying one slot can hide another. Each pass
 * only removes values, so a slot is cleared at most once and the loop always ends.
 */
export function pruneUnavailableSlots(db: Db, build: Build): PruneResult {
  const conditional = db.slots.filter(
    (slot) => availabilityOf(slot) || parentSlot(db, slot),
  );
  if (!conditional.length)
    return { build, cleared: [], hidden: NOTHING_HIDDEN };
  const gated = conditional.filter((slot) => availabilityOf(slot));

  let current = build;
  const cleared: string[] = [];
  for (;;) {
    const ctx = gated.length ? availabilityContext(db, current) : undefined;
    const failing = new Set(
      ctx
        ? gated
            .filter((slot) => !slotAvailable(slot, ctx))
            .map((slot) => slot.id)
        : [],
    );
    const hidden = conditional.filter((slot) => {
      if (failing.has(slot.id)) return true;
      const parent = parentSlot(db, slot);
      return (
        !!parent && (failing.has(parent.id) || !current.choices?.[parent.id])
      );
    });
    const emptied = hidden.filter((slot) => holdsAnything(current, slot));
    if (!emptied.length)
      return {
        build: current,
        cleared,
        hidden: new Set(hidden.map((slot) => slot.id)),
      };
    if (current === build) current = withOwnSlotState(build);
    for (const slot of emptied) {
      clearSlotContents(current, slot);
      cleared.push(slot.id);
    }
  }
}
