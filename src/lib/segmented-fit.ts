// SegmentedControl's one-row-or-stacked decision, from measurements that do not depend on which
// layout is showing: each label's own text width and the control's per-segment chrome.

export interface SegmentChrome {
  /** Left plus right padding of one segment. */
  paddingX: number;
  /** One border line; joined segments share the line between them. */
  border: number;
}

/** Subpixel text widths can sum a hair over the box they were laid out in. */
const TOLERANCE = 0.5;

/** The width all segments need side by side on one line, labels unwrapped. */
export function oneRowWidth(labelWidths: number[], chrome: SegmentChrome) {
  if (!labelWidths.length) return 0;
  const content = labelWidths.reduce(
    (sum, width) => sum + width + chrome.paddingX,
    0,
  );
  return content + (labelWidths.length + 1) * chrome.border;
}

/** Whether a one-row control of `rowWidth` fits the `available` width. */
export function fitsOneRow(rowWidth: number, available: number) {
  return rowWidth <= available + TOLERANCE;
}
