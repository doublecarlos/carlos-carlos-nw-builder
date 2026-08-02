/**
 * Shared by `useHoverCard` (suppress the card while a real control is being edited) and
 * `useUndoRedoKeys` (don't hijack Ctrl+Z in a text field) -- both need the same "is this
 * actually a form control, not just something focusable" test, and having it drift into two
 * separate copies is exactly how BuildEditor.vue's hover card ended up suppressed forever:
 * `.slot-row`/`.section-head` receive programmatic focus whenever the keyboard cursor moves,
 * which is not "editing" in the sense either caller means.
 */
export function isFormControl(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    (el as HTMLElement).isContentEditable
  );
}
