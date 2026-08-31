// Routes a picked file to the right importer, and holds the plan the picker decides on.
//
// The header's Import button is the app's only file entry point, so it has to take every
// shape the app hands out: the enveloped build, layer and bundle exports, the bare
// `CatalogOverlay` from LayerEditor's export window, and anything issued before envelopes
// existed (which carries no `kind` to go on).
//
// Reading a file does not commit it: it becomes an `ImportPlan` and the picker shows what the
// file holds, whatever the shape, so every import looks the same and the file's own contents
// are never taken on trust.
import { computed, ref } from "vue";
import * as builds from "./builds";
import * as layers from "./layers";
import * as folders from "./folders";
import * as trash from "./trash";
import * as storage from "../storage/storage";
import { showNotice } from "./notice";
import {
  buildPlan,
  resolveImport,
  type ImportDecisions,
  type ImportPlan,
  type ParsedFile,
  type ResolvedImport,
} from "../lib/import-plan";

const isPlain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Shapes this module can route. `unknown` means "no idea" - reported, not guessed at. */
type FileShape = "build" | "layer" | "bundle" | "overlay" | "unknown";

const OVERLAY_GROUPS = ["items", "bonuses", "sectionPresets", "slots"] as const;

/** Un-enveloped files have to be recognised by their fields. Ordered most to least specific:
 *  a bundle and a layer each have a key nothing else has, an overlay is the only shape whose
 *  own keys are the four catalogue groups, and a build is what everything else used to be. */
function sniffLegacy(parsed: unknown): FileShape {
  if (Array.isArray(parsed)) return "build"; // pre-envelope multi-build export
  if (!isPlain(parsed)) return "unknown";
  if (Array.isArray(parsed.builds) && Array.isArray(parsed.layers))
    return "bundle";
  if (isPlain(parsed.overlay)) return "layer";
  if (OVERLAY_GROUPS.some((group) => isPlain(parsed[group]))) return "overlay";
  return "build";
}

function shapeOf(parsed: unknown): FileShape {
  if (isPlain(parsed) && typeof parsed.v === "number") {
    // Enveloped: it says what it is. An `overlay` envelope is the stored-state shape rather
    // than an export, but reading one back as a layer is more useful than refusing it.
    const kind = parsed.kind;
    return kind === "build" ||
      kind === "layer" ||
      kind === "bundle" ||
      kind === "overlay"
      ? kind
      : "unknown";
  }
  return sniffLegacy(parsed);
}

/** Wraps a bare overlay in a layer so the layer parser can take it. No id, so `normaliseLayer`
 *  mints a fresh one - importing the same overlay twice gives two layers, never a conflict. */
function overlayAsLayerText(overlay: unknown, name: string) {
  return JSON.stringify({ name, enabled: true, overlay });
}

/** Reads one file into the shape a plan is built from, or reports why it could not be. */
function parseFile(text: string, fileName: string): ParsedFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    showNotice("That file could not be read: it is not valid JSON.");
    return null;
  }

  const shape = shapeOf(parsed);
  if (shape === "unknown") {
    showNotice(
      "That file could not be read: it is not a build, layer, bundle or overlay export.",
    );
    return null;
  }

  try {
    switch (shape) {
      case "build": {
        const { builds: fileBuilds, catalogStale } = storage.parseJson(text);
        return { fileName, builds: fileBuilds, layers: [], catalogStale };
      }
      case "layer": {
        const { layer, catalogStale } = storage.parseLayerJson(text);
        return { fileName, builds: [], layers: [layer], catalogStale };
      }
      case "bundle": {
        const { bundle, catalogStale } = storage.parseBundleJson(text);
        return {
          fileName,
          builds: bundle.builds,
          layers: bundle.layers,
          folders: bundle.folders,
          catalogStale,
        };
      }
      case "overlay": {
        const name = fileName.replace(/\.json$/i, "") || "Imported layer";
        // An `overlay` envelope carries the overlay under `data`; a bare file is one already.
        const overlay =
          isPlain(parsed) && typeof parsed.v === "number"
            ? parsed.data
            : parsed;
        const { layer, catalogStale } = storage.parseLayerJson(
          overlayAsLayerText(overlay, name),
        );
        return { fileName, builds: [], layers: [layer], catalogStale };
      }
    }
  } catch (error: unknown) {
    showNotice(
      `That file could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

const _pending = ref<ImportPlan | null>(null);

/** The file waiting on the picker, or null when none is. */
export const pending = computed(() => _pending.value);

export function cancelImport() {
  _pending.value = null;
}

/** Imports one exported file's text. `fileName` names the file in the picker, and is what a
 *  bare overlay's layer is called. */
export function importFileText(text: string, fileName = "") {
  const parsed = parseFile(text, fileName);
  if (!parsed) return;

  const plan = buildPlan(parsed, {
    builds: builds.builds.value,
    layers: layers.layers.value,
  });

  if (!plan.builds.length && !plan.layers.length) {
    showNotice("That file could not be read: it has nothing to import.");
    return;
  }

  _pending.value = plan;
}

/** Writes what was settled on. */
export function applyImport(plan: ImportPlan, decisions: ImportDecisions) {
  const buildIds = new Set(builds.builds.value.map((b) => b.id));
  const resolved = resolveImport(plan, decisions, {
    buildIds,
    // The trash counts as spoken for: an id reused while the deleted copy is still restorable
    // would be overwritten the moment it came back.
    usedIds: new Set([
      ...buildIds,
      ...layers.layers.value.map((l) => l.id),
      ...trash.trashed.value.map((entry) => entry.item.id),
    ]),
  });
  _pending.value = null;

  if (!resolved.builds.length && !resolved.layers.length) {
    showNotice("Nothing was ticked, so nothing was imported.");
    return;
  }

  // Imported builds stand on their own, so the landing screen's placeholder makes way first.
  if (resolved.builds.length) builds.discardPlaceholder();

  for (const { build, replacing } of resolved.builds)
    builds.upsertImported(build, replacing);
  for (const { layer, replacing } of resolved.layers)
    layers.upsertImported(layer, replacing);

  // Rebuilt now the builds exist under their final ids.
  for (const folder of resolved.folders) {
    const folderId = folders.createFolder(folder.name, folder.collapsed);
    for (const buildId of folder.builds) folders.placeBuild(buildId, folderId);
  }

  // Land on something that came in, so the import is visible and not merely reported.
  const lastBuild = resolved.builds.at(-1)?.build.id;
  const lastLayer = resolved.layers.at(-1)?.layer.id;
  if (lastBuild) builds.selectImported(lastBuild);
  else if (lastLayer) layers.selectImported(lastLayer);

  showNotice(importNotice(plan, resolved));
}

const countPhrase = (n: number, noun: string) =>
  `${n} ${noun}${n === 1 ? "" : "s"}`;

function importNotice(plan: ImportPlan, resolved: ResolvedImport) {
  const { builds: newBuilds, layers: newLayers } = resolved;
  const single =
    newBuilds.length + newLayers.length === 1
      ? (newBuilds[0]?.build.name ?? newLayers[0]?.layer.name)
      : null;
  const counted = [
    ...(newBuilds.length ? [countPhrase(newBuilds.length, "build")] : []),
    ...(newLayers.length ? [countPhrase(newLayers.length, "layer")] : []),
  ].join(" and ");

  const parts = [single ? `Imported “${single}”` : `Imported ${counted}`];

  const replaced = [...newBuilds, ...newLayers].filter(
    (entry) => entry.replacing,
  ).length;
  if (replaced) parts.push(`${replaced} replaced what was already here`);

  if (plan.catalogStale)
    parts.push(
      "made against an older item catalogue; some items may no longer resolve",
    );

  // One notice per import, not per build.
  const overlays = layers.enabledOverlays.value;
  for (const { build } of newBuilds) {
    const count = builds.overlayOverlapCount(build, overlays);
    if (count > 0) {
      parts.push(
        `${count} custom entr${count === 1 ? "y" : "ies"} came with this build and override your layers for those items.`,
      );
      break;
    }
  }

  return parts.join(". ");
}
