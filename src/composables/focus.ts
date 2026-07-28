/**
 * Shared by `useHoverCard` (suppress the card while a real control is being edited) and
 * `useKeyboardCursor` (the passive gate: arrow/type-to-edit only fires when nothing has
 * already claimed the keyboard) -- both need the same "is this actually a form control, not
 * just something focusable" test, and having it drift into two separate copies is exactly how
 * SlotList.vue's hover card ended up suppressed forever: `.slot-row`/`.section-head` are
 * `tabindex="-1"` and receive real DOM focus themselves whenever the keyboard cursor moves,
 * which is not "editing" in the sense either caller means.
 */
export function isFormControl(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (el as HTMLElement).isContentEditable;
}
