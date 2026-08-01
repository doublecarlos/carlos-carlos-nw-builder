<script setup lang="ts">
// Left sidebar: builds, customization layers, and recently deleted.
// Replaces the interim BuildLibrary.vue.
import { ref, reactive, nextTick, computed, onMounted, onUnmounted } from "vue";
import BaseButton from "./ui/BaseButton.vue";
import BaseCheckbox from "./ui/BaseCheckbox.vue";
import * as builds from "../stores/builds";
import * as layers from "../stores/layers";
import * as selection from "../stores/selection";
import * as buildEditor from "../stores/buildEditor";
import * as trash from "../stores/trash";
import type { Build, TrashEntry } from "../types";

const CONFIRM_MS = 4000;

const root = ref<HTMLElement | null>(null);
const openMenu = ref<{ type: string; id: string } | null>(null);
const menuPos = reactive({ top: 0, left: 0 });
const renaming = ref<{ type: string; id: string } | null>(null);
const renameText = ref("");
const confirm = ref<{ type: string; id: string; action: string } | null>(null);
let confirmTimer: number | undefined;

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

// --- filtered lists -------------------------------------------------------------------

const filteredBuilds = computed(() => {
  if (!buildFilter.value) return builds.builds.value;
  const q = buildFilter.value.toLowerCase();
  return builds.builds.value.filter((b) => b.name.toLowerCase().includes(q));
});

const filteredLayers = computed(() => {
  if (!layerFilter.value) return layers.layers.value;
  const q = layerFilter.value.toLowerCase();
  return layers.layers.value.filter((l) => l.name.toLowerCase().includes(q));
});

// --- selection helpers ----------------------------------------------------------------

function isSelected(kind: "build" | "layer", id: string) {
  const sel = selection.selection.value;
  return sel?.kind === kind && sel.id === id;
}

// --- menus ---------------------------------------------------------------------------

function isMenuOpen(type: string, id: string) {
  return openMenu.value?.type === type && openMenu.value?.id === id;
}

function openMenuFor(type: string, id: string, event: MouseEvent) {
  if (isMenuOpen(type, id)) {
    openMenu.value = null;
    return;
  }
  const el = event.currentTarget as HTMLElement;
  const rect = el.closest(".nav-row")!.getBoundingClientRect();
  menuPos.top = rect.bottom + 2;
  menuPos.left = rect.right;
  openMenu.value = { type, id };

  nextTick(() => {
    const menu = root.value?.querySelector(".navmenu") as HTMLElement | null;
    if (!menu) return;
    const margin = 8;
    if (menuPos.top + menu.offsetHeight <= window.innerHeight - margin) return;
    menuPos.top = Math.max(rect.top - menu.offsetHeight - 2, margin);
  });
}

function closeMenu() {
  openMenu.value = null;
}

// --- rename ---------------------------------------------------------------------------

function isRenaming(type: string, id: string) {
  return renaming.value?.type === type && renaming.value?.id === id;
}

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

// --- two-step confirm ----------------------------------------------------------------

function isConfirming(type: string, id: string, action: string) {
  return (
    confirm.value?.type === type &&
    confirm.value?.id === id &&
    confirm.value?.action === action
  );
}

function confirmLabel(type: string, id: string, action: string, label: string) {
  return isConfirming(type, id, action) ? "Really?" : label;
}

function runConfirmed(
  type: string,
  id: string,
  action: string,
  run: () => void,
) {
  if (!isConfirming(type, id, action)) {
    confirm.value = { type, id, action };
    window.clearTimeout(confirmTimer);
    confirmTimer = window.setTimeout(() => {
      confirm.value = null;
    }, CONFIRM_MS);
    return;
  }
  window.clearTimeout(confirmTimer);
  confirm.value = null;
  run();
  closeMenu();
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
  // Compare current state (minus downloaded) to the snapshot.
  const current = { ...l, downloaded: undefined };
  return JSON.stringify(current) !== JSON.stringify(l.downloaded.snapshot);
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

function restoreTrash(entry: TrashEntry) {
  const item = trash.restore(entry);
  if (!item) return;
  if (entry.kind === "build") {
    builds.importBuilds([item as Build], false);
  } else {
    layers.importLayerText(JSON.stringify(item));
  }
}

function restoreTrashEntry(entry: TrashEntry) {
  restoreTrash(entry);
  closeMenu();
}

function purgeTrash(entry: TrashEntry) {
  trash.purge(entry);
  closeMenu();
}

// --- build index helpers --------------------------------------------------------------

function buildIndex(id: string) {
  return builds.builds.value.findIndex((b) => b.id === id);
}

function layerIndex(id: string) {
  return layers.layers.value.findIndex((l) => l.id === id);
}

// --- document event handlers for closing menus ----------------------------------------

function onDocumentClick(event: MouseEvent) {
  if (!openMenu.value) return;
  const target = event.target as HTMLElement;
  if (target.closest(".navmenu") || target.closest(".nav-kebab")) return;
  closeMenu();
}

function onScrollCapture() {
  closeMenu();
}

onMounted(() => {
  document.addEventListener("click", onDocumentClick, true);
  document.addEventListener("scroll", onScrollCapture, {
    capture: true,
    passive: true,
  });
});

onUnmounted(() => {
  document.removeEventListener("click", onDocumentClick, true);
  document.removeEventListener("scroll", onScrollCapture, { capture: true });
});
</script>

<template>
  <nav
    ref="root"
    class="flex flex-col gap-0.5 bg-surface p-2 text-sm"
    data-testid="library"
  >
    <!-- Builds -->
    <div class="flex min-h-0 flex-1 flex-col">
      <div class="mb-1 flex items-center justify-between px-1 py-0.5">
        <span class="text-xs font-semibold uppercase text-muted">Builds</span>
        <div class="flex items-center gap-1">
          <BaseButton variant="link" @click="triggerImportBuild"
            >Import</BaseButton
          >
          <BaseButton variant="link" @click="builds.createBuild()"
            >+ New</BaseButton
          >
        </div>
      </div>

      <!-- Build filter -->
      <input
        v-model="buildFilter"
        type="text"
        placeholder="Filter…"
        class="mb-1 rounded-md border border-line bg-surface px-2 py-0.5 text-xs focus:outline-accent"
      />

      <!-- Build list -->
      <div class="flex-1 overflow-y-auto">
        <div
          v-for="b in filteredBuilds"
          :key="b.id"
          class="nav-row nav-row--build relative flex items-center gap-1 rounded-md py-1 pl-5 pr-1"
          :class="isSelected('build', b.id) && 'is-active bg-accent-soft'"
        >
          <input
            v-if="isRenaming('build', b.id)"
            v-model="renameText"
            class="nav-rename min-w-0 flex-1 rounded-md border border-line bg-surface px-1 py-0.5"
            @keydown.enter="commitRename"
            @keydown.esc="renaming = null"
            @blur="commitRename"
          />
          <button
            v-else
            type="button"
            class="nav-name min-w-0 flex-1 cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap py-0.5 text-left"
            @click="selection.selectBuild(b.id)"
            @dblclick="startRename('build', b.id, b.name)"
            @contextmenu.prevent="openMenuFor('build', b.id, $event)"
          >
            {{ b.name }}
          </button>

          <div class="nav-menu-wrap relative">
            <button
              type="button"
              class="nav-kebab flex-none cursor-pointer rounded-md px-1.5 leading-none text-muted hover:bg-surface-2 hover:text-text"
              title="Build menu"
              @click="openMenuFor('build', b.id, $event)"
            >
              ⋮
            </button>

            <div
              v-if="isMenuOpen('build', b.id)"
              class="navmenu fixed z-30 flex min-w-48 -translate-x-full flex-col rounded-md border border-line bg-surface p-1 shadow-lg"
              :style="{ top: menuPos.top + 'px', left: menuPos.left + 'px' }"
            >
              <button
                type="button"
                class="rounded-md px-2 py-1 text-left cursor-pointer hover:bg-surface-2"
                @click="startRename('build', b.id, b.name)"
              >
                Rename
              </button>
              <button
                type="button"
                class="rounded-md px-2 py-1 text-left cursor-pointer hover:bg-surface-2"
                :disabled="buildIndex(b.id) === 0"
                :class="buildIndex(b.id) === 0 && 'text-muted'"
                @click="moveBuildUp(b.id)"
              >
                Move up
              </button>
              <button
                type="button"
                class="rounded-md px-2 py-1 text-left cursor-pointer hover:bg-surface-2"
                :disabled="buildIndex(b.id) === builds.builds.value.length - 1"
                :class="
                  buildIndex(b.id) === builds.builds.value.length - 1 &&
                  'text-muted'
                "
                @click="moveBuildDown(b.id)"
              >
                Move down
              </button>
              <button
                type="button"
                class="rounded-md px-2 py-1 text-left cursor-pointer hover:bg-surface-2"
                @click="
                  duplicateCurrentBuild(b.id);
                  closeMenu();
                "
              >
                Duplicate
              </button>
              <button
                type="button"
                class="rounded-md px-2 py-1 text-left cursor-pointer hover:bg-surface-2"
                @click="
                  exportBuild(b.id);
                  closeMenu();
                "
              >
                Download…
              </button>
              <button
                type="button"
                class="rounded-md px-2 py-1 text-left cursor-pointer hover:bg-surface-2"
                :disabled="!isBuildRevertable(b.id)"
                :class="!isBuildRevertable(b.id) && 'text-muted'"
                @click="
                  runConfirmed('build', b.id, 'revert-build', () =>
                    revertBuild(b.id),
                  )
                "
              >
                {{
                  confirmLabel(
                    "build",
                    b.id,
                    "revert-build",
                    "Revert to last downloaded…",
                  )
                }}
              </button>
              <button
                type="button"
                class="rounded-md px-2 py-1 text-left cursor-pointer hover:bg-surface-2"
                @click="
                  runConfirmed('build', b.id, 'reset-build', () =>
                    resetBuild(b.id),
                  )
                "
              >
                {{ confirmLabel("build", b.id, "reset-build", "Reset") }}
              </button>
              <button
                type="button"
                class="rounded-md px-2 py-1 text-left enabled:cursor-pointer disabled:text-muted enabled:hover:bg-danger-soft enabled:hover:text-danger"
                :disabled="builds.builds.value.length < 2"
                @click="
                  runConfirmed('build', b.id, 'delete-build', () =>
                    deleteBuildRow(b.id),
                  )
                "
              >
                {{ confirmLabel("build", b.id, "delete-build", "Delete") }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Customization Layers -->
    <div class="border-t border-line pt-1.5">
      <div class="mb-1 flex items-center justify-between px-1 py-0.5">
        <span
          class="flex items-center gap-1 text-xs font-semibold uppercase text-muted"
        >
          Customization Layers
          <span
            class="inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full bg-surface-2 text-[10px] leading-none text-muted"
            title="Layers apply top to bottom — a lower layer overrides the ones above it."
            >?</span
          >
        </span>
        <div class="flex items-center gap-1">
          <BaseButton variant="link" @click="triggerImportLayer"
            >Import</BaseButton
          >
          <BaseButton variant="link" @click="layers.createLayer()"
            >+ New</BaseButton
          >
        </div>
      </div>

      <!-- Layer filter -->
      <input
        v-model="layerFilter"
        type="text"
        placeholder="Filter…"
        class="mb-1 rounded-md border border-line bg-surface px-2 py-0.5 text-xs focus:outline-accent"
      />

      <!-- Layer list (scrollable, max-h) -->
      <div class="max-h-48 overflow-y-auto">
        <div
          v-for="l in filteredLayers"
          :key="l.id"
          class="nav-row nav-row--layer relative flex items-center gap-1 rounded-md py-1 pl-5 pr-1"
          :class="isSelected('layer', l.id) && 'is-active bg-accent-soft'"
        >
          <div @click.stop>
            <BaseCheckbox
              :model-value="l.enabled"
              @update:model-value="toggleLayerEnabled(l.id)"
            />
          </div>

          <input
            v-if="isRenaming('layer', l.id)"
            v-model="renameText"
            class="nav-rename min-w-0 flex-1 rounded-md border border-line bg-surface px-1 py-0.5"
            @keydown.enter="commitRename"
            @keydown.esc="renaming = null"
            @blur="commitRename"
          />
          <button
            v-else
            type="button"
            class="nav-name min-w-0 flex-1 cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap py-0.5 text-left"
            :class="!l.enabled && 'text-muted'"
            @click="selection.selectLayer(l.id)"
            @dblclick="startRename('layer', l.id, l.name)"
            @contextmenu.prevent="openMenuFor('layer', l.id, $event)"
          >
            {{ l.name }}
          </button>

          <div class="nav-menu-wrap relative">
            <button
              type="button"
              class="nav-kebab flex-none cursor-pointer rounded-md px-1.5 leading-none text-muted hover:bg-surface-2 hover:text-text"
              title="Layer menu"
              @click="openMenuFor('layer', l.id, $event)"
            >
              ⋮
            </button>

            <div
              v-if="isMenuOpen('layer', l.id)"
              class="navmenu fixed z-30 flex min-w-48 -translate-x-full flex-col rounded-md border border-line bg-surface p-1 shadow-lg"
              :style="{ top: menuPos.top + 'px', left: menuPos.left + 'px' }"
            >
              <button
                type="button"
                class="rounded-md px-2 py-1 text-left cursor-pointer hover:bg-surface-2"
                @click="startRename('layer', l.id, l.name)"
              >
                Rename
              </button>
              <button
                type="button"
                class="rounded-md px-2 py-1 text-left cursor-pointer hover:bg-surface-2"
                :disabled="layerIndex(l.id) === 0"
                :class="layerIndex(l.id) === 0 && 'text-muted'"
                @click="moveLayerUp(l.id)"
              >
                Move up
              </button>
              <button
                type="button"
                class="rounded-md px-2 py-1 text-left cursor-pointer hover:bg-surface-2"
                :disabled="layerIndex(l.id) === layers.layers.value.length - 1"
                :class="
                  layerIndex(l.id) === layers.layers.value.length - 1 &&
                  'text-muted'
                "
                @click="moveLayerDown(l.id)"
              >
                Move down
              </button>
              <button
                type="button"
                class="rounded-md px-2 py-1 text-left cursor-pointer hover:bg-surface-2"
                @click="
                  duplicateLayerRow(l.id);
                  closeMenu();
                "
              >
                Duplicate
              </button>
              <button
                type="button"
                class="rounded-md px-2 py-1 text-left cursor-pointer hover:bg-surface-2"
                @click="
                  exportLayer(l.id);
                  closeMenu();
                "
              >
                Download…
              </button>
              <button
                type="button"
                class="rounded-md px-2 py-1 text-left cursor-pointer hover:bg-surface-2"
                :disabled="!isLayerRevertable(l.id)"
                :class="!isLayerRevertable(l.id) && 'text-muted'"
                @click="
                  runConfirmed('layer', l.id, 'revert-layer', () =>
                    revertLayer(l.id),
                  )
                "
              >
                {{
                  confirmLabel(
                    "layer",
                    l.id,
                    "revert-layer",
                    "Revert to last downloaded…",
                  )
                }}
              </button>
              <button
                type="button"
                class="rounded-md px-2 py-1 text-left enabled:cursor-pointer disabled:text-muted enabled:hover:bg-danger-soft enabled:hover:text-danger"
                :disabled="layers.layers.value.length < 2"
                @click="
                  runConfirmed('layer', l.id, 'delete-layer', () =>
                    deleteLayerRow(l.id),
                  )
                "
              >
                {{ confirmLabel("layer", l.id, "delete-layer", "Delete") }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Recently deleted -->
    <div
      v-if="trash.trashed.value.length > 0"
      class="border-t border-line pt-1.5"
    >
      <div
        class="flex cursor-pointer items-center justify-between px-1 py-0.5 select-none"
        @click="trashExpanded = !trashExpanded"
      >
        <span class="text-xs font-semibold uppercase text-muted">
          {{ trashExpanded ? "▾" : "▸" }} Recently deleted ({{
            trash.trashed.value.length
          }})
        </span>
      </div>

      <div v-if="trashExpanded" class="overflow-y-auto">
        <div
          v-for="entry in trash.trashed.value"
          :key="`${entry.kind}_${entry.item.id}_${entry.deletedAt}`"
          class="nav-row relative flex items-center gap-1 rounded-md py-1 pl-5 pr-1"
        >
          <span
            class="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-xs text-muted"
          >
            <span class="text-[10px] uppercase">{{
              entry.kind === "build" ? "B" : "L"
            }}</span>
            {{ entry.item.name }}
            <span class="text-[10px]">— {{ timeAgo(entry.deletedAt) }}</span>
          </span>

          <button
            type="button"
            class="flex-none cursor-pointer rounded-md px-1 py-0.5 text-xs text-accent hover:bg-accent-soft"
            @click="restoreTrashEntry(entry)"
          >
            Restore
          </button>
          <div class="nav-menu-wrap relative">
            <button
              type="button"
              class="nav-kebab flex-none cursor-pointer rounded-md px-1.5 leading-none text-muted hover:bg-surface-2 hover:text-text"
              title="Trash menu"
              @click="
                openMenuFor('trash', `${entry.kind}_${entry.item.id}`, $event)
              "
            >
              ⋮
            </button>
            <div
              v-if="isMenuOpen('trash', `${entry.kind}_${entry.item.id}`)"
              class="navmenu fixed z-30 flex min-w-48 -translate-x-full flex-col rounded-md border border-line bg-surface p-1 shadow-lg"
              :style="{ top: menuPos.top + 'px', left: menuPos.left + 'px' }"
            >
              <button
                type="button"
                class="rounded-md px-2 py-1 text-left cursor-pointer hover:bg-surface-2"
                @click="restoreTrashEntry(entry)"
              >
                Restore
              </button>
              <button
                type="button"
                class="rounded-md px-2 py-1 text-left cursor-pointer enabled:hover:bg-danger-soft enabled:hover:text-danger"
                @click="
                  runConfirmed(
                    'trash',
                    `${entry.kind}_${entry.item.id}`,
                    'purge-trash',
                    () => purgeTrash(entry),
                  )
                "
              >
                {{
                  confirmLabel(
                    "trash",
                    `${entry.kind}_${entry.item.id}`,
                    "purge-trash",
                    "Delete permanently",
                  )
                }}
              </button>
            </div>
          </div>
        </div>
        <p class="px-1 py-0.5 text-[10px] text-muted">
          Entries clear themselves after 7 days.
        </p>
      </div>
    </div>

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
