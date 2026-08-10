// The flat pool of builds: id→Build map, order, loading, selectors, and every mutation
// that creates/destroys/reorders them. Build content edits live in buildEditor.ts.
import { computed, ref, watch } from "vue";
import { useDebounceFn } from "@vueuse/core";
import { reorderIndex } from "../composables/useDragAndDrop";
import * as storage from "../storage/storage";
import * as history from "./history";
import * as trash from "./trash";
import * as selection from "./selection";
import { buildOrder, persistMeta } from "./meta";
import { flagStorageFailed, showNotice } from "./notice";
import * as layers from "./layers";
import { db as engineDb } from "./resolved";
import type { Build } from "../types";

const SAVE_DEBOUNCE_MS = 250;

const _builds = ref<Map<string, Build>>(new Map());
const _loading = ref(true);

export const builds = computed(() =>
  buildOrder.value.map((id) => _builds.value.get(id)!).filter(Boolean),
);

export const build = computed(() => {
  const sel = selection.selection.value;
  if (sel?.kind === "build" && _builds.value.has(sel.id)) {
    return _builds.value.get(sel.id)!;
  }
  if (buildOrder.value.length) return _builds.value.get(buildOrder.value[0])!;
  // Guarantee at least one build exists.
  const b = storage.defaultBuild("Build 1");
  _builds.value.set(b.id, b);
  buildOrder.value.push(b.id);
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
  if (!buildOrder.value.includes(newBuild.id))
    buildOrder.value.push(newBuild.id);
  markDirty(newBuild.id);
  selection.selectBuild(newBuild.id);
}

export function createBuild() {
  const b = storage.defaultBuild(`Build ${_builds.value.size + 1}`);
  _builds.value.set(b.id, b);
  buildOrder.value.push(b.id);
  markDirty(b.id);
  selection.selectBuild(b.id);
  showNotice(`Created “${b.name}”`);
}

export function duplicateBuild() {
  const source = build.value;
  if (!source) return;
  const copy = storage.duplicate(source);
  _builds.value.set(copy.id, copy);
  buildOrder.value.push(copy.id);
  markDirty(copy.id);
  selection.selectBuild(copy.id);
  showNotice(`Duplicated as “${copy.name}”`);
}

export function deleteBuild(id: string) {
  const b = _builds.value.get(id);
  if (!b) return;

  // If this is the last build, replace it with a fresh empty build.
  if (_builds.value.size < 2) {
    clearDirty(id);
    _builds.value.delete(id);
    buildOrder.value = [];
    storage.deleteBuildRecord(id).catch(() => {});

    trash._add("build", b);
    showNotice(`Deleted "${b.name}"`);

    const replacement = storage.defaultBuild("Build 1");
    _builds.value.set(replacement.id, replacement);
    buildOrder.value.push(replacement.id);
    markDirty(replacement.id);
    selection.selectBuild(replacement.id);
    return;
  }

  clearDirty(id);
  _builds.value.delete(id);
  buildOrder.value = buildOrder.value.filter((oid) => oid !== id);
  storage.deleteBuildRecord(id).catch(() => {});

  trash._add("build", b);
  showNotice(`Deleted "${b.name}"`);

  if (
    selection.selection.value?.kind === "build" &&
    selection.selection.value.id === id
  ) {
    const next = buildOrder.value[0];
    if (next) selection.selectBuild(next);
  }
}

/** `toIndex` is relative to the list as it stands now (before `id` is removed) -- callers
 *  (the delta-based `moveBuild` below, and drag-and-drop's drop-index math) both naturally
 *  produce indexes in those terms. */
export async function moveBuildTo(id: string, toIndex: number) {
  const idx = buildOrder.value.indexOf(id);
  if (idx === -1) return;
  const clamped = Math.max(0, Math.min(buildOrder.value.length, toIndex));
  const insertAt = reorderIndex(idx, clamped);
  if (insertAt === idx) return;
  buildOrder.value.splice(idx, 1);
  buildOrder.value.splice(insertAt, 0, id);
  await persistMeta();
}

export async function moveBuild(id: string, delta: number) {
  const idx = buildOrder.value.indexOf(id);
  if (idx === -1) return;
  await moveBuildTo(id, idx + delta);
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
function overlayOverlapCount(
  build: Build,
  overlays: import("../types").CatalogOverlay[],
): number {
  if (!build.catalog) return 0;
  const ids = new Set<string>();
  for (const overlay of overlays) {
    if (!overlay) continue;
    for (const key of Object.keys(overlay.items ?? {})) ids.add(key);
    for (const key of Object.keys(overlay.bonusSets ?? {})) ids.add(key);
  }
  let count = 0;
  for (const key of Object.keys(build.catalog.items ?? {})) {
    if (ids.has(key)) count++;
  }
  for (const key of Object.keys(build.catalog.bonusSets ?? {})) {
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
    buildOrder.value.push(b.id);
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

export function importBuildText(text: string) {
  try {
    const { builds: newBuilds, catalogStale } = storage.parseJson(text);
    importBuilds(newBuilds, catalogStale, layers.enabledOverlays.value);
  } catch (error: unknown) {
    showNotice(
      `That file could not be read: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
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

// --- persistence (incremental — only dirty ids are written) -----------------------------

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
          "Could not save to storage — export your build to keep it.",
        );
      }
    }
  }
}

const flushSaveDebounced = useDebounceFn(flushSave, SAVE_DEBOUNCE_MS);

function markDirty(id: string) {
  if (_loading.value) return;
  _dirtyIds.add(id);
  flushSaveDebounced();
}

function clearDirty(id: string) {
  _dirtyIds.delete(id);
}

// Deep-watch the active build so buildEditor.ts content edits (which mutate build.value in
// place) trigger persistence of just that build's record.
watch(
  () => build.value,
  (b) => {
    if (b && !_loading.value) markDirty(b.id);
  },
  { deep: true },
);
