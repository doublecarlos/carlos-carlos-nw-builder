// The build folder tree as stored: `buildOrder` lists the top-level rows and each folder lists
// its own `items`, build ids and folder ids interleaved. This module repairs a tree read from
// outside (IndexedDB, a bundle file) into one every reader can trust: each id has exactly one
// home, folders never contain themselves, and nesting stops at `MAX_FOLDER_DEPTH`.
import type { BuildFolder } from "../types";

/** How many folders deep the sidebar nests. A top-level folder sits at depth 1. */
export const MAX_FOLDER_DEPTH = 7;

const isPlain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const stringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string")
    : [];

/** Reads one stored folder record. Data written before nesting existed names its contents
 *  `builds`, which is a valid `items` list as it stands. */
export function readFolder(
  raw: unknown,
  fallbackId: () => string,
): BuildFolder | null {
  if (!isPlain(raw)) return null;
  const id = typeof raw.id === "string" && raw.id ? raw.id : fallbackId();
  return {
    id,
    name: typeof raw.name === "string" && raw.name.trim() ? raw.name : "Folder",
    collapsed: raw.collapsed === true,
    items: stringList(raw.items ?? raw.builds),
  };
}

/**
 * Repairs a folder set and the top-level order around it, against the builds that exist.
 *
 * Membership is settled first: folders claim their items in array order, so the first folder
 * listing an id keeps it and a folder claim beats a top-level listing. Then every cycle is
 * cut, and any folder sitting deeper than `MAX_FOLDER_DEPTH` is lifted to the top level.
 * Whatever is left without a home is appended to the top level: folders first, then builds.
 */
export function repairFolderTree(
  rawFolders: readonly BuildFolder[],
  rawOrder: unknown,
  buildIds: ReadonlySet<string>,
): { buildOrder: string[]; folders: BuildFolder[] } {
  const folders: BuildFolder[] = [];
  const byId = new Map<string, BuildFolder>();
  for (const raw of rawFolders) {
    if (byId.has(raw.id) || buildIds.has(raw.id)) continue;
    const folder = { ...raw, items: [...raw.items] };
    folders.push(folder);
    byId.set(folder.id, folder);
  }

  const parent = new Map<string, string>();
  for (const folder of folders) {
    folder.items = folder.items.filter((id) => {
      if (id === folder.id || parent.has(id)) return false;
      if (!buildIds.has(id) && !byId.has(id)) return false;
      parent.set(id, folder.id);
      return true;
    });
  }

  const detach = (id: string) => {
    const owner = byId.get(parent.get(id)!)!;
    owner.items = owner.items.filter((item) => item !== id);
    parent.delete(id);
  };

  // A folder whose parent chain comes back to it is cut loose from its parent.
  for (const folder of folders) {
    const seen = new Set<string>();
    let at = parent.get(folder.id);
    while (at && at !== folder.id && !seen.has(at)) {
      seen.add(at);
      at = parent.get(at);
    }
    if (at === folder.id) detach(folder.id);
  }

  // Top-down from each root, so a lifted folder is walked again as a root of its own.
  const roots = folders.filter((f) => !parent.has(f.id));
  const walk = (folder: BuildFolder, depth: number) => {
    for (const id of [...folder.items]) {
      const child = byId.get(id);
      if (!child) continue;
      if (depth + 1 > MAX_FOLDER_DEPTH) {
        detach(id);
        roots.push(child);
      } else walk(child, depth + 1);
    }
  };
  for (let i = 0; i < roots.length; i++) walk(roots[i], 1);

  const seen = new Set<string>();
  const buildOrder = stringList(rawOrder).filter((id) => {
    if (seen.has(id) || parent.has(id)) return false;
    if (!byId.has(id) && !buildIds.has(id)) return false;
    seen.add(id);
    return true;
  });
  for (const f of roots) if (!seen.has(f.id)) buildOrder.push(f.id);
  for (const id of buildIds)
    if (!seen.has(id) && !parent.has(id)) buildOrder.push(id);
  return { buildOrder, folders };
}
