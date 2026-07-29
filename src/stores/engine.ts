// The resolved-build pipeline: fold the catalogue overlays into a `db`, run the engine over
// the active (and, if picked, compare) build.
import { computed, markRaw } from 'vue';
import * as catalog from '../catalog';
import * as engine from '../engine';
import * as library from './library';
import * as compare from './compare';
import { workspaceOverlay } from './workspace';
import type { ResolvedBuild } from '../types';

type Resolution = { ok: true; result: ResolvedBuild } | { ok: false; message: string; stack: string };

/**
 * Catalogue layers, lowest priority first. The shipped data is the base (inside
 * `catalog.makeDb`); everything here is folded over it.
 *
 * Custom gear saved with a build slots in as one more entry -- `build.catalog` -- and
 * nothing else in the app has to change. `storage.normalise` already preserves that key on a
 * build so it survives a save/reload round trip.
 */
const overlays = computed(() => [workspaceOverlay.value, library.build.value.catalog].filter(Boolean));

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
    return { ok: true, result: engine.resolveBuild(db.value, library.build.value) };
  } catch (error: any) {
    return { ok: false, message: String(error), stack: error?.stack ?? '' };
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
    return { ok: true, result: engine.resolveBuild(db.value, compare.compareBuild.value) };
  } catch (error: any) {
    return { ok: false, message: String(error), stack: error?.stack ?? '' };
  }
});

/** Summarised here so the tab can show it without mounting the inspector. */
export const bonusCounts = computed(() => {
  if (!resolved.value.ok) return { total: 0, active: 0, nearMiss: 0 };
  const all = resolved.value.result.bonuses;
  return {
    total: all.length,
    active: all.filter((bonus) => bonus.active).length,
    nearMiss: all.filter((bonus) => !bonus.active && !bonus.excluded
      && (bonus.gate?.unmet?.length ?? 0) === 1).length,
  };
});
