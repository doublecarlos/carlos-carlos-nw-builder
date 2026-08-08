// Per-item proc checkboxes (#82): which of an item's grants are gated by their own proc
// toggle, and whether each is currently on. Read directly off the resolved-build store rather
// than threaded through props, the same way PointAssignmentInput.vue already reads `db` --
// both ItemPickerRow.vue and PointAssignmentInput.vue need this and neither otherwise carries
// `ResolvedBuild`/`Build` down from BuildEditor.vue.
import { computed, type ComputedRef, type Ref } from "vue";
import { procSpec } from "../engine/conditions";
import * as builds from "../stores/builds";
import * as engine from "../stores/resolved";
import type { Item } from "../types";

export interface ProcRow {
  grantKey: string;
  label: string;
  checked: boolean;
}

/**
 * One row per proc-gated grant credited to `item` -- only the row that's the shared bonus's
 * first contributor gets a checkbox (`EvaluatedBonus.sources` is sorted deterministically by
 * bonus.ts, the same ordering ItemCard.vue's own `isFirst` and BuildEditor's `bonusesBySlot`
 * rely on), so a proc-gated set bonus doesn't grow one checkbox per equipped piece. An item
 * whose single bonus set carries more than one proc-gated grant (several independent procs on
 * one item) gets one row per grant, numbered, rather than folding them into a single checkbox --
 * each is a standalone chance-to-trigger, not one combined toggle.
 *
 * Shown even when the bonus is currently inactive for some unrelated reason (a build-wide
 * toggle off, a duration too short, an exclusion) so flipping the proc back on is never blocked
 * on satisfying every other condition first.
 */
export function procRowsForItem(item: Item | null | undefined): ProcRow[] {
  if (!item || !engine.resolved.value.ok) return [];

  const bonusById = new Map(
    engine.resolved.value.result.bonuses.map((bonus) => [bonus.id, bonus]),
  );
  const procs = builds.build.value.procs;
  const seen = new Set<string>();
  const rows: ProcRow[] = [];

  for (const candidate of engine.db.value.bonusesFor(item)) {
    const resolved = bonusById.get(candidate.bonus.id);
    if (!resolved || resolved.sources[0] !== item.name) continue;

    const procGrants = resolved.grants.filter((grant) => grant.procKey);
    procGrants.forEach((grant, index) => {
      const key = grant.procKey!;
      if (seen.has(key)) return;
      seen.add(key);

      const spec = procSpec(grant.raw.when);
      const override = typeof spec === "object" ? spec : undefined;
      const bonusName = resolved.bonus.name ?? resolved.id;
      // An authored `label` always wins outright (it's already meant to stand on its own); the
      // fallback numbers itself only when more than one grant in this set would otherwise share
      // the same bonus-name-derived label.
      const label =
        override?.label ??
        (procGrants.length > 1
          ? `${bonusName} (proc ${index + 1})`
          : `${bonusName} proc`);

      rows.push({
        grantKey: key,
        label,
        checked: procs[key] ?? override?.default ?? true,
      });
    });
  }

  return rows;
}

/** `procRowsForItem`, wrapped as a computed tracking a single reactive item -- for a component
 *  showing exactly one item's row (ItemPickerRow.vue). A component iterating several items in
 *  one row (PointAssignmentInput.vue) calls `procRowsForItem` directly per item instead. */
export function useItemProcs(
  item: Ref<Item | null | undefined> | ComputedRef<Item | null | undefined>,
) {
  return computed<ProcRow[]>(() => procRowsForItem(item.value));
}
