// Column templates for a build section's body grid. Rows reuse its tracks through subgrid and
// place their parts by the named lines alone, `label` and `controls`, so a phone swaps only the
// body's template and every row level follows without a phone rule of its own.

/** The label column's width beside the controls. */
const LABEL_WIDTH = "11rem";

/** The desktop template. A point section adds one max-content track per stepper column plus a
 *  trailing filler, so the steppers neither wrap nor stretch and a picker still fills the
 *  width; other sections get one shrinking track that truncates a long picker summary. */
export function sectionColumns(assignmentColumns: number): string {
  const controls =
    assignmentColumns > 0
      ? `repeat(${assignmentColumns}, max-content) 1fr`
      : "minmax(0, 1fr)";
  return `[label-start] ${LABEL_WIDTH} [label-end controls-start] ${controls} [controls-end]`;
}

/** The phone template: one track, with the label stacked over its controls. */
export const PHONE_SECTION_COLUMNS =
  "[label-start controls-start] minmax(0, 1fr) [label-end controls-end]";
