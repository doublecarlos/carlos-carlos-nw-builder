// Coverage for lib/section-draft.ts, mainly that a form edit never changes `slotIds`.
import { describe, it, expect } from "vitest";
import {
  buildDraft,
  hasContent,
  toSection,
  diffLabel,
} from "../../src/lib/section-draft";
import type { SlotSection } from "../../src/types";

describe("buildDraft / toSection round trip", () => {
  it("round-trips a section, order included", () => {
    const section: SlotSection = {
      id: "gear",
      label: "Gear",
      defaultOpen: true,
      slotIds: ["gear.head", "gear.neck"],
    };
    expect(
      toSection(buildDraft(section), {
        id: section.id,
        slotIds: section.slotIds,
      }),
    ).toEqual(section);
  });

  it("reads an absent defaultOpen as open, the way the build editor does", () => {
    const section: SlotSection = { id: "boons", label: "Boons", slotIds: [] };
    expect(buildDraft(section).defaultOpen).toBe(true);
    expect(
      toSection(buildDraft(section), { id: "boons", slotIds: [] }),
    ).toEqual({ ...section, defaultOpen: true });
  });

  it("writes false when unchecked, so a section can start collapsed", () => {
    const draft = buildDraft({
      id: "boons",
      label: "Boons",
      defaultOpen: true,
      slotIds: [],
    });
    draft.defaultOpen = false;
    expect(toSection(draft, { id: "boons", slotIds: [] })).toEqual({
      id: "boons",
      label: "Boons",
      defaultOpen: false,
      slotIds: [],
    });
  });

  it("carries the order from the context, never from the draft", () => {
    const section: SlotSection = {
      id: "gear",
      label: "Gear",
      defaultOpen: true,
      slotIds: ["gear.head"],
    };
    const draft = buildDraft(section);
    draft.label = "Equipment";
    expect(
      toSection(draft, { id: "gear", slotIds: ["gear.neck", "gear.head"] }),
    ).toEqual({
      id: "gear",
      label: "Equipment",
      defaultOpen: true,
      slotIds: ["gear.neck", "gear.head"],
    });
  });

  it("trims the label and starts a brand-new section open, with no slots", () => {
    const draft = buildDraft(null);
    draft.label = "  New group  ";
    expect(toSection(draft, { id: "new-group", slotIds: [] })).toEqual({
      id: "new-group",
      label: "New group",
      defaultOpen: true,
      slotIds: [],
    });
  });
});

describe("hasContent", () => {
  it("is false for a blank draft and true once a label is typed", () => {
    const draft = buildDraft(null);
    expect(hasContent(draft)).toBe(false);
    draft.label = "Boons";
    expect(hasContent(draft)).toBe(true);
  });
});

describe("diffLabel", () => {
  const base: SlotSection = { id: "gear", label: "Gear", slotIds: [] };

  it("labels a label change", () => {
    const nw = { ...base, label: "Equipment" };
    expect(diffLabel(JSON.stringify(base), JSON.stringify(nw))).toBe(
      'edit label to "Equipment"',
    );
  });

  it("labels the open/closed change both ways", () => {
    const opened = { ...base, defaultOpen: true };
    expect(diffLabel(JSON.stringify(base), JSON.stringify(opened))).toBe(
      "expand by default",
    );
    expect(diffLabel(JSON.stringify(opened), JSON.stringify(base))).toBe(
      "collapse by default",
    );
  });

  it("labels a reorder", () => {
    const nw = { ...base, slotIds: ["gear.head"] };
    expect(diffLabel(JSON.stringify(base), JSON.stringify(nw))).toBe(
      "reorder slots",
    );
  });

  it("falls back to the generic label when nothing recognized changed", () => {
    expect(diffLabel(JSON.stringify(base), JSON.stringify(base))).toBe(
      "edit section",
    );
  });
});
