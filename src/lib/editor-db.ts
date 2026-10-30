import { markRaw } from "vue";
import * as catalog from "../data/catalog";
import type { CatalogOverlay, Db } from "../types";

/**
 * The layer editor's catalog: the engine's enabled overlays with the layer under edit folded
 * last, whatever its `enabled` flag says, so its entries reach the lists, forms and lint even
 * while switched off.
 *
 * When that overlay already folds last in the engine (an enabled top layer), both catalogs
 * are the same fold, so the engine's is returned instead of composing a second one.
 * `engineDb` is a getter so the engine's catalog is only read on that path.
 */
export function editorDb(
  engineOverlays: readonly CatalogOverlay[],
  engineDb: () => Db,
  overlay: CatalogOverlay,
): Db {
  if (engineOverlays.at(-1) === overlay) return engineDb();
  return markRaw(
    catalog.makeDb([...engineOverlays.filter((o) => o !== overlay), overlay]),
  );
}
