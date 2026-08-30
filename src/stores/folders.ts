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
import { computed } from "vue";
import { reorderIndex } from "../composables/useDragAndDrop";
import { newId } from "../storage/storage";
import { buildOrder, folders, persistMeta } from "./meta";
import { showNotice } from "./notice";
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

// --- mutations --------------------------------------------------------------------------

export function createFolder(
  name = `Folder ${folders.value.length + 1}`,
  collapsed = false,
): string {
  const folder: BuildFolder = { id: newId("f"), name, collapsed, builds: [] };
  folders.value = [...folders.value, folder];
  buildOrder.value.push(folder.id);
  persistMeta();
  return folder.id;
}

export function renameFolder(id: string, name: string) {
  const folder = byId(id);
  if (!folder || !name.trim()) return;
  folder.name = name.trim();
  persistMeta();
}

/** Removes the folder but never its contents: the builds it held take its place at the top
 *  level, so "delete folder" is only ever about the grouping. Deleting the builds themselves
 *  stays each build row's own two-step delete (which routes them through the trash). */
export function deleteFolder(id: string) {
  const folder = byId(id);
  if (!folder) return;
  const at = buildOrder.value.indexOf(id);
  if (at !== -1) buildOrder.value.splice(at, 1, ...folder.builds);
  folders.value = folders.value.filter((f) => f.id !== id);
  persistMeta();
  showNotice(
    folder.builds.length
      ? `Deleted folder “${folder.name}” - its builds moved to the top level`
      : `Deleted folder “${folder.name}”`,
  );
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
  buildOrder.value.splice(from, 1);
  buildOrder.value.splice(insertAt, 0, id);
  persistMeta();
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
  const target = folderId === null ? null : byId(folderId);
  if (folderId !== null && !target) return;
  const from = folderOf(buildId);
  if ((from?.id ?? null) === (target?.id ?? null)) {
    const list = target ? target.builds : buildOrder.value;
    const at = list.indexOf(buildId);
    if (at === -1) return;
    const insertAt = reorderIndex(
      at,
      Math.max(0, Math.min(list.length, index)),
    );
    if (insertAt === at) return;
    list.splice(at, 1);
    list.splice(insertAt, 0, buildId);
  } else {
    detach(buildId);
    const list = target ? target.builds : buildOrder.value;
    list.splice(Math.max(0, Math.min(list.length, index)), 0, buildId);
    if (target?.collapsed) target.collapsed = false;
  }
  persistMeta();
}

/** Appends a freshly created/imported build to the top level. */
export function appendBuild(buildId: string) {
  buildOrder.value.push(buildId);
  persistMeta();
}

/** Drops a new build in right behind an existing one, inside whatever container that one
 *  lives in -- so duplicating a build inside a folder keeps the copy next to its original. */
export function insertBuildAfter(anchorBuildId: string, buildId: string) {
  const list = containerOf(anchorBuildId);
  const at = list.indexOf(anchorBuildId);
  if (at === -1) {
    appendBuild(buildId);
    return;
  }
  list.splice(at + 1, 0, buildId);
  persistMeta();
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
