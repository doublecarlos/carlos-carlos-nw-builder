// SegmentedControl's layout decision, from measurements that do not depend on which layout is
// showing: each label's own text width and the control's per-segment chrome. One row when the
// labels fit side by side, otherwise a grid of equal cells in the fewest rows that fit.

export interface SegmentChrome {
  /** Left plus right padding of one segment. */
  paddingX: number;
  /** One border line. In a row every segment draws both side lines except the last, which
   *  shares its left line with the segment before it. */
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
  return content + (2 * labelWidths.length - 1) * chrome.border;
}

/** Whether a one-row control of `rowWidth` fits the `available` width. */
export function fitsOneRow(rowWidth: number, available: number) {
  return rowWidth <= available + TOLERANCE;
}

/** The width of a grid of `columns` equal cells, each wide enough for the longest label.
 *  Neighboring cells share one border line. */
function gridWidth(
  columns: number,
  widest: number,
  chrome: SegmentChrome,
): number {
  return columns * (widest + chrome.paddingX) + (columns + 1) * chrome.border;
}

/** Columns for the grid an option set falls back to when one row does not fit. The fewest
 *  rows that fit, then the columns spread evenly over them, so four options make two by two
 *  rather than three and one. A single column when even two do not fit. */
export function gridColumns(
  labelWidths: number[],
  chrome: SegmentChrome,
  available: number,
): number {
  const count = labelWidths.length;
  if (count < 2) return 1;
  const widest = Math.max(0, ...labelWidths);
  let fitting = 1;
  for (let columns = count - 1; columns > 1; columns--) {
    if (gridWidth(columns, widest, chrome) <= available + TOLERANCE) {
      fitting = columns;
      break;
    }
  }
  const rows = Math.ceil(count / fitting);
  return Math.ceil(count / rows);
}
