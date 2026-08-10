// Generic drag-and-drop building blocks for the list/tree reorder UIs across the app
// (builds, layers, grants, tiers, variants, condition rows/branches). Hand-rolled on native
// HTML5 drag events (dragstart/dragover/drop/dragend) -- GameImport.vue already does the same
// for its file dropzone, this generalizes the pattern to reorderable lists.
//
// The composable never mutates domain arrays itself: each drop zone is handed an `onDrop`
// callback and the call site decides how to apply it (a store method, an `update` emit),
// mirroring how every existing move-up/down button already works. Drag state (what's being
// dragged, and which drop zone is currently hovered) lives in a module-scope singleton --
// cross-component drops (e.g. a condition dragged from one grant's tree into another's) need
// visibility between components that share no useful common ancestor, so provide/inject
// doesn't fit; this matches how the rest of the app's shared state lives in module-scope
// stores rather than injected context.
//
// A "drop into a nested block" (e.g. an existing condition dragged into a fresh `not` group)
// needs no separate primitive: ConditionRows.vue renders each branch as its own nested
// ConditionRows instance with its own useDropList, including while empty, so that instance's
// own drop zone already is "drop into this block".
//
// Vitest runs unit tests with `environment: "node"` (no DOM/DragEvent), so the DOM-facing
// handlers below have no unit coverage -- only the pure index/edge helpers do. End-to-end
// (Playwright) tests are the only net for the handlers themselves.

import { computed, reactive } from "vue";

export interface DragSource {
  /** Distinguishes payload shapes so a drop zone can reject sources it doesn't understand
   *  (e.g. a condition row dropped where a build row is expected). */
  kind: string;
  /** Opaque id of the list/branch the item currently lives in. */
  containerId: string;
  /** Stable id within that container (e.g. a build's id, a row's uid). */
  key: string;
  /** Position within `containerId` before the drag started -- used for same-list reorder
   *  index math (see `reorderIndex`). */
  index: number;
  /** Arbitrary extra data a call site needs at drop time (e.g. a condition row's tree id and
   *  path, for a cross-container transfer). */
  data?: unknown;
}

export type DropEdge = "before" | "after";

interface DragBusState {
  source: DragSource | null;
  overContainerId: string | null;
  overIndex: number | null;
  overEdge: DropEdge | null;
}

const state = reactive<DragBusState>({
  source: null,
  overContainerId: null,
  overIndex: null,
  overEdge: null,
});

function clearDrag() {
  state.source = null;
  state.overContainerId = null;
  state.overIndex = null;
  state.overEdge = null;
}

let cleanupArmed = false;
/** Clears stuck hover/drag state if a drag ends outside any drop zone (dropped on the OS
 *  desktop, cancelled with Escape, etc). Armed lazily on first handle/list use, as a plain
 *  `addEventListener` rather than a composable like VueUse's `useEventListener` -- drop zones
 *  are created dynamically (per grant, per condition branch) from contexts that aren't real
 *  `<script setup>` setup scope, where a lifecycle-hook-based listener wouldn't reliably
 *  register, and this listener needs no unmount cleanup anyway (it's page-lifetime, for a
 *  module-scope singleton). Guarded for Vitest's `environment: "node"`, and for `builds.ts`/
 *  `layers.ts`/`bonus-draft.ts`'s partial `window` shim in store unit tests (`window` set to
 *  `globalThis`, sans DOM methods) -- neither has a real `addEventListener` to call. */
function armGlobalCleanup() {
  if (cleanupArmed) return;
  cleanupArmed = true;
  if (
    typeof window !== "undefined" &&
    typeof window.addEventListener === "function"
  ) {
    window.addEventListener("dragend", clearDrag);
  }
}

/** Pure -- which side of a row's own height the cursor is over. Unit-testable without DOM. */
export function resolveDropEdge(offsetYRatio: number): DropEdge {
  return offsetYRatio < 0.5 ? "before" : "after";
}

/** Pure -- the index a dragged item lands at once it's spliced out of `fromIndex`, given a
 *  target index computed against the list *before* that removal (which is what dragover
 *  math naturally produces, since the list hasn't been mutated yet while hovering). Only
 *  matters for same-list moves; cross-list moves insert into an unrelated array. */
export function reorderIndex(fromIndex: number, toIndex: number): number {
  return toIndex > fromIndex ? toIndex - 1 : toIndex;
}

/** Binds a drag handle element (typically a grip icon, never a whole row -- so text inputs
 *  and comboboxes inside a row don't fight the browser's own drag-to-select-text gesture).
 *  Safe to call dynamically (e.g. once per row from a template helper, not just from real
 *  `<script setup>` setup scope) since it's a plain function with no Vue lifecycle hooks of
 *  its own. */
export function useDragHandle(getSource: () => DragSource) {
  armGlobalCleanup();
  return {
    draggable: true,
    onDragstart(event: DragEvent) {
      const source = getSource();
      state.source = source;
      event.dataTransfer?.setData("text/plain", source.key);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    },
    onDragend() {
      clearDrag();
    },
  };
}

/** One reorderable list. `containerId` should be stable and unique per rendered list instance
 *  (e.g. `"tiers:" + grant.uid`) -- `accepts` typically checks both `source.kind` and, for
 *  lists that shouldn't accept drops from a sibling list of the same kind (tiers/variants are
 *  scoped to their own grant), `source.containerId === containerId` too. */
export function useDropList(options: {
  containerId: string;
  accepts: (source: DragSource) => boolean;
  onDrop: (source: DragSource, index: number) => void;
}) {
  armGlobalCleanup();

  const isActiveContainer = computed(
    () =>
      state.source !== null &&
      state.overContainerId === options.containerId &&
      options.accepts(state.source),
  );

  function indicatorAt(index: number): DropEdge | null {
    if (!isActiveContainer.value || state.overIndex !== index) return null;
    return state.overEdge;
  }

  function handleDragover(
    event: DragEvent,
    index: number,
    edge: DropEdge | null,
  ) {
    if (!state.source || !options.accepts(state.source)) return;
    event.preventDefault();
    event.stopPropagation();
    state.overContainerId = options.containerId;
    state.overIndex = index;
    state.overEdge = edge;
  }

  function handleDrop(event: DragEvent, dropIndex: number) {
    if (!state.source || !options.accepts(state.source)) return;
    event.preventDefault();
    event.stopPropagation();
    const source = state.source;
    clearDrag();
    options.onDrop(source, dropIndex);
  }

  /** Bind on each row -- reports which half of the row the cursor is over so the drop lands
   *  before or after it. */
  function rowProps(index: number) {
    return {
      onDragover(event: DragEvent) {
        const target = event.currentTarget as HTMLElement;
        const rect = target.getBoundingClientRect();
        const ratio = (event.clientY - rect.top) / (rect.height || 1);
        handleDragover(event, index, resolveDropEdge(ratio));
      },
      onDrop(event: DragEvent) {
        const dropIndex = state.overEdge === "after" ? index + 1 : index;
        handleDrop(event, dropIndex);
      },
    };
  }

  /** Bind on the list's empty-state placeholder so an empty list is still a valid target. */
  function emptyProps() {
    return {
      onDragover(event: DragEvent) {
        handleDragover(event, 0, null);
      },
      onDrop(event: DragEvent) {
        handleDrop(event, 0);
      },
    };
  }

  return { isActiveContainer, indicatorAt, rowProps, emptyProps };
}
