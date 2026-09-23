// Tracks unsaved, not-yet-saved drafts (a new entry, a pending bonus card) that navigation
// would otherwise discard silently. Forms register while mounted; any action about to unmount
// them asks first through `confirmDiscard`. Leaving the page itself (close, reload, an outside
// URL) cannot wait on that dialog, so it falls back to the browser's own prompt.
import { computed, shallowRef } from "vue";
import { defaultWindow, useEventListener } from "@vueuse/core";
import * as confirm from "./confirm";

export interface DraftGuard {
  /** Shown in the discard question, e.g. "item", "bonus". */
  noun: string;
  /** Whether this draft currently holds something worth warning about. */
  isDirty: () => boolean;
}

// Shallow so a registered guard keeps its identity: a deep ref would proxy it, and the
// unregister closure's identity check would then never match.
const guards = shallowRef<DraftGuard[]>([]);

/** Registers a draft for the component's lifetime, returning the unregister it calls on
 *  unmount. */
export function register(guard: DraftGuard): () => void {
  guards.value = [...guards.value, guard];
  return () => {
    guards.value = guards.value.filter((candidate) => candidate !== guard);
  };
}

/** The guards whose draft is dirty right now. A plain read, not a cached computed: each
 *  `isDirty` reads its own form's reactive state, and every caller wants the state as it is
 *  at the moment of asking. */
export function dirtyGuards(): DraftGuard[] {
  return guards.value.filter((guard) => guard.isDirty());
}

export function hasDirtyDraft(): boolean {
  return guards.value.some((guard) => guard.isDirty());
}

// Listens only while a draft is dirty: a standing `beforeunload` listener can keep the page
// out of the back/forward cache.
const anyDirty = computed(hasDirtyDraft);
useEventListener(
  () => (anyDirty.value ? defaultWindow : undefined),
  "beforeunload",
  (event: BeforeUnloadEvent) => event.preventDefault(),
);

/** True means "go ahead": no draft is dirty, or the user chose to discard. */
export async function confirmDiscard(): Promise<boolean> {
  const drafts = dirtyGuards();
  if (!drafts.length) return true;
  const nouns = [...new Set(drafts.map((guard) => guard.noun))];
  const what = nouns.length === 1 ? `The ${nouns[0]}` : "The entries";
  const { ok } = await confirm.ask({
    title: "Discard unsaved draft?",
    message: `${what} you are editing has not been saved. Discard it?`,
    confirmLabel: "Discard",
    danger: true,
    note: "This cannot be undone.",
    noteTone: "danger",
    skippable: false,
  });
  return ok;
}
