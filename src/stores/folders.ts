// Build folders: the one-level-deep grouping under the sidebar's Builds heading.
//
// Two pieces of `AppMeta` describe the whole tree, and this module is their only writer:
// `buildOrder` is the top-level row order (build ids and folder ids interleaved) and
// `folders` is the folder set, each carrying its own ordered `builds`. A build id lives in
// exactly one of those places, never both -- `storage.loadAll` repairs anything that says
// otherwise on load, so every reader here can assume it.
//
// Placement is one primitive, `placeBuild`, that every caller funnels through (drag-and-drop,
// the Move to menu, Ctrl+↑/↓, delete cleanup). Splitting it into move-in / move-out / reorder
// would triple the index bookkeeping for no gain: they are all "take this build out of
// wherever it is and splice it in at (container, index)".
//
// The user-facing mutations (`placeBuild`, `createFolder`, `renameFolder`, `deleteFolder`,
// `moveFolderTo`) each record one step on the nav undo stack. The primitives they and their
// undo closures share (`putBuild`, `addFolder`, `removeFolder`) record nothing, which is also
// what import goes through.
import { computed } from "vue";
import { reorderIndex } from "../composables/useDragAndDrop";
import { newId } from "../storage/storage";
import { buildOrder, folders, persistMeta } from "./meta";
import * as navHistory from "./navHistory";
import type { NavStepOutcome } from "./navHistory";
import { showNotice } from "./notice";
import * as selection from "./selection";
import type { BuildFolder } from "../types";

export { folders };

/** Top-level rows in order, resolved from `buildOrder`'s interleaved ids. */
export const entries = computed<
  ({ kind: "build"; id: string } | { kind: "folder"; folder: BuildFolder })[]
>(() =>
  buildOrder.value.map((id) => {
    const folder = byId(id);
    return folder
      ? ({ kind: "folder", folder } as const)
      : ({ kind: "build", id } as const);
  }),
);

/** Every build id in sidebar order -- top-level rows in order, each folder expanded in
 *  place. The flat build list the rest of the app reads is built from this. */
export const orderedBuildIds = computed(() =>
  entries.value.flatMap((entry) =>
    entry.kind === "folder" ? [...entry.folder.builds] : [entry.id],
  ),
);

/** Folders in sidebar order, for menus that list them as move targets. */
export const orderedFolders = computed(() =>
  entries.value.flatMap((entry) =>
    entry.kind === "folder" ? [entry.folder] : [],
  ),
);

export function byId(id: string): BuildFolder | undefined {
  return folders.value.find((f) => f.id === id);
}

/** The folder holding `buildId`, or undefined when it sits at the top level. */
export function folderOf(buildId: string): BuildFolder | undefined {
  return folders.value.find((f) => f.builds.includes(buildId));
}

/** The id list a nav row lives in: a folder's `builds`, or the top-level `buildOrder`. */
function containerOf(id: string): string[] {
  return folderOf(id)?.builds ?? buildOrder.value;
}

/** Where a nav row (build or folder) sits within its own list, for Move up/down affordances
 *  and the Ctrl+↑/↓ shortcut. Both stay inside the row's current container: a build at the
 *  top of a folder does not pop out of it, since the Move to menu is the explicit -- and
 *  keyboard-reachable -- way to change containers. */
export function rowPosition(
  id: string,
): { index: number; length: number } | null {
  const list = byId(id) ? buildOrder.value : containerOf(id);
  const index = list.indexOf(id);
  return index === -1 ? null : { index, length: list.length };
}

/** A build's absolute spot in the tree: the folder holding it (null at the top level) and
 *  its index in that container. What a nav undo step captures to put a build back. */
export interface BuildPlacement {
  folderId: string | null;
  index: number;
}

export function placementOf(buildId: string): BuildPlacement | null {
  const at = rowPosition(buildId);
  return at
    ? { folderId: folderOf(buildId)?.id ?? null, index: at.index }
    : null;
}

/** A folder's own row and contents, captured before it is removed so undo can put it back. */
export interface RemovedFolder {
  folder: BuildFolder;
  index: number;
}

// --- mutations --------------------------------------------------------------------------

/** Takes `buildId` out of wherever it is and inserts it at `placement`, an absolute index in
 *  the target container. A folder that no longer exists falls back to the end of the top
 *  level, so a restored build is never left out of the tree. Records nothing: this is what
 *  undo steps, create and duplicate place with. */
export function putBuild(buildId: string, placement: BuildPlacement) {
  detach(buildId);
  const target = placement.folderId === null ? null : byId(placement.folderId);
  const list = target ? target.builds : buildOrder.value;
  const index =
    target || placement.folderId === null ? placement.index : list.length;
  list.splice(Math.max(0, Math.min(list.length, index)), 0, buildId);
  persistMeta();
}

/** Inserts a folder as a top-level row at `index`, claiming every build listed in
 *  `folder.builds` from wherever it currently sits. Records nothing: import builds folders
 *  with it, and undo steps put deleted folders back with it. */
export function addFolder(
  folder: BuildFolder,
  index = buildOrder.value.length,
) {
  for (const buildId of folder.builds) detach(buildId);
  folders.value = [...folders.value, folder];
  buildOrder.value.splice(
    Math.max(0, Math.min(buildOrder.value.length, index)),
    0,
    folder.id,
  );
  persistMeta();
}

/** Removes the folder but never its contents: the builds it held take its place at the top
 *  level, so removing a folder is only ever about the grouping. Returns what was removed, for
 *  `addFolder` to put back. Records nothing. */
export function removeFolder(id: string): RemovedFolder | null {
  const folder = byId(id);
  if (!folder) return null;
  const index = buildOrder.value.indexOf(id);
  if (index !== -1) buildOrder.value.splice(index, 1, ...folder.builds);
  folders.value = folders.value.filter((f) => f.id !== id);
  persistMeta();
  return { folder: { ...folder, builds: [...folder.builds] }, index };
}

function addFolderStep(folder: BuildFolder, index: number): NavStepOutcome {
  addFolder(folder, index);
  return { focusId: folder.id };
}

function removeFolderStep(id: string): NavStepOutcome {
  return removeFolder(id) ? { focusId: null } : false;
}

export function createFolder(
  name = `Folder ${folders.value.length + 1}`,
  collapsed = false,
): string {
  const folder: BuildFolder = { id: newId("f"), name, collapsed, builds: [] };
  const index = buildOrder.value.length;
  addFolder(folder, index);
  navHistory.record({
    label: `create folder "${name}"`,
    undo: () => removeFolderStep(folder.id),
    redo: () => addFolderStep({ ...folder, builds: [] }, index),
  });
  return folder.id;
}

function setName(id: string, name: string): NavStepOutcome {
  const folder = byId(id);
  if (!folder) return false;
  folder.name = name;
  persistMeta();
  return { focusId: id };
}

export function renameFolder(id: string, name: string) {
  const folder = byId(id);
  const next = name.trim();
  if (!folder || !next || folder.name === next) return;
  const previous = folder.name;
  setName(id, next);
  navHistory.record({
    label: `rename folder → "${next}"`,
    undo: () => setName(id, previous),
    redo: () => setName(id, next),
  });
}

/** Deletes the grouping only, see `removeFolder`. Deleting the builds along with it is
 *  `builds.deleteFolderWithBuilds`, since the trash is that store's business. */
export function deleteFolder(id: string) {
  const removed = removeFolder(id);
  if (!removed) return;
  const { folder, index } = removed;
  showNotice(
    folder.builds.length
      ? `Deleted folder “${folder.name}” - its builds moved to the top level`
      : `Deleted folder “${folder.name}”`,
  );
  navHistory.record({
    label: `delete folder "${folder.name}"`,
    undo: () => addFolderStep(folder, index),
    redo: () => removeFolderStep(id),
  });
}

export function setCollapsed(id: string, collapsed: boolean) {
  const folder = byId(id);
  if (!folder || folder.collapsed === collapsed) return;
  folder.collapsed = collapsed;
  persistMeta();
}

export function toggleCollapsed(id: string) {
  const folder = byId(id);
  if (folder) setCollapsed(id, !folder.collapsed);
}

/** Puts a folder row at an absolute index among the top-level rows. */
function setFolderIndex(id: string, index: number): NavStepOutcome {
  const from = buildOrder.value.indexOf(id);
  if (from === -1) return false;
  buildOrder.value.splice(from, 1);
  buildOrder.value.splice(
    Math.max(0, Math.min(buildOrder.value.length, index)),
    0,
    id,
  );
  persistMeta();
  return { focusId: id };
}

/** Moves a folder among the top-level rows. `toIndex` is relative to `buildOrder` as it
 *  stands now, before the folder is spliced out -- the same convention `placeBuild` uses. */
export function moveFolderTo(id: string, toIndex: number) {
  if (!byId(id)) return;
  const from = buildOrder.value.indexOf(id);
  if (from === -1) return;
  const insertAt = reorderIndex(
    from,
    Math.max(0, Math.min(buildOrder.value.length, toIndex)),
  );
  if (insertAt === from) return;
  setFolderIndex(id, insertAt);
  navHistory.record({
    label: "move folder",
    undo: () => setFolderIndex(id, from),
    redo: () => setFolderIndex(id, insertAt),
  });
}

/** Nudges a folder one step up/down among the top-level rows. */
export function moveFolder(id: string, delta: number) {
  const at = rowPosition(id);
  if (!at) return;
  moveFolderTo(id, at.index + delta + (delta > 0 ? 1 : 0));
}

/**
 * Puts `buildId` at `index` inside `folderId` (or at the top level when null), taking it out
 * of whatever container currently holds it.
 *
 * `index` is relative to the target container as it stands now, before the build is removed
 * from wherever it was -- which is what both drag-and-drop's drop-index math and the
 * delta-based `moveBuild` naturally produce. Only a move *within* one container needs the
 * removal compensated for (`reorderIndex`); a move between containers splices into a list the
 * build was never in. A drop into a collapsed folder expands it, so the build is never
 * apparently swallowed.
 */
export function placeBuild(
  buildId: string,
  folderId: string | null,
  index = Number.MAX_SAFE_INTEGER,
) {
  const before = placementOf(buildId);
  if (!before || !place(buildId, folderId, index)) return;
  const after = placementOf(buildId)!;
  navHistory.record({
    label: "move build",
    undo: () => putBuildStep(buildId, before),
    redo: () => putBuildStep(buildId, after),
  });
}

/** `placeBuild` without the recording. True when the build actually moved. */
function place(buildId: string, folderId: string | null, index: number) {
  const target = folderId === null ? null : byId(folderId);
  if (folderId !== null && !target) return false;
  const from = folderOf(buildId);
  if ((from?.id ?? null) === (target?.id ?? null)) {
    const list = target ? target.builds : buildOrder.value;
    const at = list.indexOf(buildId);
    if (at === -1) return false;
    const insertAt = reorderIndex(
      at,
      Math.max(0, Math.min(list.length, index)),
    );
    if (insertAt === at) return false;
    list.splice(at, 1);
    list.splice(insertAt, 0, buildId);
  } else {
    detach(buildId);
    const list = target ? target.builds : buildOrder.value;
    list.splice(Math.max(0, Math.min(list.length, index)), 0, buildId);
    if (target?.collapsed) target.collapsed = false;
  }
  persistMeta();
  return true;
}

function putBuildStep(
  buildId: string,
  placement: BuildPlacement,
): NavStepOutcome {
  if (!placementOf(buildId)) return false;
  putBuild(buildId, placement);
  selection.selectBuild(buildId);
  return { focusId: buildId };
}

/** Appends a freshly created/imported build to the top level. */
export function appendBuild(buildId: string) {
  buildOrder.value.push(buildId);
  persistMeta();
}

/** The spot right behind an existing build, inside whatever container that one lives in, so
 *  a duplicate lands next to its original. The top level's end when the anchor is gone. */
export function placementAfter(anchorBuildId: string): BuildPlacement {
  const at = placementOf(anchorBuildId);
  return at
    ? { folderId: at.folderId, index: at.index + 1 }
    : { folderId: null, index: buildOrder.value.length };
}

/** Forgets a build entirely -- called when it is deleted, so no folder keeps a dangling id. */
export function removeBuild(buildId: string) {
  detach(buildId);
  persistMeta();
}

function detach(buildId: string) {
  const folder = folderOf(buildId);
  if (folder) {
    folder.builds = folder.builds.filter((id) => id !== buildId);
    return;
  }
  const at = buildOrder.value.indexOf(buildId);
  if (at !== -1) buildOrder.value.splice(at, 1);
}

// --- bootstrap --------------------------------------------------------------------------

export function _init(loaded: BuildFolder[]) {
  folders.value = loaded;
}
