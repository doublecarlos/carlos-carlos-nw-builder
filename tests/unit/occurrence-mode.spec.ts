// Coverage for lib/occurrence-mode.ts: which mode an OccurrenceDraft reads as, what each mode
// switch carries over, the per-mode field writes, and the collapsed-card summary chip.
import { describe, it, expect } from "vitest";
import {
  OCCURRENCE_MODES,
  isPlainOccurrence,
  occurrenceDefaultOn,
  occurrenceDraftForMode,
  occurrenceModeOf,
  occurrenceModeSpec,
  occurrenceSummary,
  withOccurrenceDefaultOn,
  withOccurrenceLabel,
} from "../../src/lib/occurrence-mode";
import type { OccurrenceDraft } from "../../src/lib/item-draft";

const fixed3: OccurrenceDraft = { min: 3, max: 3, default: 3, label: "" };
const toggleOn: OccurrenceDraft = { min: 0, max: 1, default: 1, label: "" };
const range: OccurrenceDraft = { min: 0, max: 5, default: 2, label: "Stacks" };

describe("occurrenceModeOf", () => {
  it("reads a plain attachment and a min === max config as fixed", () => {
    expect(occurrenceModeOf(null)).toBe("fixed");
    expect(occurrenceModeOf(fixed3)).toBe("fixed");
    expect(occurrenceModeOf({ ...fixed3, min: "", max: "" })).toBe("fixed");
  });

  it("reads a 0..1 range as toggle and anything wider as range", () => {
    expect(occurrenceModeOf(toggleOn)).toBe("toggle");
    expect(occurrenceModeOf({ ...toggleOn, default: 0 })).toBe("toggle");
    expect(occurrenceModeOf(range)).toBe("range");
    expect(occurrenceModeOf({ ...range, min: "", max: 2 })).toBe("range");
  });

  it("orders the mode table fixed, toggle, range", () => {
    expect(OCCURRENCE_MODES.map((spec) => spec.value)).toEqual([
      "fixed",
      "toggle",
      "range",
    ]);
  });
});

describe("occurrenceDraftForMode", () => {
  it("switching to fixed takes the default, else the min, as the count and drops the label", () => {
    expect(occurrenceDraftForMode(range, "fixed")).toEqual({
      min: 2,
      max: 2,
      default: 2,
      label: "",
    });
    expect(occurrenceDraftForMode({ ...range, default: "" }, "fixed")).toEqual({
      min: 0,
      max: 0,
      default: 0,
      label: "",
    });
  });

  it("switching a plain attachment to fixed stays plain, and a labeled toggle at 1 becomes plain", () => {
    expect(occurrenceDraftForMode(null, "fixed")).toBeNull();
    expect(
      occurrenceDraftForMode({ ...toggleOn, label: "Stacks" }, "fixed"),
    ).toBeNull();
  });

  it("switching to toggle clamps the default to on/off and keeps the label", () => {
    expect(occurrenceDraftForMode(null, "toggle")).toEqual(toggleOn);
    expect(occurrenceDraftForMode(range, "toggle")).toEqual({
      min: 0,
      max: 1,
      default: 1,
      label: "Stacks",
    });
    expect(occurrenceDraftForMode({ ...range, default: 0 }, "toggle")).toEqual({
      min: 0,
      max: 1,
      default: 0,
      label: "Stacks",
    });
  });

  it("switching to range keeps the bounds, reading a plain attachment as 1..1", () => {
    expect(occurrenceDraftForMode(null, "range")).toEqual({
      min: 1,
      max: 1,
      default: 1,
      label: "",
    });
    expect(occurrenceDraftForMode(fixed3, "range")).toEqual(fixed3);
    expect(occurrenceDraftForMode(toggleOn, "range")).toEqual(toggleOn);
  });
});

describe("field writes", () => {
  const count = occurrenceModeSpec("fixed").numberFields[0];
  const [min, max] = occurrenceModeSpec("range").numberFields;

  it("Fixed's Count reads 1 for a plain attachment and writes all three bounds", () => {
    expect(count.read(null)).toBe(1);
    expect(count.read(fixed3)).toBe(3);
    expect(count.write(null, 4)).toEqual({
      min: 4,
      max: 4,
      default: 4,
      label: "",
    });
  });

  it("a Count of 1 collapses back to a plain attachment, whatever label the draft held", () => {
    expect(count.write(fixed3, 1)).toBeNull();
    expect(count.write({ ...fixed3, label: "Stacks" }, 1)).toBeNull();
  });

  it("a cleared Count is kept as cleared rather than read as 0 or 1", () => {
    expect(count.write(fixed3, "")).toEqual({
      min: "",
      max: "",
      default: "",
      label: "",
    });
  });

  it("Range's fields write one bound each", () => {
    expect(min.write(range, 1)).toEqual({ ...range, min: 1 });
    expect(max.write(range, 9)).toEqual({ ...range, max: 9 });
  });

  it("the toggle's default is on at 1 and off at 0", () => {
    expect(occurrenceDefaultOn(toggleOn)).toBe(true);
    expect(occurrenceDefaultOn({ ...toggleOn, default: 0 })).toBe(false);
    expect(withOccurrenceDefaultOn(toggleOn, false)).toEqual({
      ...toggleOn,
      default: 0,
    });
  });

  it("the label write leaves the bounds alone", () => {
    expect(withOccurrenceLabel(range, "Procs")).toEqual({
      ...range,
      label: "Procs",
    });
    expect(withOccurrenceLabel(null, "Procs")).toEqual({
      min: 1,
      max: 1,
      default: 1,
      label: "Procs",
    });
  });
});

describe("isPlainOccurrence", () => {
  it("is true only for a fixed count of 1 with no label", () => {
    expect(isPlainOccurrence(null)).toBe(false);
    expect(
      isPlainOccurrence({ min: 1, max: "1", default: 1, label: "  " }),
    ).toBe(true);
    expect(isPlainOccurrence({ min: 1, max: 1, default: 1, label: "x" })).toBe(
      false,
    );
    expect(isPlainOccurrence(fixed3)).toBe(false);
  });
});

describe("occurrenceSummary", () => {
  it("names each shape the way the collapsed chip shows it", () => {
    expect(occurrenceSummary(null)).toBe("×1");
    expect(occurrenceSummary(fixed3)).toBe("×3");
    expect(occurrenceSummary(toggleOn)).toBe("toggle");
    expect(occurrenceSummary(range)).toBe("0–5");
  });
});
