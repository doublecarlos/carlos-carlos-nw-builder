// Routes a picked file to the right importer. The header's Import button is the app's only
// file entry point, so it has to take every shape the app hands out: the enveloped build,
// layer and bundle exports, the bare `CatalogOverlay` from LayerEditor's export window, and
// anything issued before envelopes existed (which carries no `kind` to go on).
import * as builds from "./builds";
import * as layers from "./layers";
import { showNotice } from "./notice";

const isPlain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

/** Shapes this module can route. `unknown` means "no idea" — reported, not guessed at. */
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

/** Wraps a bare overlay in a layer so the existing layer importer can take it. No id, so
 *  `normaliseLayer` mints a fresh one — importing the same overlay twice gives two layers. */
function overlayAsLayerText(overlay: unknown, name: string) {
  return JSON.stringify({ name, enabled: true, overlay });
}

/** Imports one exported file's text. `fileName` only names the layer a bare overlay becomes. */
export function importFileText(text: string, fileName = "") {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    showNotice("That file could not be read: it is not valid JSON.");
    return;
  }

  switch (shapeOf(parsed)) {
    case "build":
      builds.importBuildText(text);
      break;
    case "layer":
      layers.importLayerText(text);
      break;
    case "bundle":
      layers.importBundleText(text);
      break;
    case "overlay": {
      const name = fileName.replace(/\.json$/i, "") || "Imported layer";
      // An `overlay` envelope carries the overlay under `data`; a bare file is one already.
      const overlay =
        isPlain(parsed) && typeof parsed.v === "number" ? parsed.data : parsed;
      layers.importLayerText(overlayAsLayerText(overlay, name));
      break;
    }
    default:
      showNotice(
        "That file could not be read: it is not a build, layer, bundle or overlay export.",
      );
  }
}
