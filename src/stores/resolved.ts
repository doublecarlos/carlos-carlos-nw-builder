// The resolved-build pipeline: fold the catalogue overlays into a `db`, run the engine over
// the active (and, if picked, compare) build.
import { computed, markRaw } from "vue";
import * as catalog from "../data/catalog";
import * as engine from "../engine/engine";
import { isHiddenBonus } from "../engine/bonus";
import * as builds from "./builds";
import * as layers from "./layers";
import * as compare from "./compare";
import type { ResolvedBuild } from "../types";

type Resolution =
  | { ok: true; result: ResolvedBuild }
  | { ok: false; message: string; stack: string };

/**
 * Catalogue layers, lowest priority first. The shipped data is the base (inside
 * `catalog.makeDb`); everything here is folded over it.
 *
 * Enabled layers come first (already reversed by the store, so the topmost layer folds
 * last), then the active build's per-build catalog. Order matters: an overlay earlier in
 * this list can be overridden by a later one, and the build catalog beats every layer.
 */
export const overlays = computed(() => {
  const result = [...layers.enabledOverlays.value];
  if (builds.build.value?.catalog) result.push(builds.build.value.catalog);
  return result;
});

/**
 * markRaw: 369 items plus several Maps. Vue deep-proxying it would cost more than the whole
 * calculation. Rebuilt only when a layer actually changes -- indexing is well under a
 * millisecond, so there is no reason to be cleverer than this.
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

/** Summarised here so the tab can show it without mounting the inspector. Matches
 * BonusInspector.vue's own `visibleBonuses` filter, so the tab badge and the panel it opens
 * never disagree on the total. */
export const bonusCounts = computed(() => {
  if (!resolved.value.ok) return { total: 0, active: 0, nearMiss: 0 };
  const all = resolved.value.result.bonuses.filter(
    (bonus) => !isHiddenBonus(bonus.bonus),
  );
  return {
    total: all.length,
    active: all.filter((bonus) => bonus.active).length,
    nearMiss: all.filter(
      (bonus) =>
        !bonus.active &&
        !bonus.excluded &&
        (bonus.gate?.unmet?.length ?? 0) === 1,
    ).length,
  };
});
