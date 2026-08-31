// The pool of builds: id→Build map, loading, selectors, and every mutation that
// creates/destroys them. Where each one sits in the sidebar -- top level or inside a folder --
// is folders.ts's business, which this file delegates every ordering call to. Build content
// edits live in buildEditor.ts.
import { computed, ref, watch } from "vue";
import { useDebounceFn } from "@vueuse/core";
import * as storage from "../storage/storage";
import * as history from "./history";
import * as landing from "./landing";
import * as layers from "./layers";
import * as trash from "./trash";
import * as selection from "./selection";
import * as folders from "./folders";
import { buildOrder } from "./meta";
import { flagStorageFailed, showNotice } from "./notice";
import { db as engineDb } from "./resolved";
import type { Build, BuildNavEntry } from "../types";

const SAVE_DEBOUNCE_MS = 250;

const _builds = ref<Map<string, Build>>(new Map());
const _loading = ref(true);

/** The build this store keeps alive without anyone having asked for it -- minted below when
 *  the pool would otherwise be empty, and unwritten until an edit or `commitActive` marks it
 *  dirty. It is the one build that does not count as content: see `showLandingIfEmptied`. */
let _placeholderId: string | null = null;

/** Every build in sidebar order -- folder contents expanded in place, so the flat list the
 *  rest of the app reads (compare pickers, bundle export, the Go To palette) is unchanged by
 *  grouping. `folders.entries` is what the sidebar itself renders. */
export const builds = computed(() =>
  folders.orderedBuildIds.value
    .map((id) => _builds.value.get(id)!)
    .filter(Boolean),
);

/** The sidebar tree: top-level builds and folders in order, each folder with its builds. */
export const navEntries = computed<BuildNavEntry[]>(() =>
  folders.entries.value.flatMap<BuildNavEntry>((entry) => {
    if (entry.kind === "folder") {
      return [
        {
          kind: "folder" as const,
          folder: entry.folder,
          builds: entry.folder.builds
            .map((id) => _builds.value.get(id)!)
            .filter(Boolean),
        },
      ];
    }
    const b = _builds.value.get(entry.id);
    return b ? [{ kind: "build" as const, build: b }] : [];
  }),
);

export const build = computed(() => {
  const sel = selection.selection.value;
  if (sel?.kind === "build" && _builds.value.has(sel.id)) {
    return _builds.value.get(sel.id)!;
  }
  const first = folders.orderedBuildIds.value[0];
  if (first) return _builds.value.get(first)!;
  // Guarantee at least one build exists.
  const b = storage.defaultBuild("Build 1");
  _builds.value.set(b.id, b);
  buildOrder.value.push(b.id);
  _placeholderId = b.id;
  return b;
});

export const loading = computed(() => _loading.value);

export function get(id: string): Build | undefined {
  return _builds.value.get(id);
}

export function isDownloaded(id: string): boolean {
  const b = _builds.value.get(id);
  if (!b?.downloaded?.snapshot) return false;
  return storage.sameContent(
    b as { downloaded?: unknown },
    b.downloaded.snapshot as { downloaded?: unknown },
  );
}

export function downloadedAt(id: string): number | null {
  return _builds.value.get(id)?.downloaded?.at ?? null;
}

export const otherBuilds = computed(() => {
  const active = build.value;
  return builds.value
    .filter((b) => !active || b.id !== active.id)
    .map((b) => ({ value: b.id, label: b.name }));
});

// --- mutations --------------------------------------------------------------------------

export function replaceActive(newBuild: Build) {
  _builds.value.set(newBuild.id, newBuild);
  if (!folders.orderedBuildIds.value.includes(newBuild.id))
    folders.appendBuild(newBuild.id);
  markDirty(newBuild.id);
  selection.selectBuild(newBuild.id);
}

/** Persists the build this store keeps alive, and selects it. What the landing screen's
 *  "New build" does: an empty "Build 1" is always already waiting there, but nothing has
 *  written it yet, so without this it would be gone again on the next load. */
export function commitActive() {
  const b = build.value;
  if (!b) return;
  markDirty(b.id);
  selection.selectBuild(b.id);
}

export function createBuild(folderId: string | null = null) {
  const b = storage.defaultBuild(`Build ${_builds.value.size + 1}`);
  _builds.value.set(b.id, b);
  if (folderId) folders.placeBuild(b.id, folderId);
  else folders.appendBuild(b.id);
  markDirty(b.id);
  selection.selectBuild(b.id);
  showNotice(`Created “${b.name}”`);
}

export function duplicateBuild() {
  const source = build.value;
  if (!source) return;
  const copy = storage.duplicate(source);
  _builds.value.set(copy.id, copy);
  folders.insertBuildAfter(source.id, copy.id);
  markDirty(copy.id);
  selection.selectBuild(copy.id);
  showNotice(`Duplicated as “${copy.name}”`);
}

export function deleteBuild(id: string) {
  const b = _builds.value.get(id);
  if (!b) return;

  const wasLast = _builds.value.size < 2;
  if (_placeholderId === id) _placeholderId = null;

  clearDirty(id);
  _builds.value.delete(id);
  folders.removeBuild(id);
  storage.deleteBuildRecord(id).catch(() => {});

  trash._add("build", b);
  showNotice(`Deleted "${b.name}"`);

  // Deleting the last build hands a fresh one its place, so every reader of `build.value`
  // still finds one. The builder stays up rather than dropping back to the landing screen:
  // the build just deleted is sitting in the trash, and the landing would hide the nav that
  // is the only way to restore it.
  if (wasLast) {
    const replacement = storage.defaultBuild("Build 1");
    _builds.value.set(replacement.id, replacement);
    folders.appendBuild(replacement.id);
    _placeholderId = replacement.id;
    selection.selectBuild(replacement.id);
    return;
  }

  if (
    selection.selection.value?.kind === "build" &&
    selection.selection.value.id === id
  ) {
    const next = folders.orderedBuildIds.value[0];
    if (next) selection.selectBuild(next);
  }
}

/** Raises the landing screen again if emptying the trash left the app with nothing at all:
 *  no build anyone has written, no layers, and nothing else to restore. Lives here rather
 *  than in trash.ts, which builds and layers both import, and it is this store that knows
 *  which build is only a placeholder. */
export function showLandingIfEmptied() {
  const written = builds.value.some((b) => b.id !== _placeholderId);
  if (written) return;
  if (layers.layers.value.length > 0) return;
  if (trash.trashed.value.length > 0) return;
  landing.show();
}

/** Moves a build to `toIndex` inside `folderId` (the top level when null, the default).
 *  `toIndex` is relative to the target list as it stands now, before `id` is removed --
 *  callers (the delta-based `moveBuild` below, and drag-and-drop's drop-index math) both
 *  naturally produce indexes in those terms. See `folders.placeBuild`. */
export function moveBuildTo(
  id: string,
  toIndex: number,
  folderId: string | null = null,
) {
  folders.placeBuild(id, folderId, toIndex);
}

/** Nudges a build one step up/down, staying inside its own folder (or the top level). */
export function moveBuild(id: string, delta: number) {
  const at = folders.rowPosition(id);
  if (!at) return;
  folders.placeBuild(
    id,
    folders.folderOf(id)?.id ?? null,
    at.index + delta + (delta > 0 ? 1 : 0),
  );
}

export function revertToDownloaded(id: string) {
  const b = _builds.value.get(id);
  if (!b?.downloaded?.snapshot) return;
  history.snapshot("build", id, "revert", "Revert to downloaded", b);
  const restored = storage.revertToDownloaded(b) as Build;
  _builds.value.set(id, restored);
  markDirty(id);
}

/** `buildEditor.ts`'s `setChoice` for a build that need not be the active one -- used by the
 *  game-import report's "map to an item" action, which can patch a build the user isn't
 *  currently looking at (`importBuilds` only selects the last of several imported builds).
 *  No-ops if the build was since deleted (`deleteBuild` removes it from `_builds` immediately,
 *  not a soft delete). */
export function setChoiceFor(
  id: string,
  slotId: string,
  itemId: string,
  label: string,
) {
  const b = _builds.value.get(id);
  if (!b) return;
  history.snapshot("build", id, `choice:${slotId}`, label, b);
  b.choices[slotId] = itemId;
  markDirty(id);
}

/** Count of custom entries in `build.catalog` that overlap with ids enabled layers define. */
export function overlayOverlapCount(
  build: Build,
  overlays: import("../types").CatalogOverlay[],
): number {
  if (!build.catalog) return 0;
  const ids = new Set<string>();
  for (const overlay of overlays) {
    if (!overlay) continue;
    for (const key of Object.keys(overlay.items ?? {})) ids.add(key);
    for (const key of Object.keys(overlay.bonuses ?? {})) ids.add(key);
  }
  let count = 0;
  for (const key of Object.keys(build.catalog.items ?? {})) {
    if (ids.has(key)) count++;
  }
  for (const key of Object.keys(build.catalog.bonuses ?? {})) {
    if (ids.has(key)) count++;
  }
  return count;
}

export function importBuilds(
  newBuilds: Build[],
  stale: boolean,
  overlays?: import("../types").CatalogOverlay[],
) {
  for (const b of newBuilds) {
    _builds.value.set(b.id, b);
    folders.appendBuild(b.id);
    markDirty(b.id);
  }
  if (newBuilds.length) {
    selection.selectBuild(newBuilds[newBuilds.length - 1].id);
  }
  const parts: string[] = [];
  if (newBuilds.length === 1) {
    parts.push(`Imported "${newBuilds[0].name}"`);
  } else {
    parts.push(`Imported ${newBuilds.length} builds`);
  }
  if (stale)
    parts.push(
      "made against an older item catalogue; some items may no longer resolve",
    );
  if (overlays && overlays.length > 0) {
    for (const b of newBuilds) {
      const cnt = overlayOverlapCount(b, overlays);
      if (cnt > 0) {
        parts.push(
          `${cnt} custom entr${cnt === 1 ? "y" : "ies"} came with this build and override your layers for those items.`,
        );
        break; // one notice per import, not per build
      }
    }
  }
  showNotice(parts.join(". "));
}

/** Writes one imported build into the pool. `replacing` takes over the row (and folder) of the
 *  build whose id it carries, which goes to the trash; anything else is appended.
 *  `importFile.ts` decides which of the two an entry is. */
export function upsertImported(build: Build, replacing: boolean) {
  const existing = _builds.value.get(build.id);
  if (replacing && existing) trash._add("build", existing);
  else if (!existing) folders.appendBuild(build.id);
  _builds.value.set(build.id, build);
  markDirty(build.id);
}

/** Drops the placeholder build the landing screen keeps alive (see `build`, and the watcher
 *  at the foot of this file), so builds arriving from a file do not land beside an empty
 *  "Build 1" nobody asked for. No-op once anything has been committed: the landing screen
 *  standing is what says the pool holds nothing but the placeholder. */
export function discardPlaceholder() {
  if (!landing.showing.value) return;
  for (const id of [..._builds.value.keys()]) {
    clearDirty(id);
    _builds.value.delete(id);
    folders.removeBuild(id);
  }
}

/** Selects an imported build, once the whole file has been written. */
export function selectImported(id: string) {
  if (_builds.value.has(id)) selection.selectBuild(id);
}

export function downloadBuild(id: string) {
  const b = _builds.value.get(id);
  if (!b) return;
  const json = storage.toBuildJson(b, engineDb.value);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${b.name.replace(/[^\w.-]+/g, "-") || "build"}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

// --- bootstrap --------------------------------------------------------------------------

export function _init(buildsMap: Map<string, Build>, order: string[]) {
  _builds.value = buildsMap;
  buildOrder.value = order;
}

export function _setLoading(value: boolean) {
  _loading.value = value;
}

// --- persistence (incremental - only dirty ids are written) -----------------------------

const _dirtyIds = new Set<string>();

async function flushSave() {
  const ids = [..._dirtyIds];
  _dirtyIds.clear();
  for (const id of ids) {
    const b = _builds.value.get(id);
    if (b) {
      try {
        await storage.putBuild(b);
      } catch {
        flagStorageFailed(
          "Could not save to storage - export your build to keep it.",
        );
      }
    }
  }
}

const flushSaveDebounced = useDebounceFn(flushSave, SAVE_DEBOUNCE_MS);

function markDirty(id: string) {
  if (_loading.value) return;
  if (id === _placeholderId) _placeholderId = null;
  _dirtyIds.add(id);
  flushSaveDebounced();
}

function clearDirty(id: string) {
  _dirtyIds.delete(id);
}

// Deep-watch the active build so buildEditor.ts content edits (which mutate build.value in
// place) trigger persistence of just that build's record. Only edits: a swap to a different
// build is either one already stored or a placeholder nobody has asked for yet, and writing
// that would turn "deleted my last build" into stored content. The mutations that mint real
// builds all mark their own dirt. Never while the landing screen is up either, for the same
// reason -- nothing behind it has been asked for.
watch(
  () => build.value,
  (b, prev) => {
    if (b && b.id === prev?.id && !_loading.value && !landing.showing.value)
      markDirty(b.id);
  },
  { deep: true },
);
