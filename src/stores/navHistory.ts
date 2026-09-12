// The sidebar's undo stack: one in-memory, session-only stack of workspace operations, as
// opposed to the per-item content stacks in `history.ts`. Creating, duplicating, deleting,
// moving, renaming and enabling builds and layers, and every folder operation, land here no
// matter which surface triggered them. The operation decides the stack, not the click.
//
// Steps are commands, not snapshots: each carries an `undo` and a `redo` closure over the ids
// and positions it captured when recorded. Nothing is persisted, so a reload starts empty.
// No coalescing: every recorded step is its own undo step.
import { computed, ref, shallowRef } from "vue";

const LIMIT = 50;

/** What applying one direction of a step reports: the row the sidebar should focus, or null
 *  when that row is gone (a folder after undoing its creation). */
export interface NavStepApplied {
  focusId: string | null;
}

/** `false` means the step can no longer apply, as when the trash entry it would restore was
 *  purged. The step is dropped from the stack rather than moved to the opposite one. */
export type NavStepOutcome = NavStepApplied | false;

export type NavStepFn = () => NavStepOutcome;

export interface NavStep {
  label: string;
  undo: NavStepFn;
  redo: NavStepFn;
}

const _past = ref<NavStep[]>([]);
const _future = ref<NavStep[]>([]);

export const canUndo = computed(() => _past.value.length > 0);
export const canRedo = computed(() => _future.value.length > 0);
export const undoLabel = computed(() => _past.value.at(-1)?.label ?? "");
export const redoLabel = computed(() => _future.value.at(-1)?.label ?? "");

/** The row the sidebar should focus after the latest undo or redo. Focusing is the UI's
 *  business, so the store only publishes the request: a fresh object per step, so a watcher
 *  fires even when consecutive steps land on the same row. */
export const focusRequest = shallowRef<{ focusId: string } | null>(null);

/** Records a step that has already been applied. Clears the redo stack. */
export function record(step: NavStep) {
  _past.value.push(step);
  if (_past.value.length > LIMIT) _past.value.shift();
  _future.value.length = 0;
}

/** Pops the top step of `from`, applies its `direction`, and parks it on `to` for the way
 *  back. A step that reports it cannot apply is dropped. */
function shift(
  from: NavStep[],
  to: NavStep[],
  direction: "undo" | "redo",
): NavStepApplied | undefined {
  const step = from.pop();
  if (!step) return undefined;
  const outcome = step[direction]();
  if (outcome === false) return undefined;
  to.push(step);
  if (outcome.focusId) focusRequest.value = { focusId: outcome.focusId };
  return outcome;
}

export function undo(): NavStepApplied | undefined {
  return shift(_past.value, _future.value, "undo");
}

export function redo(): NavStepApplied | undefined {
  return shift(_future.value, _past.value, "redo");
}
