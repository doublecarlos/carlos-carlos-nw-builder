<script setup lang="ts">
// Left sidebar: builds, customization layers, and recently deleted. Owns shared state
// (menus, rename, confirm) and delegates list rendering to NavBuilds / NavLayers / NavTrash.
import { ref } from "vue";
import { useEventListener, onClickOutside } from "@vueuse/core";
import NavBuilds from "./NavBuilds.vue";
import NavLayers from "./NavLayers.vue";
import NavTrash from "./NavTrash.vue";
import { useConfirm } from "../composables/useConfirm";
import * as builds from "../stores/builds";
import * as layers from "../stores/layers";
import * as selection from "../stores/selection";
import * as buildEditor from "../stores/buildEditor";
import * as trash from "../stores/trash";
import type { Build, TrashEntry } from "../types";

const CONFIRM_MS = 4000;

const root = ref<HTMLElement | null>(null);
const openMenu = ref<{ type: string; id: string } | null>(null);
const menuAnchor = ref<DOMRect | null>(null);
const renaming = ref<{ type: string; id: string } | null>(null);
const renameText = ref("");
const confirm_ = useConfirm(CONFIRM_MS);

const buildFileInput = ref<HTMLInputElement | null>(null);
const layerFileInput = ref<HTMLInputElement | null>(null);

const buildFilter = ref("");
const layerFilter = ref("");
const trashExpanded = ref(false);

// --- time-ago helper ------------------------------------------------------------------

function timeAgo(ms: number): string {
  const seconds = Math.floor((Date.now() - ms) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  const days = Math.floor(seconds / 86400);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

// --- selection helpers ----------------------------------------------------------------

// --- menus ---------------------------------------------------------------------------

function isMenuOpen(type: string, id: string) {
  return openMenu.value?.type === type && openMenu.value?.id === id;
}

function openMenuFor(type: string, id: string, event: MouseEvent) {
  if (isMenuOpen(type, id)) {
    openMenu.value = null;
    menuAnchor.value = null;
    return;
  }
  const el = event.currentTarget as HTMLElement;
  const rect = el.closest(".nav-row")!.getBoundingClientRect();
  menuAnchor.value = rect;
  openMenu.value = { type, id };
}

function closeMenu() {
  openMenu.value = null;
  menuAnchor.value = null;
}

// --- rename ---------------------------------------------------------------------------

function startRename(type: string, id: string, name: string) {
  closeMenu();
  renaming.value = { type, id };
  renameText.value = name;
}

function commitRename() {
  if (!renaming.value) return;
  const { type, id } = renaming.value;
  const name = renameText.value.trim();
  renaming.value = null;
  if (!name) return;
  if (type === "build") {
    selection.selectBuild(id);
    buildEditor.renameBuild(name);
  } else {
    layers.renameLayer(id, name);
  }
}

// --- two-step confirm (delegates to useConfirm composable) ---------------------------

function confirmLabel(type: string, id: string, action: string, label: string) {
  return confirm_.label(`${type}:${id}:${action}`, label);
}

function runConfirmed(
  type: string,
  id: string,
  action: string,
  run: () => void,
) {
  if (confirm_.run(`${type}:${id}:${action}`)) {
    run();
    closeMenu();
  }
}

// --- build actions --------------------------------------------------------------------

function duplicateCurrentBuild(id: string) {
  selection.selectBuild(id);
  builds.duplicateBuild();
}
function deleteBuildRow(id: string) {
  builds.deleteBuild(id);
  closeMenu();
}
function exportBuild(id: string) {
  builds.downloadBuild(id);
  closeMenu();
}
function resetBuild(id: string) {
  selection.selectBuild(id);
  buildEditor.resetAll();
  closeMenu();
}
async function moveBuildUp(id: string) {
  await builds.moveBuild(id, -1);
  closeMenu();
}
async function moveBuildDown(id: string) {
  await builds.moveBuild(id, 1);
  closeMenu();
}
function revertBuild(id: string) {
  builds.revertToDownloaded(id);
  closeMenu();
}

function isBuildRevertable(id: string): boolean {
  const b = builds.builds.value.find((bb) => bb.id === id);
  if (!b?.downloaded?.snapshot) return false;
  return !builds.isDownloaded(id);
}

function buildIndex(id: string) {
  return builds.builds.value.findIndex((b) => b.id === id);
}

// --- layer actions --------------------------------------------------------------------

function toggleLayerEnabled(id: string) {
  const layer = layers.layers.value.find((l) => l.id === id);
  if (layer) layers.setLayerEnabled(id, !layer.enabled);
}

async function moveLayerUp(id: string) {
  await layers.moveLayer(id, -1);
  closeMenu();
}
async function moveLayerDown(id: string) {
  await layers.moveLayer(id, 1);
  closeMenu();
}
function duplicateLayerRow(id: string) {
  layers.duplicateLayer(id);
  closeMenu();
}
function exportLayer(id: string) {
  layers.downloadLayer(id);
  closeMenu();
}
function deleteLayerRow(id: string) {
  layers.deleteLayer(id);
  closeMenu();
}
function revertLayer(id: string) {
  layers.revertToDownloaded(id);
  closeMenu();
}

function isLayerRevertable(id: string): boolean {
  const l = layers.layers.value.find((ll) => ll.id === id);
  if (!l?.downloaded?.snapshot) return false;
  const current = { ...l, downloaded: undefined };
  return JSON.stringify(current) !== JSON.stringify(l.downloaded.snapshot);
}

function layerIndex(id: string) {
  return layers.layers.value.findIndex((l) => l.id === id);
}

// --- import ---------------------------------------------------------------------------

function triggerImportBuild() {
  buildFileInput.value?.click();
}
function triggerImportLayer() {
  layerFileInput.value?.click();
}

async function onImportBuildFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  builds.importBuildText(await file.text());
}

async function onImportLayerFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  layers.importLayerText(await file.text());
}

// --- trash actions --------------------------------------------------------------------

function restoreTrashEntry(entry: TrashEntry) {
  const item = trash.restore(entry);
  if (!item) return;
  if (entry.kind === "build") builds.importBuilds([item as Build], false);
  else layers.importLayerText(JSON.stringify(item));
  closeMenu();
}

function purgeTrash(entry: TrashEntry) {
  trash.purge(entry);
  closeMenu();
}

// --- menu items computed --------------------------------------------------------------

const buildMenuItems = (id: string) => [
  { action: "rename", label: "Rename" },
  { action: "moveUp", label: "Move up", disabled: buildIndex(id) === 0 },
  {
    action: "moveDown",
    label: "Move down",
    disabled: buildIndex(id) === builds.builds.value.length - 1,
  },
  { action: "duplicate", label: "Duplicate" },
  { action: "download", label: "Download…" },
  {
    action: "revert",
    label: confirmLabel(
      "build",
      id,
      "revert-build",
      "Revert to last downloaded…",
    ),
    disabled: !isBuildRevertable(id),
  },
  { action: "reset", label: confirmLabel("build", id, "reset-build", "Reset") },
  {
    action: "delete",
    label: confirmLabel("build", id, "delete-build", "Delete"),
    danger: true,
    disabled: builds.builds.value.length < 2,
  },
];

const layerMenuItems = (id: string) => [
  { action: "rename", label: "Rename" },
  { action: "moveUp", label: "Move up", disabled: layerIndex(id) === 0 },
  {
    action: "moveDown",
    label: "Move down",
    disabled: layerIndex(id) === layers.layers.value.length - 1,
  },
  { action: "duplicate", label: "Duplicate" },
  { action: "download", label: "Download…" },
  {
    action: "revert",
    label: confirmLabel(
      "layer",
      id,
      "revert-layer",
      "Revert to last downloaded…",
    ),
    disabled: !isLayerRevertable(id),
  },
  {
    action: "delete",
    label: confirmLabel("layer", id, "delete-layer", "Delete"),
    danger: true,
    disabled: layers.layers.value.length < 2,
  },
];

const trashMenuItems = (key: string) => [
  { action: "restore", label: "Restore" },
  {
    action: "purge",
    label: confirmLabel("trash", key, "purge-trash", "Delete permanently"),
    danger: true,
  },
];

// --- menu action dispatchers ----------------------------------------------------------

function onBuildMenuAction(action: string, id: string) {
  switch (action) {
    case "rename":
      startRename(
        "build",
        id,
        builds.builds.value.find((b) => b.id === id)?.name ?? "",
      );
      break;
    case "moveUp":
      moveBuildUp(id);
      break;
    case "moveDown":
      moveBuildDown(id);
      break;
    case "duplicate":
      duplicateCurrentBuild(id);
      closeMenu();
      break;
    case "download":
      exportBuild(id);
      break;
    case "revert":
      runConfirmed("build", id, "revert-build", () => revertBuild(id));
      break;
    case "reset":
      runConfirmed("build", id, "reset-build", () => resetBuild(id));
      break;
    case "delete":
      runConfirmed("build", id, "delete-build", () => deleteBuildRow(id));
      break;
  }
}

function onLayerMenuAction(action: string, id: string) {
  switch (action) {
    case "rename":
      startRename(
        "layer",
        id,
        layers.layers.value.find((l) => l.id === id)?.name ?? "",
      );
      break;
    case "moveUp":
      moveLayerUp(id);
      break;
    case "moveDown":
      moveLayerDown(id);
      break;
    case "duplicate":
      duplicateLayerRow(id);
      break;
    case "download":
      exportLayer(id);
      break;
    case "revert":
      runConfirmed("layer", id, "revert-layer", () => revertLayer(id));
      break;
    case "delete":
      runConfirmed("layer", id, "delete-layer", () => deleteLayerRow(id));
      break;
  }
}

function onTrashMenuAction(action: string, key: string) {
  const entry = trash.trashed.value.find(
    (t) => `${t.kind}_${t.item.id}` === key,
  );
  if (!entry) return;
  if (action === "restore") restoreTrashEntry(entry);
  else if (action === "purge")
    runConfirmed("trash", key, "purge-trash", () => purgeTrash(entry));
}

// --- document event handlers for closing menus ----------------------------------------

function onScrollCapture() {
  closeMenu();
}

/** Closes the context menu on any click outside it -- ignores clicks on the menu itself
 * (`.navmenu`) and on the kebab trigger buttons (`.nav-kebab`), so those reach their own
 * handlers first. Uses the bubbling phase (`capture: false`) so that a click on the
 * already-open row's kebab button toggles the menu closed before this handler runs. */
onClickOutside(root, () => closeMenu(), {
  ignore: [".navmenu", ".nav-kebab"],
  capture: false,
});

useEventListener(document, "scroll", onScrollCapture, {
  capture: true,
  passive: true,
});
</script>

<template>
  <nav
    ref="root"
    class="flex flex-col gap-0.5 bg-surface p-2 text-sm"
    data-testid="library"
  >
    <NavBuilds
      :builds="builds.builds.value"
      :selected-id="
        selection.selection.value?.kind === 'build'
          ? selection.selection.value.id
          : null
      "
      :filter="buildFilter"
      :renaming-id="renaming?.type === 'build' ? renaming.id : null"
      :rename-text="renameText"
      :menu-open-id="openMenu?.type === 'build' ? openMenu.id : null"
      :menu-items="
        openMenu?.type === 'build' ? buildMenuItems(openMenu.id) : []
      "
      :menu-anchor="menuAnchor"
      :can-move-up="(id) => buildIndex(id) !== 0"
      :can-move-down="(id) => buildIndex(id) !== builds.builds.value.length - 1"
      @update:filter="(v) => (buildFilter = v)"
      @select="(id) => selection.selectBuild(id)"
      @rename-start="
        (id, name) => {
          renaming = { type: 'build', id };
          renameText = name;
        }
      "
      @rename-commit="commitRename"
      @rename-cancel="renaming = null"
      @menu-open="(id, ev) => openMenuFor('build', id, ev)"
      @menu-action="(a, id) => onBuildMenuAction(a, id)"
      @create="builds.createBuild()"
      @import="triggerImportBuild"
    />

    <NavLayers
      :layers="layers.layers.value"
      :selected-id="
        selection.selection.value?.kind === 'layer'
          ? selection.selection.value.id
          : null
      "
      :filter="layerFilter"
      :renaming-id="renaming?.type === 'layer' ? renaming.id : null"
      :rename-text="renameText"
      :menu-open-id="openMenu?.type === 'layer' ? openMenu.id : null"
      :menu-items="
        openMenu?.type === 'layer' ? layerMenuItems(openMenu.id) : []
      "
      :menu-anchor="menuAnchor"
      :can-move-up="(id) => layerIndex(id) !== 0"
      :can-move-down="(id) => layerIndex(id) !== layers.layers.value.length - 1"
      @update:filter="(v) => (layerFilter = v)"
      @select="(id) => selection.selectLayer(id)"
      @toggle-enabled="(id) => toggleLayerEnabled(id)"
      @rename-start="
        (id, name) => {
          renaming = { type: 'layer', id };
          renameText = name;
        }
      "
      @rename-commit="commitRename"
      @rename-cancel="renaming = null"
      @menu-open="(id, ev) => openMenuFor('layer', id, ev)"
      @menu-action="(a, id) => onLayerMenuAction(a, id)"
      @create="layers.createLayer()"
      @import="triggerImportLayer"
    />

    <NavTrash
      :entries="trash.trashed.value"
      :expanded="trashExpanded"
      :menu-open-id="openMenu?.type === 'trash' ? openMenu.id : null"
      :menu-items="
        openMenu?.type === 'trash' ? trashMenuItems(openMenu.id) : []
      "
      :menu-anchor="menuAnchor"
      :time-ago="timeAgo"
      @toggle-expand="trashExpanded = !trashExpanded"
      @restore="(entry) => restoreTrashEntry(entry)"
      @menu-open="(id, ev) => openMenuFor('trash', id, ev)"
      @menu-action="(a, id) => onTrashMenuAction(a, id)"
    />

    <input
      ref="buildFileInput"
      type="file"
      accept=".json,application/json"
      class="hidden"
      @change="onImportBuildFile"
    />
    <input
      ref="layerFileInput"
      type="file"
      accept=".json,application/json"
      class="hidden"
      @change="onImportLayerFile"
    />
  </nav>
</template>
