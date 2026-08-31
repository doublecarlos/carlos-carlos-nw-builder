// What an import file offers, and what the user chose to take from it. The parsers hand back
// a file's builds and layers under the ids it was written with; deciding which of those ids
// survive -- replacing what is here, or making way for fresh ones -- happens here.
import { newId } from "../storage/storage";
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
  folderName?: string;
}

export interface ImportLayerEntry extends ImportEntry {
  layer: Layer;
}

export interface ImportPlan {
  fileName: string;
  builds: ImportBuildEntry[];
  layers: ImportLayerEntry[];
  /** Membership by source build id. */
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
  /** Membership in final ids. Holds new builds only -- a replacing one keeps its place. */
  folders: { name: string; collapsed: boolean; builds: string[] }[];
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
  const folders = parsed.folders ?? [];
  const folderOf = new Map<string, string>();
  for (const folder of folders) {
    for (const id of folder.builds) folderOf.set(id, folder.name);
  }

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
      ...(folderOf.has(build.id) ? { folderName: folderOf.get(build.id) } : {}),
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

  // A comparison survives only where its target does: remapped when that build travelled too,
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
  const folders = plan.folders
    .map((folder) => ({
      name: folder.name,
      collapsed: folder.collapsed,
      builds: folder.builds
        .map((sourceId) => idMap.get(sourceId))
        .filter((id): id is string => !!id && newBuildIds.has(id)),
    }))
    .filter((folder) => folder.builds.length > 0);

  return { builds: resolvedBuilds, layers, folders };
}
