// Defers work until the browser has painted whatever the current task leaves behind. A frame
// callback runs just before that paint, so the work sits one macrotask behind it: the frame
// paints, then the callback runs.

/** Runs `fn` after the next paint. Where frames do not exist (node, unit tests) `fn` runs
 *  right away, so callers keep synchronous semantics there. */
export function afterPaint(fn: () => void): void {
  if (typeof requestAnimationFrame !== "function") {
    fn();
    return;
  }
  requestAnimationFrame(() => setTimeout(fn, 0));
}
