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

/** What the bonus form hands over: input `name`, defined as `def`, for each of `readers`, as
 *  the global input `id`. */
export interface MakeGlobalRequest {
  id: string;
  name: string;
  def: InputDef;
  readers: readonly Bonus[];
}

/** What a new global input's id must stay clear of. Its id doubles as its path, and a path
 *  nests in the build's context, so it must not sit above or below another path either. */
export interface TakenGlobalIds {
  ids: readonly string[];
  paths: readonly string[];
}

/** `takenIds` is every slot id in use, the disabled layers' included. */
export const takenGlobalIds = (
  db: Db,
  takenIds: readonly string[],
): TakenGlobalIds => ({
  ids: takenIds,
  paths: db.slots.flatMap((slot) =>
    slot.type === "build_parameter" ? [slot.path] : [],
  ),
});

const GLOBAL_ID = /^globals(\.[A-Za-z0-9_-]+)+$/;

/** Why `id` cannot name a new global input, or null when it can. */
export function globalIdError(
  id: string,
  { ids, paths }: TakenGlobalIds,
): string | null {
  if (!id) return "Enter an id.";
  if (!GLOBAL_ID.test(id))
    return "Start with “globals.”, then dot-separated parts of letters, digits, - or _.";
  if (ids.includes(id) || paths.includes(id))
    return `“${id}” is already the id or path of another slot.`;
  const nested = paths.find(
    (path) => path.startsWith(`${id}.`) || id.startsWith(`${path}.`),
  );
  if (nested !== undefined)
    return `“${id}” would nest with the path “${nested}”.`;
  return null;
}

/** The id "Make global" offers first: `globals.` and the input's label, else its name, with
 *  a number added until it is free. Under a taken path no number helps, so the stem is
 *  offered as is and the dialog reports it. */
export function defaultGlobalId(
  name: string,
  def: InputDef,
  taken: TakenGlobalIds,
): string {
  const stem = catalog.nextSlotId(
    GLOBAL_INPUTS_SECTION.id,
    def.label || name,
    [],
  );
  if (taken.paths.some((path) => stem.startsWith(`${path}.`))) return stem;
  let id = stem;
  for (let n = 2; globalIdError(id, taken) !== null; n += 1)
    id = `${stem}-${n}`;
  return id;
}

/**
 * `overlay` with `request` applied, and the global input it added. `db` is the catalog the
 * edit is made against. Throws when `request.id` is not free in `taken`, which the dialog
 * checks before it offers the edit.
 */
export function makeGlobalOverlay(
  overlay: CatalogOverlay,
  db: Db,
  taken: TakenGlobalIds,
  { id, name, def, readers }: MakeGlobalRequest,
): { overlay: CatalogOverlay; slot: BuildParameterSlot } {
  const error = globalIdError(id, taken);
  if (error !== null) throw new Error(error);
  const slot = globalInputSlot(id, name, def);
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
