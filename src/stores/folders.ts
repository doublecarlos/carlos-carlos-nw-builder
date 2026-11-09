// Build folders: the nested grouping under the sidebar's Builds heading.
//
// Two pieces of `AppMeta` describe the whole tree, and this module is their only writer:
// `buildOrder` is the top-level row order (build ids and folder ids interleaved) and
// `folders` is the folder set, each carrying its own ordered `items` of the same mix. An id
// lives in exactly one of those lists, folders never contain themselves, and nesting stops at
// `MAX_FOLDER_DEPTH`. `storage.loadAll` repairs anything that says otherwise on load (see
// lib/folder-tree.ts), so every reader here can assume it.
//
// Placement is one primitive, `place`, that builds and folders both funnel through
// (drag-and-drop, the Move to menu, Ctrl+↑/↓): "take this row out of wherever it is and splice
// it in at (container, index)". `canPlace` is the one rule on where a row may go.
//
// The user-facing mutations (`placeRow`, `moveRow`, `createFolder`, `renameFolder`,
// `deleteFolder`) each record one step on the nav undo stack. The primitives they and their
// undo closures share (`putRow`, `addFolder`, `removeFolder`, the tree pair) record nothing,
// which is also what import and `builds.ts` go through.
import { computed } from "vue";
import { reorderIndex, stepGap } from "../composables/useDragAndDrop";
import { MAX_FOLDER_DEPTH } from "../lib/folder-tree";
import { newId } from "../storage/storage";
import { buildOrder, folders, persistMeta } from "./meta";
import * as navHistory from "./navHistory";
import type { NavStepOutcome } from "./navHistory";
import { showNotice } from "./notice";
import * as selection from "./selection";
import type { BuildFolder } from "../types";

export { folders, MAX_FOLDER_DEPTH };

const PATH_SEPARATOR = " / ";

// --- reads ------------------------------------------------------------------------------

export function byId(id: string): BuildFolder | undefined {
  return folders.value.find((f) => f.id === id);
}

/** The ids directly inside `parentId`, or the top-level rows when null. */
export function itemsOf(parentId: string | null): string[] {
  if (parentId === null) return buildOrder.value;
  return byId(parentId)?.items ?? [];
}

const parents = computed(() => {
  const map = new Map<string, BuildFolder>();
  for (const folder of folders.value)
    for (const id of folder.items) map.set(id, folder);
  return map;
});

/** The folder directly holding a build or folder, or undefined at the top level. */
export function parentOf(id: string): BuildFolder | undefined {
  return parents.value.get(id);
}

/** The folders from the top level down to the one holding `id`. */
export function ancestorsOf(id: string): BuildFolder[] {
  const out: BuildFolder[] = [];
  for (let at = parentOf(id); at; at = parentOf(at.id)) out.unshift(at);
  return out;
}

/** The folder names leading to `id`, for surfaces that list builds outside the sidebar.
 *  Undefined for a row at the top level. */
export function pathOf(id: string): string | undefined {
  const names = ancestorsOf(id).map((f) => f.name);
  return names.length ? names.join(PATH_SEPARATOR) : undefined;
}

/** How deep a folder sits: 1 at the top level. */
export function depthOf(folderId: string): number {
  return ancestorsOf(folderId).length + 1;
}

/** How many folder levels a folder spans, counting itself. */
function heightOf(folderId: string): number {
  const folder = byId(folderId);
  if (!folder) return 0;
  let below = 0;
  for (const id of folder.items)
    if (byId(id)) below = Math.max(below, heightOf(id));
  return below + 1;
}

/** True when `id` is `ancestorId` itself or sits anywhere inside it. */
export function isWithin(id: string, ancestorId: string): boolean {
  if (id === ancestorId) return true;
  return ancestorsOf(id).some((f) => f.id === ancestorId);
}

/** Whether a row may move into `parentId` (the top level when null). A build may go into
 *  any folder. A folder may not go into itself or its own subfolders, and may not take its
 *  subtree past `MAX_FOLDER_DEPTH`. */
export function canPlace(id: string, parentId: string | null): boolean {
  if (parentId === null) return true;
  if (!byId(parentId)) return false;
  if (!byId(id)) return true;
  return (
    !isWithin(parentId, id) &&
    depthOf(parentId) + heightOf(id) <= MAX_FOLDER_DEPTH
  );
}

/** Whether a new folder fits inside `parentId`. */
export function canNestIn(parentId: string): boolean {
  return !!byId(parentId) && depthOf(parentId) < MAX_FOLDER_DEPTH;
}

/** The build ids anywhere inside `folderId`, in sidebar order. */
export function buildsWithin(folderId: string): string[] {
  return (byId(folderId)?.items ?? []).flatMap((id) =>
    byId(id) ? buildsWithin(id) : [id],
  );
}

/** Every build id in sidebar order, each folder expanded in place. The flat build list the
 *  rest of the app reads is built from this. */
export const orderedBuildIds = computed(() =>
  buildOrder.value.flatMap((id) => (byId(id) ? buildsWithin(id) : [id])),
);

/** Every folder in sidebar order with its depth, for menus that list them as targets. */
export const folderTree = computed(() => {
  const out: { folder: BuildFolder; depth: number }[] = [];
  const walk = (list: string[], depth: number) => {
    for (const id of list) {
      const folder = byId(id);
      if (!folder) continue;
      out.push({ folder, depth });
      walk(folder.items, depth + 1);
    }
  };
  walk(buildOrder.value, 1);
  return out;
});

/** Folders in sidebar order. */
export const orderedFolders = computed(() =>
  folderTree.value.map((entry) => entry.folder),
);

/** Where a row sits within its own list, for the Ctrl+↑/↓ shortcut. A nudge stays inside
 *  the row's current container: the Move to menu is the keyboard way to change containers. */
export function rowPosition(
  id: string,
): { index: number; length: number } | null {
  const list = itemsOf(parentOf(id)?.id ?? null);
  const index = list.indexOf(id);
  return index === -1 ? null : { index, length: list.length };
}

/** A row's absolute spot in the tree: the folder holding it (null at the top level) and its
 *  index in that container. What a nav undo step captures to put a row back. */
export interface RowPlacement {
  folderId: string | null;
  index: number;
}

export function placementOf(id: string): RowPlacement | null {
  const at = rowPosition(id);
  return at ? { folderId: parentOf(id)?.id ?? null, index: at.index } : null;
}

/** A folder's own record and spot, captured before it is removed so undo can put it back. */
export interface RemovedFolder {
  folder: BuildFolder;
  placement: RowPlacement;
}

/** A whole folder subtree, records outermost first, captured for undo. */
export interface RemovedTree {
  folders: BuildFolder[];
  placement: RowPlacement;
}

// --- primitives (record nothing) ----------------------------------------------------------

/** Takes `id` out of wherever it is and inserts it at `placement`, an absolute index in the
 *  target container. A folder that no longer exists falls back to the end of the top level,
 *  so a restored row is never left out of the tree. What undo steps, create and duplicate
 *  place with. */
export function putRow(id: string, placement: RowPlacement) {
  detach(id);
  insert(id, placement);
  persistMeta();
}

function insert(id: string, placement: RowPlacement) {
  const target = placement.folderId === null ? null : byId(placement.folderId);
  const list = target ? target.items : buildOrder.value;
  const index =
    target || placement.folderId === null ? placement.index : list.length;
  list.splice(Math.max(0, Math.min(list.length, index)), 0, id);
}

/** Inserts a folder at `placement`, claiming every id listed in `folder.items` from wherever
 *  it currently sits. Undo steps put deleted folders back with it. */
export function addFolder(
  folder: BuildFolder,
  placement: RowPlacement = { folderId: null, index: buildOrder.value.length },
) {
  for (const id of folder.items) detach(id);
  folders.value = [...folders.value, folder];
  insert(folder.id, placement);
  persistMeta();
}

/** Adds a set of folders that only reference builds and each other, as import produces.
 *  Those no other folder in the set holds become rows at the end of the top level. */
export function addFolders(list: BuildFolder[]) {
  for (const folder of list) for (const id of folder.items) detach(id);
  folders.value = [...folders.value, ...list];
  const nested = new Set(list.flatMap((f) => f.items));
  for (const folder of list)
    if (!nested.has(folder.id)) buildOrder.value.push(folder.id);
  persistMeta();
}

/** Removes the folder but never its contents: whatever it held takes its place in its
 *  parent, so removing a folder is only ever about the grouping. Returns what was removed,
 *  for `addFolder` to put back. */
export function removeFolder(id: string): RemovedFolder | null {
  const folder = byId(id);
  const placement = placementOf(id);
  if (!folder || !placement) return null;
  itemsOf(placement.folderId).splice(placement.index, 1, ...folder.items);
  folders.value = folders.value.filter((f) => f.id !== id);
  persistMeta();
  return { folder: { ...folder, items: [...folder.items] }, placement };
}

/** Removes a folder together with every subfolder inside it. Whatever builds are still
 *  inside go with the records, so callers trash those first. */
export function removeFolderTree(id: string): RemovedTree | null {
  const placement = placementOf(id);
  if (!byId(id) || !placement) return null;
  const removed = orderedFolders.value.filter((f) => isWithin(f.id, id));
  const ids = new Set(removed.map((f) => f.id));
  itemsOf(placement.folderId).splice(placement.index, 1);
  folders.value = folders.value.filter((f) => !ids.has(f.id));
  persistMeta();
  return {
    folders: removed.map((f) => ({ ...f, items: [...f.items] })),
    placement,
  };
}

/** Puts back what `removeFolderTree` took. */
export function addFolderTree(tree: RemovedTree) {
  const [root] = tree.folders;
  if (!root) return;
  folders.value = [...folders.value, ...tree.folders];
  insert(root.id, tree.placement);
  persistMeta();
}

/** Appends a freshly created/imported build to the top level. */
export function appendBuild(buildId: string) {
  buildOrder.value.push(buildId);
  persistMeta();
}

/** The spot right behind an existing row, inside whatever container that one lives in, so a
 *  duplicate lands next to its original. The top level's end when the anchor is gone. */
export function placementAfter(anchorId: string): RowPlacement {
  const at = placementOf(anchorId);
  return at
    ? { folderId: at.folderId, index: at.index + 1 }
    : { folderId: null, index: buildOrder.value.length };
}

/** Forgets a build entirely, called when it is deleted, so no folder keeps a dangling id. */
export function removeBuild(buildId: string) {
  detach(buildId);
  persistMeta();
}

function detach(id: string) {
  const folder = parentOf(id);
  if (folder) {
    folder.items = folder.items.filter((item) => item !== id);
    return;
  }
  const at = buildOrder.value.indexOf(id);
  if (at !== -1) buildOrder.value.splice(at, 1);
}

// --- recorded mutations -------------------------------------------------------------------

function addFolderStep(
  folder: BuildFolder,
  placement: RowPlacement,
): NavStepOutcome {
  addFolder(folder, placement);
  return { focusId: folder.id };
}

function removeFolderStep(id: string): NavStepOutcome {
  return removeFolder(id) ? { focusId: null } : false;
}

/** A new empty folder at the end of `parentId` (the top level when null). A parent already
 *  at the depth limit takes no more folders, so the new one lands at the top level. */
export function createFolder(
  name = `Folder ${folders.value.length + 1}`,
  collapsed = false,
  parentId: string | null = null,
): string {
  const folder: BuildFolder = { id: newId("f"), name, collapsed, items: [] };
  const parent = parentId !== null && canNestIn(parentId) ? parentId : null;
  const placement = { folderId: parent, index: itemsOf(parent).length };
  expand(parent);
  addFolder(folder, placement);
  navHistory.record({
    label: `create folder "${name}"`,
    undo: () => removeFolderStep(folder.id),
    redo: () => addFolderStep({ ...folder, items: [] }, placement),
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
  const parent = parentOf(id);
  const removed = removeFolder(id);
  if (!removed) return;
  const { folder, placement } = removed;
  const where = parent ? `into “${parent.name}”` : "to the top level";
  showNotice(
    folder.items.length
      ? `Deleted folder “${folder.name}” - its contents moved ${where}`
      : `Deleted folder “${folder.name}”`,
  );
  navHistory.record({
    label: `delete folder "${folder.name}"`,
    undo: () => addFolderStep(folder, placement),
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

/** Opens a folder and every folder around it, so a row just moved in is never apparently
 *  swallowed. Leaves the write to the caller. */
function expand(folderId: string | null) {
  if (folderId === null) return;
  for (const folder of [...ancestorsOf(folderId), byId(folderId)])
    if (folder) folder.collapsed = false;
}

/**
 * Puts a build or folder at `index` inside `folderId` (or at the top level when null),
 * taking it out of whatever container currently holds it. A move `canPlace` refuses does
 * nothing.
 *
 * `index` is relative to the target container as it stands now, before the row is removed
 * from wherever it was, which is what both drag-and-drop's drop-index math and the
 * delta-based `moveRow` naturally produce. Only a move *within* one container needs the
 * removal compensated for (`reorderIndex`); a move between containers splices into a list the
 * row was never in.
 */
export function placeRow(
  id: string,
  folderId: string | null,
  index = Number.MAX_SAFE_INTEGER,
) {
  const before = placementOf(id);
  if (!before || !place(id, folderId, index)) return;
  const after = placementOf(id)!;
  navHistory.record({
    label: byId(id) ? "move folder" : "move build",
    undo: () => putRowStep(id, before),
    redo: () => putRowStep(id, after),
  });
}

/** Nudges a row one step up/down inside its own container. */
export function moveRow(id: string, delta: number) {
  const at = rowPosition(id);
  if (!at) return;
  placeRow(id, parentOf(id)?.id ?? null, stepGap(at.index, delta));
}

/** `placeRow` without the recording. True when the row actually moved. */
function place(id: string, folderId: string | null, index: number) {
  if (!canPlace(id, folderId)) return false;
  const list = itemsOf(folderId);
  const from = parentOf(id)?.id ?? null;
  if (from === folderId) {
    const at = list.indexOf(id);
    if (at === -1) return false;
    const insertAt = reorderIndex(
      at,
      Math.max(0, Math.min(list.length, index)),
    );
    if (insertAt === at) return false;
    list.splice(at, 1);
    list.splice(insertAt, 0, id);
  } else {
    detach(id);
    list.splice(Math.max(0, Math.min(list.length, index)), 0, id);
    expand(folderId);
  }
  persistMeta();
  return true;
}

function putRowStep(id: string, placement: RowPlacement): NavStepOutcome {
  if (!placementOf(id)) return false;
  putRow(id, placement);
  if (!byId(id)) selection.selectBuild(id);
  return { focusId: id };
}

// --- bootstrap --------------------------------------------------------------------------

export function _init(loaded: BuildFolder[]) {
  folders.value = loaded;
}
