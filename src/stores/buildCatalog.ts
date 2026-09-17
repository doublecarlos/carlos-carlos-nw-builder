// `Build.catalog` is a transport field: a downloaded build carries the catalog entries it
// depends on so it resolves the same way on the other machine. On the way in it is unpacked
// into a layer, which is where catalog content is visible, editable and transferable, and the
// stored build goes back to holding nothing but its own picks.
import * as catalog from "../data/catalog";
import * as layers from "./layers";
import type { Build } from "../types";

/** Where one build's embedded catalog ended up. */
export interface UnpackedCatalog {
  layerName: string;
  /** True when an existing layer already held exactly this content. */
  reused: boolean;
  /** A reused layer is left as the user arranged it, switched off included. */
  enabled: boolean;
}

/**
 * Lifts a build's embedded catalog into a layer and clears the field. Null when the build
 * carries nothing, which is every build the user authored here.
 *
 * Mutates the build: callers hold one that is on its way into the pool, either straight off an
 * import or freshly hydrated, and the field must not survive into storage.
 */
export function unpackCatalog(build: Build): UnpackedCatalog | null {
  const overlay = build.catalog;
  delete build.catalog;
  if (!overlay || catalog.isEmpty(overlay)) return null;
  const { layer, reused } = layers.adoptOverlay(
    `${build.name} (imported)`,
    overlay,
  );
  return { layerName: layer.name, reused, enabled: layer.enabled };
}

/** One sentence saying where a batch of embedded catalogs landed, or null when none did.
 *  Several builds from one sender share a layer, so this usually names a single one. A reused
 *  layer the user has switched off leaves the build's custom items unresolved, which is worth
 *  a word: the sender saw them. */
export function unpackNotice(results: UnpackedCatalog[]): string | null {
  if (!results.length) return null;
  const names = [...new Set(results.map((result) => result.layerName))];
  const single = names.length === 1;
  const where = single ? `the layer “${names[0]}”` : `${names.length} layers`;
  if (!results.every((result) => result.reused))
    return `Custom catalog entries came along and are now in ${where}, on top of your other layers`;
  const off = results.every((result) => !result.enabled)
    ? ` but ${single ? "is" : "are"} switched off`
    : "";
  return `Custom catalog entries came along, and ${where} already held them${off}`;
}
