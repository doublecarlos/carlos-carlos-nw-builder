// Build persistence, import/export and share links.
//
// Owns the shape of a stored build so `App.vue` never has to reason about it: anything that
// comes back from localStorage, a pasted JSON blob or a URL hash goes through `normalise`
// first, and anything `normalise` returns is safe to hand straight to the engine.
//
// The saved library lives under `nw:builds`, written only when the user explicitly saves (or
// by a structural change that has nothing pending to lose -- see App.vue's `saveActive`). The
// live, possibly-unsaved draft lives separately under `nw:builds-draft`, autosaved continuously
// so a reload never loses work in progress. The old single-build key `nw:current-build` is
// migrated into the saved library on first load and then removed.
//
// Phase 2a adds layer storage and the IndexedDB wrapper alongside the existing localStorage
// functions. The collection/library functions stay until 2b deletes them.

import { NW_SLOTS, NW_CATALOG_VERSION } from "../data/data";
import * as catalog from "../data/catalog";
import { fromData as baseDb } from "../data/db";
import * as idb from "./idb";
import { setPath } from "../lib/build-path";
import { deepEqual } from "../lib/deep-equal";
import pkg from "../../package.json";
import { showNotice } from "../stores/notice";
import type {
  Build,
  Layer,
  CatalogOverlay,
  AppMeta,
  Selection,
  TrashEntry,
  ItemHistory,
  Db,
} from "../types";

const OVERLAY_KEY = "nw:catalog-overlay";
const UI_KEY = "nw:ui";

// --- versioned envelope ------------------------------------------------------------------
// Wraps every build/collection payload this module reads or writes (localStorage, JSON
// export/import, share links) with what it needs to be read back safely: the shape version of
// `data` (`v`), which of the payload shapes this module owns it is (`kind`), and what item
// catalogue it was authored against (`catalog`). Without this, a shape-breaking change (like
// swapping item names for ids) fails silently -- a build loads looking fine with every slot
// quietly empty. With it, that becomes a real refusal with a message.
//
// Un-enveloped data (everything saved/exported before this existed) is deliberately NOT
// refused: `unwrap` only throws on a *mismatched* `v`/`kind`, so today's un-enveloped
// localStorage and already-issued exports/links keep working exactly as before. The refuse
// behaviour only starts biting the next time `SCHEMA_VERSION` actually moves -- which is the
// point: this doesn't retroactively invalidate anything, it just makes the *next* breaking
// change honest instead of silent.

export const SCHEMA_VERSION = 1;

export type EnvelopeKind = "build" | "overlay" | "layer" | "bundle";

export interface Envelope<T> {
  v: number;
  kind: EnvelopeKind;
  catalog: number;
  app?: string;
  exported?: number;
  data: T;
}

function wrap<T>(kind: EnvelopeKind, data: T): Envelope<T> {
  return {
    v: SCHEMA_VERSION,
    kind,
    catalog: NW_CATALOG_VERSION,
    app: pkg.version,
    exported: Date.now(),
    data,
  };
}

/**
 * Unwraps an envelope, or passes un-enveloped (legacy) data through untouched as `data` --
 * see the module comment above for why that's not a refusal. A *mismatched* `v` or `kind` on
 * genuinely enveloped data throws a plain `Error` with a message safe to show the user as-is.
 * `catalogStale` is a soft signal only (never throws): the caller decides whether/how to warn.
 */
function unwrap<T>(
  raw: unknown,
  expectedKind: EnvelopeKind,
): { data: T; catalogStale: boolean } {
  if (!isPlain(raw) || typeof raw.v !== "number") {
    return { data: raw as T, catalogStale: false };
  }
  if (raw.kind !== expectedKind) {
    throw new Error(
      `This is a "${raw.kind ?? "unknown"}" file, not a "${expectedKind}" one.`,
    );
  }
  if (raw.v !== SCHEMA_VERSION) {
    throw new Error(
      raw.v < SCHEMA_VERSION
        ? `This ${expectedKind} was made with an older version of the app and can no longer be opened.`
        : `This ${expectedKind} was made with a newer version of the app — open it there instead.`,
    );
  }
  return {
    data: raw.data as T,
    catalogStale:
      typeof raw.catalog === "number" && raw.catalog !== NW_CATALOG_VERSION,
  };
}

/** Reads and unwraps one localStorage key. Returns `null` for "nothing stored" (the normal
 * first-visit/never-saved case) exactly as before, but also for a version/kind mismatch --
 * the caller's existing "nothing stored" fallback is what makes that non-fatal, per this
 * module's own envelope comment above. The mismatch itself still surfaces, once, as a notice. */
function readEnveloped<T>(key: string, kind: EnvelopeKind): T | null {
  let stored = null;
  try {
    stored = JSON.parse(window.localStorage.getItem(key) ?? "null");
  } catch {
    return null;
  }
  if (!stored) return null;
  try {
    return unwrap<T>(stored, kind).data;
  } catch (error: unknown) {
    showNotice(
      `${error instanceof Error ? error.message : String(error)} — starting fresh.`,
    );
    return null;
  }
}

// --- identifiers --------------------------------------------------------------------------

export const newId = (prefix = "b") =>
  `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;

// --- builds -------------------------------------------------------------------------------

/**
 * `context`'s starting shape comes entirely from the `options` section's `build_parameter`
 * slots' own `default` -- no separate defaults object to keep in sync with the slot list, and
 * no forte-specific special case (its 3 picks are just 3 more `default`s on 3 more slots).
 */
export function defaultBuild(name = "New build"): Build {
  const root: { context: Record<string, unknown> } = { context: {} };
  const assignments: Build["assignments"] = {};
  // Base catalogue only (no workspace overlay) -- same reach every other pure helper in this
  // file has, and enough to seed every shipped point_assignment row's default.
  const db = baseDb();
  for (const slot of NW_SLOTS.slots) {
    if (slot.type === "build_parameter" && slot.default !== undefined) {
      setPath(root.context, slot.path, slot.default);
    } else if (slot.type === "point_assignment") {
      const row: Record<string, number> = {};
      for (const item of db.forSlot(slot.id))
        row[item.id] = item.pointAssignment!.default;
      assignments[slot.id] = row;
    }
  }
  return {
    id: newId(),
    name,
    choices: {},
    values: {},
    assignments,
    context: root.context as unknown as Build["context"],
    // The quick-compare picker (App.vue topbar). Saved with the build -- unlike `tab`, which
    // is pure session state -- so reopening a build remembers what you were sizing it up
    // against. `id` is another build's id, resolved (and gracefully dropped if it no longer
    // exists) by App.vue's own `compareBuild` computed, not here.
    compare: { id: "", highlight: false, onlyDiff: false },
  };
}

/**
 * Coerce anything build-shaped into a valid build. Tolerates a truncated write, an older
 * shape, a hand-edited export, or a user who pasted nonsense: unknown keys survive, missing
 * ones fall back to defaults, and the wrong type anywhere is replaced rather than thrown on.
 */
const isPlain = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const strings = (source: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!isPlain(source)) return out;
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "string" && value !== "" && value !== "-")
      out[key] = value;
  }
  return out;
};
const numbers = (source: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (!isPlain(source)) return out;
  for (const [key, value] of Object.entries(source)) {
    const parsed = Number(value);
    if (value !== "" && value != null && Number.isFinite(parsed))
      out[key] = parsed;
  }
  return out;
};
const booleans = (source: unknown): Record<string, boolean> => {
  const out: Record<string, boolean> = {};
  if (!isPlain(source)) return out;
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === "boolean") out[key] = value;
  }
  return out;
};

/** `assignments`' own coercion: a slot id's inner map falls back to `base`'s (each row's
 * seeded default) key by key, rather than replacing the whole inner map, so a raw payload
 * missing one row (an older export, a hand trim) doesn't lose the other rows' defaults. */
const nestedNumbers = (
  source: unknown,
  base: Record<string, Record<string, number>>,
): Record<string, Record<string, number>> => {
  const out: Record<string, Record<string, number>> = {};
  const raw = isPlain(source) ? source : {};
  for (const slotId of new Set([...Object.keys(base), ...Object.keys(raw)])) {
    out[slotId] = { ...base[slotId], ...numbers(raw[slotId]) };
  }
  return out;
};

/**
 * Coerce anything build-shaped into a valid build. Tolerates a truncated write, an older
 * shape, a hand-edited export, or a user who pasted nonsense: unknown keys survive, missing
 * ones fall back to defaults, and the wrong type anywhere is replaced rather than thrown on.
 */
export function normalise(
  raw: unknown,
  { keepId = true }: { keepId?: boolean } = {},
): Build {
  const base = defaultBuild();
  if (!isPlain(raw)) return base;

  const context = isPlain(raw.context) ? raw.context : {};
  const compare = isPlain(raw.compare) ? raw.compare : {};

  // Custom gear stored with the build. Nothing writes this yet -- the editor edits the
  // workspace layer -- but preserving it here means a build carrying custom items survives
  // a save/reload/share round trip, so turning the feature on is a UI change and not a
  // migration. `App.vue` already folds `build.catalog` in as a catalogue layer.
  const perBuild: CatalogOverlay | null = isPlain(raw.catalog)
    ? catalog.normaliseOverlay(raw.catalog)
    : null;

  const downloaded = isPlain(raw.downloaded)
    ? (raw.downloaded as Build["downloaded"])
    : undefined;

  return {
    ...base,
    ...(perBuild && !catalog.isEmpty(perBuild) ? { catalog: perBuild } : {}),
    id: keepId && typeof raw.id === "string" && raw.id ? raw.id : base.id,
    name:
      typeof raw.name === "string" && raw.name.trim() ? raw.name : base.name,
    choices: strings(raw.choices),
    values: numbers(raw.values),
    assignments: nestedNumbers(raw.assignments, base.assignments),
    // `context`'s pass-through fields (class/role/combatType/damageType) are not
    // individually validated -- the result is only knowable-safe by construction, not by
    // the type checker; hence the cast.
    context: {
      ...base.context,
      ...context,
      duration: Number.isFinite(Number(context.duration))
        ? Math.max(Number(context.duration), 0)
        : base.context.duration,
      magnitude: Number.isFinite(Number(context.magnitude))
        ? Number(context.magnitude)
        : base.context.magnitude,
      toggles: {
        ...base.context.toggles,
        ...(isPlain(context.toggles) ? context.toggles : {}),
      },
      forte: {
        ...base.context.forte,
        ...(isPlain(context.forte) ? context.forte : {}),
      },
    } as Build["context"],
    compare: {
      id: typeof compare.id === "string" ? compare.id : base.compare.id,
      highlight: Boolean(compare.highlight),
      onlyDiff: Boolean(compare.onlyDiff),
    },
    ...(downloaded ? { downloaded } : {}),
  };
}

export function duplicate(build: Build, name?: string): Build {
  return {
    ...normalise(build),
    id: newId(),
    name: name ?? `${build.name} copy`,
  };
}

// --- the catalogue overlay ---------------------------------------------------------------
// The editor's layer over the shipped items and bonuses. Kept under its own key because it
// is a workspace, not part of any build: switching builds must not change the catalogue.

export function loadOverlay() {
  return catalog.normaliseOverlay(
    readEnveloped<unknown>(OVERLAY_KEY, "overlay"),
  );
}

export function saveOverlay(overlay: CatalogOverlay) {
  try {
    if (catalog.isEmpty(overlay)) window.localStorage.removeItem(OVERLAY_KEY);
    else
      window.localStorage.setItem(
        OVERLAY_KEY,
        JSON.stringify(wrap("overlay", overlay)),
      );
    return true;
  } catch {
    return false;
  }
}

// --- ui state ----------------------------------------------------------------------------
// View-only preferences (e.g. which BuildEditor sections are open) that live alongside builds
// but aren't part of any one build -- same reasoning as the catalogue overlay above. App.vue
// supplies its own defaults for anything missing here, so this only has to carry what's set.

export interface UiState {
  expanded: Record<string, boolean>;
}

export function loadUiState(): Partial<UiState> {
  try {
    const stored = JSON.parse(window.localStorage.getItem(UI_KEY) ?? "null");
    return isPlain(stored) ? { expanded: booleans(stored.expanded) } : {};
  } catch {
    return {};
  }
}

export function saveUiState(state: UiState) {
  try {
    window.localStorage.setItem(UI_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

// --- theme preference (type only — persistence uses useStorage in stores/theme.ts) --------

export type ThemePreference = "light" | "dark" | "system";

// --- layer storage (new in phase 2a) -----------------------------------------------------

/** A brand-new layer with an empty overlay. */
export function defaultLayer(name = "Layer"): Layer {
  return {
    id: newId("l"),
    name,
    enabled: true,
    overlay: catalog.emptyOverlay(),
  };
}

/** Tolerant coercion, same spirit as `normalise`. */
export function normaliseLayer(raw: unknown): Layer {
  const base = defaultLayer("Layer");
  if (!isPlain(raw)) return base;
  const downloaded = isPlain(raw.downloaded)
    ? (raw.downloaded as Layer["downloaded"])
    : undefined;
  return {
    id: typeof raw.id === "string" && raw.id ? raw.id : base.id,
    name:
      typeof raw.name === "string" && raw.name.trim() ? raw.name : base.name,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    overlay: catalog.normaliseOverlay(raw.overlay),
    ...(downloaded ? { downloaded } : {}),
  };
}

// --- IDB persistence (new in phase 2a) ---------------------------------------------------

/** Load every record from every IDB store, repairing `meta` against what actually exists. */
export async function loadAll(): Promise<{
  builds: Build[];
  layers: Layer[];
  meta: AppMeta;
  trash: TrashEntry[];
  history: Map<string, ItemHistory>;
}> {
  const [rawBuilds, rawLayers, rawMeta, rawTrash, rawHistory] =
    await Promise.all([
      idb.getAll("builds"),
      idb.getAll("layers"),
      idb.get("meta", "app"),
      idb.getAll("trash"),
      idb.getAll("history"),
    ]);

  // Unwrap envelopes: each record is `wrap("build", build)` or `wrap("layer", layer)`.
  const unwrapEnvelope = (raw: unknown) => {
    if (isPlain(raw) && typeof raw.v === "number" && isPlain(raw.data))
      return raw.data as Record<string, unknown>;
    return raw as Record<string, unknown>;
  };

  const builds: Build[] = (rawBuilds as unknown[]).map((b: unknown) =>
    normalise(unwrapEnvelope(b)),
  );
  const layers: Layer[] = (rawLayers as unknown[]).map((l: unknown) =>
    normaliseLayer(unwrapEnvelope(l)),
  );
  const trash: TrashEntry[] = (rawTrash as TrashEntry[]).filter(
    (t) => isPlain(t) && (t.kind === "build" || t.kind === "layer"),
  );

  const buildIds = new Set(builds.map((b) => b.id));
  const layerIds = new Set(layers.map((l) => l.id));

  // Repair meta: drop dangling ids, append unlisted ones.
  const rawMetaObj =
    rawMeta && isPlain(rawMeta) ? (rawMeta as Record<string, unknown>) : null;
  const meta: AppMeta = rawMetaObj
    ? {
        buildOrder: Array.isArray(rawMetaObj.buildOrder)
          ? (rawMetaObj.buildOrder as string[]).filter((id: string) =>
              buildIds.has(id),
            )
          : [],
        layerOrder: Array.isArray(rawMetaObj.layerOrder)
          ? (rawMetaObj.layerOrder as string[]).filter((id: string) =>
              layerIds.has(id),
            )
          : [],
        lastSelection:
          rawMetaObj.lastSelection && isPlain(rawMetaObj.lastSelection)
            ? (rawMetaObj.lastSelection as Selection)
            : null,
      }
    : { buildOrder: [], layerOrder: [], lastSelection: null };

  for (const id of buildIds) {
    if (!meta.buildOrder.includes(id)) meta.buildOrder.push(id);
  }
  for (const id of layerIds) {
    if (!meta.layerOrder.includes(id)) meta.layerOrder.push(id);
  }

  // Build history map: keyed `<kind>:<id>`, drop histories whose item no longer exists
  // and is not in the trash (a restored item should get its undo history back).
  const history = new Map<string, ItemHistory>();
  const allLive = new Set([...buildIds, ...layerIds]);
  const trashedIds = new Set<string>();
  for (const entry of trash) {
    trashedIds.add(entry.item.id);
  }
  for (const raw of rawHistory as unknown[]) {
    if (isPlain(raw) && typeof raw.id === "string" && isPlain(raw.data)) {
      const key = raw.id as string;
      // Extract the id from the key `<kind>:<id>`
      const itemId = key.includes(":") ? key.split(":")[1] : key;
      if (allLive.has(itemId) || trashedIds.has(itemId)) {
        history.set(key, raw.data as unknown as ItemHistory);
      }
    }
  }

  return { builds, layers, meta, trash, history };
}

export async function putBuild(build: Build): Promise<void> {
  await idb.put("builds", build.id, wrap("build", build));
}

export async function putLayer(layer: Layer): Promise<void> {
  await idb.put("layers", layer.id, wrap("layer", layer));
}

export async function deleteBuildRecord(id: string): Promise<void> {
  await idb.remove("builds", id);
}

export async function deleteLayerRecord(id: string): Promise<void> {
  await idb.remove("layers", id);
}

export async function putMeta(meta: AppMeta): Promise<void> {
  await idb.put("meta", "app", meta);
}

export async function putTrash(entry: TrashEntry): Promise<void> {
  await idb.put(
    "trash",
    `${entry.kind}_${entry.item.id}_${entry.deletedAt}`,
    entry,
  );
}

export async function deleteTrash(key: string): Promise<void> {
  await idb.remove("trash", key);
}

// --- comparison helpers -------------------------------------------------------------------

/** Key-order-insensitive comparison of two items, ignoring `downloaded` (which would
 * otherwise make every compare-after-save report as different). */
export function sameContent<T extends { downloaded?: unknown }>(
  a: T | null | undefined,
  b: T | null | undefined,
): boolean {
  if (!a || !b) return a === b;
  const { downloaded: _da, ...restA } = a;
  const { downloaded: _db, ...restB } = b;
  return deepEqual(restA, restB);
}

/** Rebuild an item from its `downloaded.snapshot`, keeping its id and name. */
export function revertToDownloaded<
  T extends { id: string; name: string; downloaded?: { snapshot: T } },
>(item: T): T {
  if (!item.downloaded?.snapshot) return item;
  return {
    ...item.downloaded.snapshot,
    id: item.id,
    name: item.name,
  };
}

// --- import / export (layers and bundles) -------------------------------------------------

export const toJson = (value: unknown) => JSON.stringify(value, null, 2);

/** A single build's own export -- the counterpart `parseJson` unwraps. Strips the `compare`
 *  field (it references a sibling build by id and means nothing elsewhere; `normalise`
 *  refills the default on import) and embeds catalogue entries the build depends on that
 *  the shipped base does not already provide. */
export function toBuildJson(build: Build, db?: Db): string {
  const { compare: _c, ...rest } = build;
  const stripped: Build = rest as Build;
  if (db) {
    const embedded = catalog.referencedOverlay(db, stripped);
    if (!catalog.isEmpty(embedded)) {
      stripped.catalog = embedded;
    } else {
      delete stripped.catalog;
    }
  }
  return toJson(wrap("build", stripped));
}

/** A single layer's export. */
export const toLayerJson = (layer: Layer) => toJson(wrap("layer", layer));

/** A combined bundle of builds + layers for export. */
export interface Bundle {
  builds: Build[];
  layers: Layer[];
}

export const toBundleJson = (bundle: Bundle) => toJson(wrap("bundle", bundle));

/**
 * Accepts a single (enveloped) build, or -- for backward compatibility with anything saved
 * before the envelope existed -- an un-enveloped single build or array of them, and returns an
 * array either way. Throws only on unparseable text or a version/kind mismatch; structural
 * problems within a build are absorbed by `normalise`.
 */
export function parseJson(text: string): {
  builds: Build[];
  catalogStale: boolean;
} {
  const parsed = JSON.parse(text);
  const { data, catalogStale } = unwrap<unknown>(parsed, "build");
  const list = Array.isArray(data) ? data : [data];
  if (!list.length) throw new Error("no builds in that JSON");
  return {
    builds: list.map((build) => normalise(build, { keepId: false })),
    catalogStale,
  };
}

/** Parse a single-layer export. */
export function parseLayerJson(text: string): {
  layer: Layer;
  catalogStale: boolean;
} {
  const parsed = JSON.parse(text);
  const { data, catalogStale } = unwrap<unknown>(parsed, "layer");
  return { layer: normaliseLayer(data), catalogStale };
}

/** Parse a bundle export. */
export function parseBundleJson(text: string): {
  bundle: Bundle;
  catalogStale: boolean;
} {
  const parsed = JSON.parse(text);
  const { data, catalogStale } = unwrap<unknown>(parsed, "bundle");
  const bundle = data as { builds?: unknown[]; layers?: unknown[] };

  const rawBuilds = (bundle.builds ?? []).map((b: unknown) =>
    normalise(b, { keepId: false }),
  );
  const rawLayers = (bundle.layers ?? []).map((l: unknown) =>
    normaliseLayer(l),
  );

  // Fresh ids throughout, name collisions suffixed `(2)`
  const seenBuildNames = new Set<string>();
  const builds = rawBuilds.map((b) => {
    let name = b.name;
    while (seenBuildNames.has(name)) name = `${name} (2)`;
    seenBuildNames.add(name);
    return { ...b, id: newId("b"), name };
  });

  const seenLayerNames = new Set<string>();
  const layers = rawLayers.map((l) => {
    let name = l.name;
    while (seenLayerNames.has(name)) name = `${name} (2)`;
    seenLayerNames.add(name);
    return { ...l, id: newId("l"), name };
  });

  return { bundle: { builds, layers }, catalogStale };
}
