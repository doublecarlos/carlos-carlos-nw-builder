// Which undo history the keyboard acts on, decided by where focus last landed: the nav sidebar
// (workspace operations) or the editor and stat panel (the selected item's content). Regions
// opt in with a `data-undo-scope` attribute on their root; everything else, such as the app
// header or a dialog teleported to <body>, leaves the scope where it was, so undo keeps
// pointing at whatever the user was last working in.
//
// The scope is app-wide state read from more than one place, so it lives at module level and
// the listeners are installed once, from the app root.
import { readonly, ref } from "vue";
import { useEventListener } from "@vueuse/core";

export type UndoScope = "nav" | "editor";

export const UNDO_SCOPE_ATTR = "data-undo-scope";

const _scope = ref<UndoScope>("editor");

export const undoScope = readonly(_scope);

const isUndoScope = (value: string | null): value is UndoScope =>
  value === "nav" || value === "editor";

/** The slice of Element the resolver needs, so a fake element serves in tests without a DOM. */
interface ScopedTarget {
  closest(
    selector: string,
  ): { getAttribute(name: string): string | null } | null;
}

const canResolve = (
  target: EventTarget | null,
): target is EventTarget & ScopedTarget =>
  typeof (target as Partial<ScopedTarget> | null)?.closest === "function";

/** The scope of the closest marked ancestor, or `null` when the target sits outside every
 *  marked region or under an attribute value the app does not define. */
export function scopeOf(target: EventTarget | null): UndoScope | null {
  if (!canResolve(target)) return null;
  const value =
    target.closest(`[${UNDO_SCOPE_ATTR}]`)?.getAttribute(UNDO_SCOPE_ATTR) ??
    null;
  return isUndoScope(value) ? value : null;
}

/** Follows focus and pointer presses into marked regions. Both are watched because a click on
 *  non-focusable content inside a region moves no focus, yet still means the user is there. */
export function useUndoScope() {
  const track = (event: Event) => {
    const next = scopeOf(event.target);
    if (next) _scope.value = next;
  };
  useEventListener(document, "focusin", track);
  useEventListener(document, "pointerdown", track);
}
