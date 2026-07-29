// Build persistence, import/export and share links (plan §4.2, Phase 4).
//
// Owns the shape of a stored build so `App.vue` never has to reason about it: anything that
// comes back from localStorage, a pasted JSON blob or a URL hash goes through `normalise`
// first, and anything `normalise` returns is safe to hand straight to the engine.
//
// The saved library lives under `nw:builds`, written only when the user explicitly saves (or
// by a structural change that has nothing pending to lose -- see App.vue's `saveActive`). The
// live, possibly-unsaved draft lives separately under `nw:builds-draft`, autosaved continuously
// so a reload never loses work in progress. Phase 3 autosaved a single build under
// `nw:current-build`; that key is migrated into the saved library on first load and then
// removed.

import { NW_SCHEMA } from './data';
import * as catalog from './catalog';
import type { Build, ForteSplit, Library, Collection, Collections, CatalogOverlay } from './types';

const KEY = 'nw:builds';
const DRAFT_KEY = 'nw:builds-draft';
const LEGACY_KEY = 'nw:current-build';
const OVERLAY_KEY = 'nw:catalog-overlay';
const UI_KEY = 'nw:ui';
const COLLECTIONS_KEY = 'nw:collections';
const COLLECTIONS_DRAFT_KEY = 'nw:collections-draft';
const HASH_PREFIX = '#b=';

// Payload markers, so a link made before/after a browser gained CompressionStream still
// decodes. `d` = raw deflate, `j` = uncompressed JSON.
const DEFLATED = 'd';
const PLAIN = 'j';

/**
 * The sheet's own forte picks. `NW_SCHEMA.context.defaults` carries no `forte` key -- see the
 * open item in llm/plans/0002-ui-handoff.md §9.
 */
const DEFAULT_FORTE: Required<ForteSplit> = { primary: 'power_p', secondaryA: 'strike_p', secondaryB: 'awareness_p' };

export const newId = (prefix = 'b') => `${prefix}_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;

export function defaultBuild(name = 'New build'): Build {
  const defaults = NW_SCHEMA.context.defaults;
  return {
    id: newId(),
    name,
    updated: Date.now(),
    choices: {},
    values: {},
    context: {
      ...defaults,
      toggles: { ...defaults.toggles },
      forte: { ...DEFAULT_FORTE },
    },
    // The quick-compare picker (App.vue topbar). Saved with the build -- unlike `tab`, which
    // is pure session state -- so reopening a build remembers what you were sizing it up
    // against. `id` is another build's id, resolved (and gracefully dropped if it no longer
    // exists) by App.vue's own `compareBuild` computed, not here.
    compare: { id: '', highlight: false, onlyDiff: false },
  };
}

/**
 * Coerce anything build-shaped into a valid build. Tolerates a truncated write, an older
 * shape, a hand-edited export, or a user who pasted nonsense: unknown keys survive, missing
 * ones fall back to defaults, and the wrong type anywhere is replaced rather than thrown on.
 */
const isPlain = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const strings = (source: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (!isPlain(source)) return out;
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string' && value !== '' && value !== '-') out[key] = value;
  }
  return out;
};
const numbers = (source: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (!isPlain(source)) return out;
  for (const [key, value] of Object.entries(source)) {
    const parsed = Number(value);
    if (value !== '' && value != null && Number.isFinite(parsed)) out[key] = parsed;
  }
  return out;
};
const booleans = (source: unknown): Record<string, boolean> => {
  const out: Record<string, boolean> = {};
  if (!isPlain(source)) return out;
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'boolean') out[key] = value;
  }
  return out;
};

/**
 * Coerce anything build-shaped into a valid build. Tolerates a truncated write, an older
 * shape, a hand-edited export, or a user who pasted nonsense: unknown keys survive, missing
 * ones fall back to defaults, and the wrong type anywhere is replaced rather than thrown on.
 */
export function normalise(raw: unknown, { keepId = true }: { keepId?: boolean } = {}): Build {
  const base = defaultBuild();
  if (!isPlain(raw)) return base;

  const context = isPlain(raw.context) ? raw.context : {};
  const compare = isPlain(raw.compare) ? raw.compare : {};

  // Custom gear stored with the build. Nothing writes this yet -- the editor edits the
  // workspace layer -- but preserving it here means a build carrying custom items survives
  // a save/reload/share round trip, so turning the feature on is a UI change and not a
  // migration. `App.vue` already folds `build.catalog` in as a catalogue layer.
  const perBuild: CatalogOverlay | null = isPlain(raw.catalog) ? catalog.normaliseOverlay(raw.catalog) : null;

  return {
    ...base,
    ...(perBuild && !catalog.isEmpty(perBuild) ? { catalog: perBuild } : {}),
    id: keepId && typeof raw.id === 'string' && raw.id ? raw.id : base.id,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : base.name,
    updated: Number.isFinite(raw.updated) ? raw.updated as number : Date.now(),
    choices: strings(raw.choices),
    values: numbers(raw.values),
    // `context`'s pass-through fields (class/role/combatType/location/damageType) are not
    // individually validated -- same tolerance policy the untyped original had -- so the
    // result is only knowable-safe by construction, not by the type checker; hence the cast.
    context: {
      ...base.context,
      ...context,
      duration: Number.isFinite(Number(context.duration))
        ? Math.max(Number(context.duration), 0)
        : base.context.duration,
      magnitude: Number.isFinite(Number(context.magnitude))
        ? Number(context.magnitude)
        : base.context.magnitude,
      toggles: { ...base.context.toggles, ...(isPlain(context.toggles) ? context.toggles : {}) },
      forte: { ...base.context.forte, ...(isPlain(context.forte) ? context.forte : {}) },
    } as Build['context'],
    compare: {
      id: typeof compare.id === 'string' ? compare.id : base.compare.id,
      highlight: Boolean(compare.highlight),
      onlyDiff: Boolean(compare.onlyDiff),
    },
  };
}

export function duplicate(build: Build, name?: string): Build {
  return { ...normalise(build), id: newId(), name: name ?? `${build.name} copy`,
    updated: Date.now() };
}

/** A deep copy safe to seed `savedById` from `builds` (or back) without aliasing the
 * reactive proxy -- `normalise` already copies deeply and keeps the id. */
export const cloneBuild = (build: Build): Build => normalise(build);

/**
 * Key-order-insensitive, `updated`-blind equality for the dirty check. `choices`/`values`/
 * `toggles` grow and shrink by direct property add/delete, so a plain `JSON.stringify`
 * comparison would false-positive on a save-then-revert; sorting keys fixes that. `updated`
 * is excluded because only the saved copy gets it stamped (App.vue's `saveActive`), so
 * comparing it would report every build dirty forever after its first save.
 */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = canonical((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
};

export function sameBuild(a: Build | null | undefined, b: Build | null | undefined) {
  if (!a || !b) return a === b;
  const { updated: ua, ...restA } = a;
  const { updated: ub, ...restB } = b;
  return JSON.stringify(canonical(restA)) === JSON.stringify(canonical(restB));
}

// --- the library ------------------------------------------------------------------------

function emptyLibrary(): Library {
  const build = defaultBuild();
  return { builds: [build], activeId: build.id };
}

export function loadLibrary(): Library {
  let stored = null;
  try {
    stored = JSON.parse(window.localStorage.getItem(KEY) ?? 'null');
  } catch {
    stored = null;
  }

  if (!stored || !Array.isArray(stored.builds) || !stored.builds.length) {
    const migrated = migrateLegacy();
    return migrated ?? emptyLibrary();
  }

  const builds: Build[] = stored.builds.map((build: unknown) => normalise(build));
  const activeId = builds.some((build) => build.id === stored.activeId)
    ? stored.activeId
    : builds[0].id;
  return { builds, activeId };
}

/** Phase 3's single-build key. Read once, folded into the library, then dropped. */
function migrateLegacy(): Library | null {
  let legacy = null;
  try {
    legacy = JSON.parse(window.localStorage.getItem(LEGACY_KEY) ?? 'null');
  } catch {
    return null;
  }
  if (!legacy || typeof legacy !== 'object') return null;

  const build = normalise(legacy);
  try {
    window.localStorage.removeItem(LEGACY_KEY);
  } catch { /* nothing to do about it */ }
  return { builds: [build], activeId: build.id };
}

export function saveLibrary(library: Library) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({
      builds: library.builds,
      activeId: library.activeId,
    }));
    return true;
  } catch {
    // Private browsing, or quota. The caller is told, so it can surface it once rather than
    // silently -- losing a save is worth telling the user about, unlike the draft below.
    return false;
  }
}

/**
 * The live, possibly-unsaved draft. Falls back to a clone of the saved library when there is
 * no draft yet -- either a first-ever visit, or an existing user's first load after this
 * split shipped, when `nw:builds` (their old autosave target) is the only copy of the truth.
 */
export function loadDraft(saved: Library): Library {
  let stored = null;
  try {
    stored = JSON.parse(window.localStorage.getItem(DRAFT_KEY) ?? 'null');
  } catch {
    stored = null;
  }

  if (!stored || !Array.isArray(stored.builds) || !stored.builds.length) {
    return { builds: saved.builds.map((build) => cloneBuild(build)), activeId: saved.activeId };
  }

  const builds: Build[] = stored.builds.map((build: unknown) => normalise(build));
  const activeId = builds.some((build) => build.id === stored.activeId)
    ? stored.activeId
    : builds[0].id;
  return { builds, activeId };
}

export function saveDraft(library: Library) {
  try {
    window.localStorage.setItem(DRAFT_KEY, JSON.stringify({
      builds: library.builds,
      activeId: library.activeId,
    }));
    return true;
  } catch {
    // Private browsing, or quota. Losing the continuous draft autosave is not worth an error
    // dialogue by itself -- the caller only surfaces it once `saveActive` also fails.
    return false;
  }
}

// --- collections -------------------------------------------------------------------------
// A thin grouping layer over the flat `builds` pool above: a collection references build ids
// rather than nesting build objects, so a build's content still lives in exactly one place
// and every existing per-build mechanism (undo, dirty check, revert, copy-section) keeps
// working unmodified. Saved/draft split mirrors the library above for the same reason: the
// draft (`nw:collections-draft`) autosaves continuously so creating/renaming/reordering
// collections survives a reload, while `nw:collections` only moves on an explicit collection
// Save.

function makeCollectionFor(builds: Build[], name: string): Collection {
  return {
    id: newId('c'),
    name,
    updated: Date.now(),
    buildIds: builds.map((build) => build.id),
    activeBuildId: builds[0].id,
  };
}

/** A brand new collection wrapping one brand new build -- App.vue's `createCollection`. */
export const defaultCollection = (name: string, build: Build) => makeCollectionFor([build], name);

/** Tolerant coercion, same spirit as `normalise`: drops any `buildIds` entry that no longer
 * exists in the flat pool (deleted independently, or a hand-edited import), and reports back
 * null -- rather than a hollow collection -- when nothing valid survives, so the caller can
 * fall back to wrapping the whole pool instead of showing an empty group. */
function normaliseCollection(raw: unknown, idSet: Set<string>): Collection | null {
  if (!isPlain(raw)) return null;
  const buildIds: string[] = Array.isArray(raw.buildIds) ? raw.buildIds.filter((id: string) => idSet.has(id)) : [];
  if (!buildIds.length) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId('c'),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name : 'Collection',
    updated: Number.isFinite(raw.updated) ? raw.updated as number : Date.now(),
    buildIds,
    activeBuildId: buildIds.includes(raw.activeBuildId as string) ? raw.activeBuildId as string : buildIds[0],
  };
}

/** Every build in the flat pool must be reachable from some collection, or it would simply
 * vanish from the sidebar. Orphans (a build the stored grouping never mentioned -- normally
 * only on the very first load after this feature shipped) are folded into the first
 * collection rather than dropped. */
function coverBuilds(collections: Collection[], builds: Build[]): Collection[] {
  const covered = new Set(collections.flatMap((collection) => collection.buildIds));
  const orphans = builds.map((build) => build.id).filter((id) => !covered.has(id));
  if (!orphans.length) return collections;
  return collections.map((collection, index) => (index === 0
    ? { ...collection, buildIds: [...collection.buildIds, ...orphans] }
    : collection));
}

function readCollections(key: string, builds: Build[]): Collections | null {
  let stored = null;
  try {
    stored = JSON.parse(window.localStorage.getItem(key) ?? 'null');
  } catch {
    stored = null;
  }
  if (stored && Array.isArray(stored.collections) && stored.collections.length) {
    const idSet = new Set(builds.map((build) => build.id));
    const collections = coverBuilds(
      stored.collections.map((raw: unknown) => normaliseCollection(raw, idSet)).filter((c: Collection | null): c is Collection => c !== null),
      builds,
    );
    if (collections.length) {
      const activeCollectionId = collections.some((c) => c.id === stored.activeCollectionId)
        ? stored.activeCollectionId
        : collections[0].id;
      return { collections, activeCollectionId };
    }
  }
  return null;
}

/** `builds` is the already-loaded flat pool (never empty -- `loadLibrary`/`emptyLibrary`
 * guarantee that). Nothing stored, or nothing in it survives, wraps every build the pool
 * has into one catch-all collection -- this is also how an existing user's first load after
 * this feature shipped picks up their prior builds with no separate migration step. */
export function loadCollections(builds: Build[]): Collections {
  const result = readCollections(COLLECTIONS_KEY, builds);
  if (result) return result;
  const fresh = makeCollectionFor(builds, 'My builds');
  return { collections: [fresh], activeCollectionId: fresh.id };
}

export function saveCollections(state: Collections) {
  try {
    window.localStorage.setItem(COLLECTIONS_KEY, JSON.stringify({
      collections: state.collections,
      activeCollectionId: state.activeCollectionId,
    }));
    return true;
  } catch {
    return false;
  }
}

/** Falls back to a clone of the saved grouping when there is no draft yet, same reasoning as
 * `loadDraft` above. */
export function loadCollectionsDraft(builds: Build[], saved: Collections): Collections {
  const result = readCollections(COLLECTIONS_DRAFT_KEY, builds);
  if (result) return result;
  return {
    collections: coverBuilds(
      saved.collections.map((collection) => ({ ...collection, buildIds: [...collection.buildIds] })),
      builds,
    ),
    activeCollectionId: saved.activeCollectionId,
  };
}

export function saveCollectionsDraft(state: Collections) {
  try {
    window.localStorage.setItem(COLLECTIONS_DRAFT_KEY, JSON.stringify({
      collections: state.collections,
      activeCollectionId: state.activeCollectionId,
    }));
    return true;
  } catch {
    return false;
  }
}

/** A self-contained snapshot of one collection -- used for export, file-save, and duplicate --
 * bundling the actual build objects (not just the ids a collection otherwise stores) so it
 * can round-trip through `parseCollectionJson` with no other context. */
export function bundleCollection(collection: Collection, buildsById: Record<string, Build>) {
  return {
    id: collection.id,
    name: collection.name,
    updated: collection.updated,
    builds: collection.buildIds.map((id) => buildsById[id]).filter(Boolean),
  };
}

/** The reverse of `bundleCollection`: re-ids the collection and every build inside it (like
 * `parseJson`'s `keepId: false`), so importing a file can never collide with, or overwrite,
 * a collection/build already in the library. */
export function parseCollectionJson(text: string): { collection: Collection; builds: Build[] } {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.builds) || !parsed.builds.length) {
    throw new Error('no builds in that collection');
  }
  const builds: Build[] = parsed.builds.map((build: unknown) => normalise(build, { keepId: false }));
  const collection: Collection = {
    id: newId('c'),
    name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name : 'Imported collection',
    updated: Date.now(),
    buildIds: builds.map((build) => build.id),
    activeBuildId: builds[0].id,
  };
  return { collection, builds };
}

/** Same re-id treatment as an import -- a duplicate must never share a build id with its
 * source, or the two collections would silently edit the same build. */
export function duplicateCollection(collection: Collection, buildsById: Record<string, Build>, name?: string) {
  const builds = collection.buildIds.map((id) => duplicate(buildsById[id]));
  return {
    collection: {
      id: newId('c'),
      name: name ?? `${collection.name} copy`,
      updated: Date.now(),
      buildIds: builds.map((build) => build.id),
      activeBuildId: builds[0]?.id ?? null,
    },
    builds,
  };
}

// --- the catalogue overlay ---------------------------------------------------------------
// The editor's layer over the shipped items and bonuses. Kept under its own key because it
// is a workspace, not part of any build: switching builds must not change the catalogue.

export function loadOverlay() {
  try {
    return catalog.normaliseOverlay(
      JSON.parse(window.localStorage.getItem(OVERLAY_KEY) ?? 'null'),
    );
  } catch {
    return catalog.emptyOverlay();
  }
}

export function saveOverlay(overlay: CatalogOverlay) {
  try {
    if (catalog.isEmpty(overlay)) window.localStorage.removeItem(OVERLAY_KEY);
    else window.localStorage.setItem(OVERLAY_KEY, JSON.stringify(overlay));
    return true;
  } catch {
    return false;
  }
}

// --- ui state ----------------------------------------------------------------------------
// View-only preferences (e.g. which SlotList sections are open) that live alongside builds
// but aren't part of any one build -- same reasoning as the catalogue overlay above. App.vue
// supplies its own defaults for anything missing here, so this only has to carry what's set.

export interface UiState {
  expanded: Record<string, boolean>;
}

export function loadUiState(): Partial<UiState> {
  try {
    const stored = JSON.parse(window.localStorage.getItem(UI_KEY) ?? 'null');
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

// --- import / export --------------------------------------------------------------------

// Not narrowed to `Build`: also used to serialise a collection bundle (`bundleCollection`'s
// `{ id, name, updated, builds }`), which isn't a build itself.
export const toJson = (value: unknown) => JSON.stringify(value, null, 2);

/**
 * Accepts a single build or an array of them, and returns an array either way. Throws only
 * on unparseable text -- structural problems are absorbed by `normalise`.
 */
export function parseJson(text: string): Build[] {
  const parsed = JSON.parse(text);
  const list = Array.isArray(parsed) ? parsed : [parsed];
  if (!list.length) throw new Error('no builds in that JSON');
  return list.map((build) => normalise(build, { keepId: false }));
}

// --- share links ------------------------------------------------------------------------

const bytesToBase64Url = (bytes: Uint8Array) => {
  // Chunked: String.fromCharCode(...bytes) blows the argument limit on a few kB.
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  }
  return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const base64UrlToBytes = (text: string) => {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(Math.ceil(text.length / 4) * 4, '=');
  const binary = window.atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

const hasCompression = () => typeof CompressionStream === 'function'
  && typeof DecompressionStream === 'function';

/**
 * A build is ~4 kB of repetitive JSON -- slot ids and item names -- so deflate takes it to
 * roughly a tenth of that, which keeps the link inside every practical URL limit.
 */
export async function encodeShare(build: Build) {
  const json = JSON.stringify(normalise(build));
  const bytes = new TextEncoder().encode(json);
  if (!hasCompression()) return PLAIN + bytesToBase64Url(bytes);

  const stream = new Blob([bytes]).stream()
    .pipeThrough(new CompressionStream('deflate-raw'));
  const buffer = await new Response(stream).arrayBuffer();
  return DEFLATED + bytesToBase64Url(new Uint8Array(buffer));
}

export async function decodeShare(payload: string): Promise<Build | null> {
  if (!payload) return null;
  const marker = payload[0];
  const bytes = base64UrlToBytes(payload.slice(1));

  let json;
  if (marker === DEFLATED) {
    if (!hasCompression()) throw new Error('this browser cannot read compressed links');
    const stream = new Blob([bytes as BlobPart]).stream()
      .pipeThrough(new DecompressionStream('deflate-raw'));
    json = await new Response(stream).text();
  } else if (marker === PLAIN) {
    json = new TextDecoder().decode(bytes);
  } else {
    throw new Error('unrecognised share link');
  }

  return normalise(JSON.parse(json), { keepId: false });
}

export const shareUrl = (payload: string) => {
  const url = new URL(window.location.href);
  url.hash = '';
  return `${url.href.replace(/#$/, '')}${HASH_PREFIX}${payload}`;
};

/** The payload in the current URL, or null. Does not modify the URL. */
export const readHash = () => (window.location.hash.startsWith(HASH_PREFIX)
  ? window.location.hash.slice(HASH_PREFIX.length)
  : null);

/** Drop the hash without adding a history entry -- the link has been consumed. */
export const clearHash = () => {
  const url = new URL(window.location.href);
  url.hash = '';
  window.history.replaceState(null, '', url.href.replace(/#$/, ''));
};
