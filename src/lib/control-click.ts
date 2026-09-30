/** Whether a click on a header landed on one of its controls rather than its inert area. Reads
 *  the event's path rather than `target.closest`: a control that re-renders on click has
 *  already detached the target. */
export function clickedControl(event: MouseEvent): boolean {
  for (const node of event.composedPath()) {
    if (node === event.currentTarget) return false;
    if (
      node instanceof Element &&
      node.matches("button, a, input, label, select, textarea")
    )
      return true;
  }
  return false;
}
