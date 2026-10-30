// The resolved-build pipeline: fold the catalog overlays into a `db`, run the engine over
// the active (and, if picked, compare) build.
import { computed, markRaw } from "vue";
import * as catalog from "../data/catalog";
import * as engine from "../engine/engine";
import { inputEntries, type InputEntry } from "../engine/inputs";
import { inspectorBonuses, isNearMiss } from "../lib/bonus-inspector";
import {
  emptyIndex,
  groupBySlot,
  indexResolved,
  inputCopiesBySlot,
  type InputCopy,
  type ResolvedIndex,
} from "../lib/resolved-index";
import * as builds from "./builds";
import * as layers from "./layers";
import * as compare from "./compare";
import type { CatalogOverlay, EvaluatedBonus, ResolvedBuild } from "../types";

type Resolution =
  | { ok: true; result: ResolvedBuild }
  | { ok: false; message: string; stack: string };

/**
 * Every enabled layer's overlay, lowest priority first. The shipped data is the base (inside
 * `catalog.makeDb`) and these fold over it, so an overlay earlier in the list can be
 * overridden by a later one. The store hands them over already reversed, which is what makes
 * the topmost layer fold last and win.
 *
 * Read-only: the array is the layers store's own, and a caller writing to it would change
 * what the engine folds without the store ever hearing about it.
 */
export const overlays = computed<readonly CatalogOverlay[]>(
  () => layers.enabledOverlays.value,
);

/**
 * Rebuilt only when the overlay list changes. Indexing is well under a millisecond, so there
 * is no reason to be cleverer than this.
 *
 * `markRaw` keeps Vue out of the result: a composed catalog is a deep tree of items, bonuses,
 * slots and their nested bonus/condition objects that nothing ever writes to, so proxying
 * every node of it would cost more than the resolve that reads it.
 */
export const db = computed(() => markRaw(catalog.makeDb(overlays.value)));

/**
 * The engine is verified, so a throw here is a bug worth seeing rather than hiding -- but it
 * must not blank the page, or there would be nothing left to debug with.
 */
export const resolved = computed<Resolution>(() => {
  try {
    const b = builds.build.value;
    if (!b) return { ok: false, message: "No build selected", stack: "" };
    return {
      ok: true,
      result: engine.resolveBuild(db.value, b),
    };
  } catch (error: unknown) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error && error.stack ? error.stack : "",
    };
  }
});

/**
 * Resolved against the *active* build's own `db`, not one composed for the compare build's
 * own `catalog` -- this is a quick "how does this other build stack up" glance, not the
 * editor's per-build custom-gear machinery. A compare build whose custom items live only in
 * its own catalog would show those slots as unresolved; acceptable for what this is.
 */
export const compareResolved = computed<Resolution | null>(() => {
  if (!compare.compareBuild.value) return null;
  try {
    return {
      ok: true,
      result: engine.resolveBuild(db.value, compare.compareBuild.value),
    };
  } catch (error: unknown) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error && error.stack ? error.stack : "",
    };
  }
});

const NOTHING_HIDDEN: ReadonlySet<string> = new Set();

/** The active build's unavailable slots, which no list of slots shows. None while the build
 *  fails to resolve: a broken build should not also hide its rows. */
export const hiddenSlots = computed<ReadonlySet<string>>(() =>
  resolved.value.ok ? resolved.value.result.hiddenSlots : NOTHING_HIDDEN,
);

/** The active build's per-slot lookups (lib/resolved-index.ts). Empty while the build fails
 *  to resolve. */
export const resolvedIndex = computed<ResolvedIndex>(() =>
  resolved.value.ok ? indexResolved(resolved.value.result) : emptyIndex(),
);

/** Every resolved bonus by id, hidden ones included: an "overridden by" line can name an
 * excluder the inspector's own list leaves out. Empty while the build fails to resolve. */
export const bonusById = computed<Map<string, EvaluatedBonus>>(
  () => resolvedIndex.value.bonusById,
);

/** Summarized here so the tab can show it without mounting the inspector. Reads the same
 * `inspectorBonuses` list BonusInspector.vue renders, so the tab badge and the panel it opens
 * never disagree on the total. */
export const bonusCounts = computed(() => {
  if (!resolved.value.ok) return { total: 0, active: 0, nearMiss: 0 };
  const all = inspectorBonuses(resolved.value.result.bonuses);
  return {
    total: all.length,
    active: all.filter((bonus) => bonus.active).length,
    nearMiss: all.filter(isNearMiss).length,
  };
});

/** Every typed value the active build declares, active or not (engine/inputs.ts). Empty while
 * the build fails to resolve. */
export const inputs = computed<InputEntry[]>(() => {
  const b = builds.build.value;
  return b && resolved.value.ok
    ? inputEntries(db.value, b, resolved.value.result)
    : [];
});

/** `inputs` by the slot each value belongs to. */
export const inputsBySlot = computed<Map<string, InputEntry[]>>(() =>
  groupBySlot(inputs.value),
);

/** The bonus inputs each slot notes because their bonus also comes from it. */
export const inputCopies = computed<Map<string, InputCopy[]>>(() =>
  inputCopiesBySlot(inputs.value, bonusById.value),
);
