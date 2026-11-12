// "Make global" as one layer edit: a new global input defined as a bonus input was, the
// Global inputs section when the catalog has none, and every converted reader. Written as one
// overlay so builds move their stored values in one pass, with every reader known.
import * as catalog from "../data/catalog";
import { readingGlobal } from "./bonus-draft";
import { GLOBAL_INPUTS_SECTION, globalInputSlot } from "./slot-draft";
import type {
  Bonus,
  BuildParameterSlot,
  CatalogGroup,
  CatalogOverlay,
  Db,
  InputDef,
  Layer,
} from "../types";

/** What the bonus form hands over: input `name`, defined as `def`, for each of `readers`. */
export interface MakeGlobalRequest {
  name: string;
  def: InputDef;
  readers: readonly Bonus[];
}

/**
 * `overlay` with `request` applied, and the global input it added. `db` is the catalog the
 * edit is made against and `takenIds` every slot id in use, the disabled layers' included; the
 * new slot's id and path also stay clear of every parameter path in `db`.
 */
export function makeGlobalOverlay(
  overlay: CatalogOverlay,
  db: Db,
  takenIds: readonly string[],
  { name, def, readers }: MakeGlobalRequest,
): { overlay: CatalogOverlay; slot: BuildParameterSlot } {
  const paths = db.slots.flatMap((slot) =>
    slot.type === "build_parameter" ? [slot.path] : [],
  );
  const slot = globalInputSlot(name, def, [...takenIds, ...paths]);
  let next = overlay;
  if (!db.sections.some((section) => section.id === slot.section))
    next = catalog.upsert(
      next,
      "sections",
      GLOBAL_INPUTS_SECTION.id,
      GLOBAL_INPUTS_SECTION,
    );
  next = catalog.upsert(next, "slots", slot.id, slot);
  for (const bonus of readers)
    next = catalog.upsert(
      next,
      "bonuses",
      bonus.id,
      readingGlobal(bonus, name, slot.id),
    );
  return { overlay: next, slot };
}

/** Entries of `group` an enabled layer above `layerId` overrides, by that layer's name, the
 *  highest one when several do. A deletion marker overrides nothing here. `layers` is in display order, highest priority first. */
export function shadowedEntries(
  layers: readonly Layer[],
  layerId: string,
  group: CatalogGroup,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const layer of layers) {
    if (layer.id === layerId) break;
    if (!layer.enabled) continue;
    for (const [id, entry] of Object.entries(layer.overlay[group] ?? {}))
      if (entry !== null && !out.has(id)) out.set(id, layer.name);
  }
  return out;
}
