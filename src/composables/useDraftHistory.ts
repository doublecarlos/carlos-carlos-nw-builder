// Shared engine behind ItemForm.vue / BonusSetForm.vue's "hybrid" editing model:
// - New entries (no committed source yet): edits accumulate into a local undo/redo stack,
//   coalesced into one step per DEBOUNCE_MS of typing, and registered with the global
//   formUndo store so the app header's Undo/Redo buttons reach them.
// - Existing entries: edits debounce straight out to the caller via `onEmit` instead --
//   there is no local undo stack, since the layer overlay's own history (`stores/history`)
//   already covers that case.
import {
  ref,
  computed,
  watch,
  onUnmounted,
  type Ref,
  type ComputedRef,
} from "vue";
import * as formUndo from "../stores/formUndo";

const DEBOUNCE_MS = 700;
const UNDO_LIMIT = 50;

interface DraftEntry {
  json: string;
  label: string;
}

export interface UseDraftHistoryOptions<T> {
  /** The live draft object being edited. Watched deeply; undo/redo replace it wholesale. */
  draft: Ref<T>;
  /** True while there's no committed source yet -- see the module doc comment above. */
  isNew: Ref<boolean> | ComputedRef<boolean>;
  /** Turns two JSON snapshots of `draft` into a human-readable undo/redo step label. */
  diffLabel: (oldJson: string, newJson: string) => string;
  /** Debounced callback fired on every settled draft change while `!isNew`. */
  onEmit: () => void;
}

export function useDraftHistory<T>({
  draft,
  isNew,
  diffLabel,
  onEmit,
}: UseDraftHistoryOptions<T>) {
  const draftHistory = ref<{ past: DraftEntry[]; future: DraftEntry[] }>({
    past: [],
    future: [],
  });
  const lastSnapshotJson = ref(JSON.stringify(draft.value));
  let snapshotTimer: number | undefined;
  let emitTimer: number | undefined;

  const canUndoDraft = computed(() => draftHistory.value.past.length > 0);
  const canRedoDraft = computed(() => draftHistory.value.future.length > 0);
  const undoDraftLabel = computed(() => {
    const past = draftHistory.value.past;
    return past.length ? past[past.length - 1].label : "";
  });
  const redoDraftLabel = computed(() => {
    const future = draftHistory.value.future;
    return future.length ? future[future.length - 1].label : "";
  });

  function resetDraftHistory() {
    window.clearTimeout(snapshotTimer);
    draftHistory.value = { past: [], future: [] };
    lastSnapshotJson.value = JSON.stringify(draft.value);
  }

  function scheduleSnapshot() {
    window.clearTimeout(snapshotTimer);
    snapshotTimer = window.setTimeout(commitSnapshot, DEBOUNCE_MS);
  }

  function commitSnapshot() {
    window.clearTimeout(snapshotTimer);
    const current = JSON.stringify(draft.value);
    if (current === lastSnapshotJson.value) return;
    const label = diffLabel(lastSnapshotJson.value, current);
    draftHistory.value.past.push({ json: lastSnapshotJson.value, label });
    if (draftHistory.value.past.length > UNDO_LIMIT)
      draftHistory.value.past.shift();
    draftHistory.value.future.length = 0;
    lastSnapshotJson.value = current;
  }

  function undoDraft() {
    commitSnapshot();
    if (!draftHistory.value.past.length) return false;
    const entry = draftHistory.value.past.pop()!;
    draftHistory.value.future.push({
      json: lastSnapshotJson.value,
      label: entry.label,
    });
    lastSnapshotJson.value = entry.json;
    draft.value = JSON.parse(entry.json);
    return true;
  }

  function redoDraft() {
    if (!draftHistory.value.future.length) return false;
    const entry = draftHistory.value.future.pop()!;
    draftHistory.value.past.push({
      json: lastSnapshotJson.value,
      label: entry.label,
    });
    lastSnapshotJson.value = entry.json;
    draft.value = JSON.parse(entry.json);
    return true;
  }

  function scheduleEmit() {
    window.clearTimeout(emitTimer);
    emitTimer = window.setTimeout(onEmit, DEBOUNCE_MS);
  }

  // For existing entries: schedule the live emit on draft change.
  // For new entries: schedule a snapshot for draft undo.
  watch(
    draft,
    () => {
      if (isNew.value) scheduleSnapshot();
      else scheduleEmit();
    },
    { deep: true },
  );

  let unregisterFormUndo: (() => void) | undefined;

  function registerFormUndo() {
    unregisterFormUndo?.();
    if (isNew.value) {
      unregisterFormUndo = formUndo.register({
        get canUndo() {
          return canUndoDraft.value;
        },
        get canRedo() {
          return canRedoDraft.value;
        },
        undo: undoDraft,
        redo: redoDraft,
        get undoLabel() {
          return undoDraftLabel.value;
        },
        get redoLabel() {
          return redoDraftLabel.value;
        },
      });
    } else {
      unregisterFormUndo = undefined;
    }
  }

  watch(isNew, registerFormUndo, { immediate: true });

  onUnmounted(() => {
    window.clearTimeout(snapshotTimer);
    window.clearTimeout(emitTimer);
    unregisterFormUndo?.();
  });

  return {
    canUndoDraft,
    canRedoDraft,
    undoDraftLabel,
    redoDraftLabel,
    undoDraft,
    redoDraft,
    resetDraftHistory,
    scheduleSnapshot,
    scheduleEmit,
  };
}
