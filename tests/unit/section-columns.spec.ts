import { describe, expect, it } from "vitest";
import {
  PHONE_SECTION_COLUMNS,
  sectionColumns,
} from "../../src/lib/section-columns";

/** The template's named lines. Rows place by these alone, so every template must define the
 *  same ones or a row lands in an implicit track. */
function lineNames(template: string): Set<string> {
  return new Set(
    [...template.matchAll(/\[([^\]]+)\]/g)].flatMap((m) =>
      m[1]!.trim().split(/\s+/),
    ),
  );
}

describe("sectionColumns", () => {
  it("sizes a point section's stepper columns to their content", () => {
    // The steppers must neither wrap nor stretch.
    expect(sectionColumns(3)).toMatch(/max-content/);
  });

  it("gives other sections one shrinking controls track", () => {
    // A long picker summary truncates instead of widening the section.
    expect(sectionColumns(0)).toMatch(/minmax\(0,\s*1fr\)/);
    expect(sectionColumns(0)).not.toMatch(/max-content/);
  });

  it("names the same lines in every template, the phone's included", () => {
    const names = new Set([
      "label-start",
      "label-end",
      "controls-start",
      "controls-end",
    ]);
    for (const template of [
      sectionColumns(0),
      sectionColumns(4),
      PHONE_SECTION_COLUMNS,
    ])
      expect(lineNames(template)).toEqual(names);
  });
});
