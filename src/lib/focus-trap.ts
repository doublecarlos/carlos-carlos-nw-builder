const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** Tabbable descendants of `root` in document order, minus the hidden ones. A file input behind
 *  its own button is focusable by selector but not reachable by Tab. */
export function focusables(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.offsetWidth > 0 || el.offsetHeight > 0,
  );
}

/** Wraps Tab/Shift+Tab at the ends of `root`'s own tabbable descendants, so focus never leaves
 *  it for whatever sits behind it: the rest of the document, or for a teleported panel, the
 *  teleport tail. */
export function trapTab(event: KeyboardEvent, root: HTMLElement | null) {
  const items = focusables(root);
  if (!items.length) {
    // Nothing to move to, so the root itself keeps the keyboard.
    event.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (event.shiftKey ? active !== first : active !== last) return;
  event.preventDefault();
  (event.shiftKey ? last : first).focus();
}
