// The editor's layer over the shipped catalogue (see catalog.ts) -- a workspace, not part of
// any one build, so it's persisted under its own key.
import { computed, ref, watch } from "vue";
import * as storage from "../storage";
import type { CatalogOverlay } from "../types";

const _workspaceOverlay = ref<CatalogOverlay>(storage.loadOverlay());

// `computed`, not a deep-readonly wrapper: DataEditor.vue passes this straight into catalog.ts's
// mutable-typed helpers. Blocks reassignment (no setter); nested-write discipline (only
// `setWorkspaceOverlay` replaces its contents) is a convention.
export const workspaceOverlay = computed(() => _workspaceOverlay.value);

export function setWorkspaceOverlay(overlay: CatalogOverlay) {
  _workspaceOverlay.value = overlay;
}

export const overlayCount = computed(
  () =>
    Object.keys(_workspaceOverlay.value.items ?? {}).length +
    Object.keys(_workspaceOverlay.value.bonusSets ?? {}).length,
);

watch(
  _workspaceOverlay,
  (value) => {
    storage.saveOverlay(value);
  },
  { deep: true },
);
