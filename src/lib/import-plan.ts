// What an import file offers, and what the user chose to take from it. The parsers hand back
// a file's builds and layers under the ids it was written with; deciding which of those ids
// survive -- replacing what is here, or making way for fresh ones -- happens here.
import { newId } from "../storage/storage";
import { repairFolderTree } from "./folder-tree";
import type { TreeStep } from "./tree-rows";
import type { Build, BuildFolder, Layer } from "../types";

/** What to do with an entry whose id the workspace already uses. */
export type Resolution = "new" | "replace";

export interface ImportEntry {
  /** The id in the file: what conflicts match on, and what folder membership and `compare.id`
   *  inside the same file point at. */
  sourceId: string;
  name: string;
  /** Name of the build/layer already here under that id. */
  conflictName?: string;
}

export interface ImportBuildEntry extends ImportEntry {
  build: Build;
  /** The folders the build was grouped under in the file, outermost first. */
  path?: TreeStep[];
}

export interface ImportLayerEntry extends ImportEntry {
  layer: Layer;
}

export interface ImportPlan {
  fileName: string;
  builds: ImportBuildEntry[];
  layers: ImportLayerEntry[];
  /** The file's folder tree by source ids, repaired the way stored folders are on load. */
  folders: BuildFolder[];
  catalogStale: boolean;
}

/** One row's state in the picker. Parallel to `plan.builds`/`plan.layers` by index: two
 *  entries in one file may share a source id, so neither is a usable key. */
export interface EntryDecision {
  selected: boolean;
  resolution: Resolution;
}

export interface ImportDecisions {
  builds: EntryDecision[];
  layers: EntryDecision[];
}

export interface ResolvedImport {
  builds: { build: Build; replacing: boolean }[];
  layers: { layer: Layer; replacing: boolean }[];
  /** Folders under fresh ids, holding final build ids and each other. Holds new builds only,
   *  since a replacing one keeps its place, and a folder left with none is dropped. */
  folders: BuildFolder[];
}

export interface ParsedFile {
  fileName: string;
  builds: Build[];
  layers: Layer[];
  folders?: BuildFolder[];
  catalogStale: boolean;
}

/** Describes what `parsed` would bring in, against the workspace as it stands. */
export function buildPlan(
  parsed: ParsedFile,
  existing: { builds: Build[]; layers: Layer[] },
): ImportPlan {
  const buildNames = new Map(existing.builds.map((b) => [b.id, b.name]));
  const layerNames = new Map(existing.layers.map((l) => [l.id, l.name]));
  const { folders } = repairFolderTree(
    parsed.folders ?? [],
    [],
    new Set(parsed.builds.map((b) => b.id)),
  );
  const pathOf = folderPaths(folders);

  return {
    fileName: parsed.fileName,
    catalogStale: parsed.catalogStale,
    folders,
    builds: parsed.builds.map((build) => ({
      sourceId: build.id,
      name: build.name,
      build,
      ...(buildNames.has(build.id)
        ? { conflictName: buildNames.get(build.id) }
        : {}),
      ...(pathOf.has(build.id) ? { path: pathOf.get(build.id) } : {}),
    })),
    layers: parsed.layers.map((layer) => ({
      sourceId: layer.id,
      name: layer.name,
      layer,
      ...(layerNames.has(layer.id)
        ? { conflictName: layerNames.get(layer.id) }
        : {}),
    })),
  };
}

/** Each foldered id's folder path, for a tree `repairFolderTree` already settled. */
function folderPaths(folders: BuildFolder[]): Map<string, TreeStep[]> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const nested = new Set(folders.flatMap((f) => f.items));
  const paths = new Map<string, TreeStep[]>();
  const walk = (folder: BuildFolder, outer: TreeStep[]) => {
    const path = [...outer, { key: folder.id, label: folder.name }];
    for (const id of folder.items) {
      const child = byId.get(id);
      if (child) walk(child, path);
      else paths.set(id, path);
    }
  };
  for (const folder of folders) if (!nested.has(folder.id)) walk(folder, []);
  return paths;
}

/** Everything the file offers, ticked, and never destructive: replacing is always a choice
 *  the user makes. What the picker opens on. */
export function acceptAll(plan: ImportPlan): ImportDecisions {
  const all = (entries: ImportEntry[]): EntryDecision[] =>
    entries.map(() => ({ selected: true, resolution: "new" as const }));
  return { builds: all(plan.builds), layers: all(plan.layers) };
}

export const conflictCount = (plan: ImportPlan) =>
  [...plan.builds, ...plan.layers].filter((e) => e.conflictName).length;

/** Suffixes `(2)`, `(3)`… until the name is unused. */
function uniqueName(name: string, taken: Set<string>): string {
  let candidate = name;
  let n = 2;
  while (taken.has(candidate)) candidate = `${name} (${n++})`;
  taken.add(candidate);
  return candidate;
}

export interface WorkspaceIds {
  /** The builds in the sidebar - what a comparison can still point at. */
  buildIds: Set<string>;
  /** Every id spoken for, the trash included. An entry keeps the id it arrived with when it
   *  is free, so importing a file twice reads as the same thing twice and can be replaced;
   *  minting one regardless would leave every re-import looking new. */
  usedIds: Set<string>;
}

/** The records to write, from a plan and the picker's ticks. */
export function resolveImport(
  plan: ImportPlan,
  decisions: ImportDecisions,
  workspace: WorkspaceIds,
): ResolvedImport {
  // Source id -> the id it ends up under, for whatever names it. Only the first entry claiming
  // a source id is reachable through this, so a file carrying one twice cannot overwrite its
  // own first copy.
  const idMap = new Map<string, string>();
  const claimed = new Set<string>();

  const chooseId = (
    sourceId: string,
    decision: EntryDecision,
    conflicts: boolean,
    prefix: string,
  ) => {
    const free = !workspace.usedIds.has(sourceId) && !claimed.has(sourceId);
    const replacing =
      decision.resolution === "replace" && conflicts && !claimed.has(sourceId);
    const finalId = replacing || free ? sourceId : newId(prefix);
    claimed.add(finalId);
    if (!idMap.has(sourceId)) idMap.set(sourceId, finalId);
    return { finalId, replacing };
  };

  // Only new entries are renamed: one taking an existing build's place is that build.
  const buildNames = new Set<string>();
  const builds = plan.builds.flatMap((entry, i) => {
    const decision = decisions.builds[i];
    if (!decision?.selected) return [];
    const { finalId, replacing } = chooseId(
      entry.sourceId,
      decision,
      !!entry.conflictName,
      "b",
    );
    return [
      {
        build: {
          ...entry.build,
          id: finalId,
          name: replacing
            ? entry.build.name
            : uniqueName(entry.build.name, buildNames),
        },
        replacing,
      },
    ];
  });

  const layerNames = new Set<string>();
  const layers = plan.layers.flatMap((entry, i) => {
    const decision = decisions.layers[i];
    if (!decision?.selected) return [];
    const { finalId, replacing } = chooseId(
      entry.sourceId,
      decision,
      !!entry.conflictName,
      "l",
    );
    return [
      {
        layer: {
          ...entry.layer,
          id: finalId,
          name: replacing
            ? entry.layer.name
            : uniqueName(entry.layer.name, layerNames),
        },
        replacing,
      },
    ];
  });

  // A comparison survives only where its target does: remapped when that build traveled too,
  // kept when it names one already here, dropped otherwise rather than dangling.
  const importedIds = new Set(builds.map((b) => b.build.id));
  const resolvedBuilds = builds.map(({ build, replacing }) => {
    const target = idMap.get(build.compare.id);
    const keep =
      target && importedIds.has(target)
        ? target
        : workspace.buildIds.has(build.compare.id)
          ? build.compare.id
          : null;
    return {
      build: keep
        ? { ...build, compare: { ...build.compare, id: keep } }
        : {
            ...build,
            compare: {
              id: "",
              highlight: false,
              onlyDiff: false,
              statLines: false,
            },
          },
      replacing,
    };
  });

  const newBuildIds = new Set(
    builds.filter((b) => !b.replacing).map((b) => b.build.id),
  );
  // A folder travels when anything new lands inside it, under a fresh id: a folder is only
  // ever the grouping, so there is nothing here for it to replace.
  const byId = new Map(plan.folders.map((f) => [f.id, f]));
  const kept = new Map<string, BuildFolder>();
  const keep = (folder: BuildFolder): BuildFolder | null => {
    const items = folder.items.flatMap((id) => {
      const child = byId.get(id);
      if (child) {
        const copy = keep(child);
        return copy ? [copy.id] : [];
      }
      const finalId = idMap.get(id);
      return finalId && newBuildIds.has(finalId) ? [finalId] : [];
    });
    if (!items.length) return null;
    const copy = { ...folder, id: newId("f"), items };
    kept.set(folder.id, copy);
    return copy;
  };
  const nested = new Set(plan.folders.flatMap((f) => f.items));
  for (const folder of plan.folders) if (!nested.has(folder.id)) keep(folder);
  const folders = plan.folders.flatMap((f) => {
    const copy = kept.get(f.id);
    return copy ? [copy] : [];
  });

  return { builds: resolvedBuilds, layers, folders };
}
