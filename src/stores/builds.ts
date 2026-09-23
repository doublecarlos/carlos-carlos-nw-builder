// The pool of builds: id→Build map, loading, selectors, and every mutation that
// creates/destroys them. Where each one sits in the sidebar -- top level or inside a folder --
// is folders.ts's business, which this file delegates every ordering call to. Build content
// edits live in buildEditor.ts.
//
// Creating, duplicating, deleting and moving builds each record one step on the nav undo
// stack (`navHistory.ts`). A build leaving the pool always goes through the trash, so undoing
// a create and undoing a delete are the same two primitives run in opposite directions:
// `trashBuild` and `restoreBuild`. Neither records anything.
import { computed, ref, watch } from "vue";
import { useDebounceFn } from "@vueuse/core";
import { onPageHide } from "../lib/page-lifecycle";
import * as storage from "../storage/storage";
import * as history from "./history";
import * as landing from "./landing";
import * as layers from "./layers";
import * as navHistory from "./navHistory";
import type { NavStepOutcome } from "./navHistory";
import * as trash from "./trash";
import * as selection from "./selection";
import * as folders from "./folders";
import type { BuildPlacement } from "./folders";
import { buildOrder } from "./meta";
import { flagStorageFailed, showNotice, showUndoNotice } from "./notice";
import { db as engineDb } from "./resolved";
import {
  unpackCatalog,
  unpackNotice,
  type UnpackedCatalog,
} from "./buildCatalog";
import type { Build, BuildNavEntry, BuildOption } from "../types";

const SAVE_DEBOUNCE_MS = 250;

const _builds = ref<Map<string, Build>>(new Map());
const _loading = ref(true);

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

/** The selected build, else the first one. Null only when there are no builds. */
export const build = computed<Build | null>(() => {
  const sel = selection.selection.value;
  if (sel?.kind === "build" && _builds.value.has(sel.id)) {
    return _builds.value.get(sel.id)!;
  }
  const first = folders.orderedBuildIds.value[0];
  return first ? _builds.value.get(first)! : null;
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

/** Builds as picker options, each tagged with the folder holding it. Every surface listing
 *  builds outside the sidebar goes through this, so the grouping that tells two same-named
 *  builds apart travels with them. `list` is expected in sidebar order, which `builds` already
 *  is -- that is what puts each folder's builds together for the picker to head them. */
export function toOptions(list: Build[]): BuildOption[] {
  return list.map((b) => ({
    value: b.id,
    label: b.name,
    folder: folders.folderOf(b.id)?.name,
  }));
}

export const otherBuilds = computed(() => {
  const active = build.value;
  return toOptions(builds.value.filter((b) => !active || b.id !== active.id));
});

// --- mutations --------------------------------------------------------------------------

export function replaceActive(newBuild: Build) {
  _builds.value.set(newBuild.id, newBuild);
  if (!folders.orderedBuildIds.value.includes(newBuild.id))
    folders.appendBuild(newBuild.id);
  markDirty(newBuild.id);
  selection.selectBuild(newBuild.id);
}

/** Puts a build into the pool at `placement`. */
function addBuild(b: Build, placement: BuildPlacement) {
  _builds.value.set(b.id, b);
  folders.putBuild(b.id, placement);
  markDirty(b.id);
}

/** Moves a build to the trash. Returns the placement it had, or null when there is no such
 *  build. Selection moves on to the first build when the trashed one was selected, or is
 *  cleared when none is left. */
function trashBuild(id: string): BuildPlacement | null {
  const b = _builds.value.get(id);
  const placement = folders.placementOf(id);
  if (!b || !placement) return null;

  clearDirty(id);
  _builds.value.delete(id);
  folders.removeBuild(id);
  storage.deleteBuildRecord(id).catch(() => {});

  trash._add("build", b);

  // Deleting the last build leaves the builder up with no builds, rather than the landing
  // screen: the build is sitting in the trash, and the landing would hide the nav it is
  // restored from.
  if (
    selection.selection.value?.kind === "build" &&
    selection.selection.value.id === id
  ) {
    const next = folders.orderedBuildIds.value[0];
    if (next) selection.selectBuild(next);
    else selection.clearSelection();
  }
  return placement;
}

/** Takes a build back out of the trash to `placement`. False when nothing is left to restore. */
function restoreBuild(id: string, placement: BuildPlacement): boolean {
  const item = trash.takeById("build", id);
  if (!item) return false;
  addBuild(item, placement);
  return true;
}

/** The nav step primitives. A trashed row is gone, so the row to focus after trashing is
 *  whatever build the selection landed on. */
function trashStep(id: string): NavStepOutcome {
  if (!trashBuild(id)) return false;
  const sel = selection.selection.value;
  return { focusId: sel?.kind === "build" ? sel.id : null };
}

function restoreStep(id: string, placement: BuildPlacement): NavStepOutcome {
  if (!restoreBuild(id, placement)) return false;
  selection.selectBuild(id);
  return { focusId: id };
}

/** Records a build that `addBuild` just put in the pool: undoing sends it to the trash, the
 *  same way a delete does, so nothing the user typed into it is lost. */
function recordAdded(label: string, id: string) {
  const placement = folders.placementOf(id)!;
  navHistory.record({
    label,
    undo: () => trashStep(id),
    redo: () => restoreStep(id, placement),
  });
}

export function createBuild(folderId: string | null = null) {
  const b = storage.defaultBuild(
    `Build ${_builds.value.size + 1}`,
    engineDb.value,
  );
  addBuild(b, { folderId, index: Number.MAX_SAFE_INTEGER });
  selection.selectBuild(b.id);
  showNotice(`Created “${b.name}”`);
  recordAdded(`create build "${b.name}"`, b.id);
}

/** The landing screen's "New build": the first build, not a step to undo or announce. */
export function startBuild() {
  const b = storage.defaultBuild("Build 1", engineDb.value);
  addBuild(b, { folderId: null, index: Number.MAX_SAFE_INTEGER });
  selection.selectBuild(b.id);
}

export function duplicateBuild() {
  const source = build.value;
  if (!source) return;
  const copy = storage.duplicate(source);
  addBuild(copy, folders.placementAfter(source.id));
  selection.selectBuild(copy.id);
  showNotice(`Duplicated as “${copy.name}”`);
  recordAdded(`duplicate build "${source.name}"`, copy.id);
}

export function deleteBuild(id: string) {
  const name = _builds.value.get(id)?.name;
  const placement = trashBuild(id);
  if (!placement) return;
  showNotice(`Deleted "${name}"`);
  navHistory.record({
    label: `delete build "${name}"`,
    undo: () => restoreStep(id, placement),
    redo: () => trashStep(id),
  });
}

/** Deletes a folder and every build in it as one step: the builds go to the trash, and the
 *  folder itself goes the way `folders.deleteFolder` takes it. Undo recreates the folder
 *  and puts back whichever of its builds the trash still holds. */
export function deleteFolderWithBuilds(id: string) {
  const folder = folders.byId(id);
  if (!folder) return;
  const ids = [...folder.builds];
  for (const buildId of ids) trashBuild(buildId);
  const removed = folders.removeFolder(id)!;
  showNotice(`Deleted folder “${folder.name}” and its builds`);
  navHistory.record({
    label: `delete folder "${folder.name}"`,
    undo: () => {
      folders.addFolder(removed.folder, removed.index);
      for (const buildId of ids)
        restoreBuild(buildId, { folderId: id, index: Number.MAX_SAFE_INTEGER });
      return { focusId: id };
    },
    redo: () => {
      if (!folders.byId(id)) return false;
      for (const buildId of ids) trashBuild(buildId);
      folders.removeFolder(id);
      return { focusId: null };
    },
  });
}

/** Renames a build in place. Records nothing: `buildEditor.renameBuild` is the recorded
 *  operation, and this is what its undo and redo run. */
export function setName(id: string, name: string): NavStepOutcome {
  const b = _builds.value.get(id);
  if (!b) return false;
  b.name = name;
  markDirty(id);
  selection.selectBuild(id);
  return { focusId: id };
}

/** Raises the landing screen again if emptying the trash left the app with nothing at all:
 *  no builds, no layers, and nothing else to restore. Lives here rather than in trash.ts,
 *  which builds and layers both import. */
export function showLandingIfEmptied() {
  if (builds.value.length > 0) return;
  if (layers.layers.value.length > 0) return;
  if (trash.trashed.value.length > 0) return;
  landing.show();
}

/** Moves a build to `toIndex` inside `folderId` (the top level when null, the default).
 *  `toIndex` is relative to the target list as it stands now, before `id` is removed --
 *  callers (the delta-based `moveBuild` below, and drag-and-drop's drop-index math) both
 *  naturally produce indexes in those terms. See `folders.placeBuild`, which records the
 *  step for both of these. */
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
  showUndoNotice(`Reverted “${b.name}” to the last downloaded copy`, () =>
    undoFor(id),
  );
}

/** Undo on one build's own stack whether or not it is selected, which is what an undo notice
 *  needs. `history.undo` selects the build, so the restore lands where the user is looking. */
export function undoFor(id: string) {
  const b = _builds.value.get(id);
  if (!b) return;
  const json = history.undo("build", id, b);
  if (json != null) replaceActive(JSON.parse(json) as Build);
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

export function importBuilds(newBuilds: Build[], stale: boolean) {
  const unpacked: UnpackedCatalog[] = [];
  for (const b of newBuilds) {
    const result = unpackCatalog(b);
    if (result) unpacked.push(result);
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
      "made against an older item catalog; some items may no longer resolve",
    );
  // One notice per import, not per build.
  const landed = unpackNotice(unpacked);
  if (landed) parts.push(landed);
  showNotice(parts.join(". "));
}

/** Writes one imported build into the pool. `replacing` takes over the row (and folder) of the
 *  build whose id it carries, which goes to the trash; anything else is appended.
 *  `importFile.ts` decides which of the two an entry is. Returns where the build's embedded
 *  catalog landed, for the caller's own notice. */
export function upsertImported(
  build: Build,
  replacing: boolean,
): UnpackedCatalog | null {
  const unpacked = unpackCatalog(build);
  const existing = _builds.value.get(build.id);
  if (replacing && existing) trash._add("build", existing);
  else if (!existing) folders.appendBuild(build.id);
  _builds.value.set(build.id, build);
  markDirty(build.id);
  return unpacked;
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

/** Lifts the embedded catalog off every hydrated build that still carries one, into the same
 *  layer an import would produce. Stored builds predating that unpacking keep resolving the
 *  way they did, with their custom entries now on show. Runs after `_setLoading(false)`, so
 *  the stripped build is written back and the migration happens once. */
export function _unpackStoredCatalogs() {
  for (const b of _builds.value.values()) {
    if (!b.catalog) continue;
    unpackCatalog(b);
    markDirty(b.id);
  }
}

// --- persistence (incremental - only dirty ids are written) -----------------------------

const _dirtyIds = new Set<string>();

// Starts every write before its first await, so a flush on page hide queues them all.
async function flushSave() {
  const ids = [..._dirtyIds];
  _dirtyIds.clear();
  await Promise.all(
    ids.map(async (id) => {
      const b = _builds.value.get(id);
      if (!b) return;
      try {
        await storage.putBuild(b);
      } catch {
        flagStorageFailed(
          "Could not save to storage; export your build to keep it.",
        );
      }
    }),
  );
}

const flushSaveDebounced = useDebounceFn(flushSave, SAVE_DEBOUNCE_MS);
// A write still waiting on the debounce would be lost if the page goes away first.
onPageHide(() => void flushSave());

function markDirty(id: string) {
  if (_loading.value) return;
  _dirtyIds.add(id);
  flushSaveDebounced();
}

function clearDirty(id: string) {
  _dirtyIds.delete(id);
}

// Deep-watch the active build so buildEditor.ts content edits (which mutate build.value in
// place) trigger persistence of just that build's record. Only edits: a swap to a different
// build is already stored, and the mutations that mint builds mark their own dirt.
watch(
  () => build.value,
  (b, prev) => {
    if (b && b.id === prev?.id && !_loading.value) markDirty(b.id);
  },
  { deep: true },
);
