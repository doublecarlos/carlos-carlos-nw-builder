// Coverage for lib/tag-draft.ts: a declaration round-trips, a blank label is left out, and a
// new draft counts as content once it names a tag or a label.
import { describe, it, expect } from "vitest";
import {
  buildDraft,
  toTag,
  diffLabel,
  hasContent,
  tagIdOf,
} from "../../src/lib/tag-draft";
import type { TagDef } from "../../src/types";

describe("buildDraft / toTag", () => {
  it("round-trips a labeled tag", () => {
    const tag: TagDef = { id: "gem:jade", label: "Jade enchantment" };
    expect(toTag(buildDraft(tag), { id: tag.id })).toEqual(tag);
  });

  // An unlabeled tag shows its id, so a cleared label must not be saved as "".
  it("drops a blank label", () => {
    const draft = { ...buildDraft({ id: "gem:jade", label: "Jade" }) };
    draft.label = "  ";
    expect(toTag(draft, { id: "gem:jade" })).toEqual({ id: "gem:jade" });
  });

  it("trims a typed tag without touching its inner text", () => {
    expect(tagIdOf("  gem:rubellite tourmaline ")).toBe(
      "gem:rubellite tourmaline",
    );
  });
});

describe("hasContent", () => {
  it("is false for a blank draft and true once a tag or label is typed", () => {
    expect(hasContent(buildDraft(null))).toBe(false);
    expect(hasContent({ name: "gem:jade", label: "" })).toBe(true);
    expect(hasContent({ name: "", label: "Jade" })).toBe(true);
  });
});

describe("diffLabel", () => {
  it("names a label edit", () => {
    expect(
      diffLabel(
        JSON.stringify({ id: "gem:jade" }),
        JSON.stringify({ id: "gem:jade", label: "Jade" }),
      ),
    ).toContain("label");
  });
});
