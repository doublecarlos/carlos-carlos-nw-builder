/**
 * Tells a real pointer move apart from a menu scrolling under a still pointer. Arrow keys scroll
 * a dropdown to keep its highlighted row in view, and the browser reports the row sliding
 * beneath the pointer as a hover; a row that takes the highlight on that steals it back from the
 * keyboard. Rows listen to `mousemove` and pass each event here; only a changed position counts.
 */
export function createPointerMoveFilter() {
  let last: { x: number; y: number } | null = null;
  return (event: MouseEvent): boolean => {
    const { clientX: x, clientY: y } = event;
    if (last?.x === x && last.y === y) return false;
    last = { x, y };
    return true;
  };
}
