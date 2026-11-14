// Coverage for lib/tag-draft.ts: a declaration round-trips, a blank label is left out, a badge
// needs a tone, and a new draft counts as content once it names a tag, a label or a tone.
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

  it("round-trips a badge, with and without its own label", () => {
    const tag: TagDef = {
      id: "companion_power:offense",
      label: "Offense companion power",
      badge: { label: "Offense", tone: "orange" },
    };
    expect(toTag(buildDraft(tag), { id: tag.id })).toEqual(tag);
    const bare: TagDef = { id: "x", badge: { tone: "blue" } };
    expect(toTag(buildDraft(bare), { id: "x" })).toEqual(bare);
  });

  // Clearing the tone removes the badge, so a leftover badge label must not keep one alive.
  it("drops the badge once its tone is cleared", () => {
    const draft = buildDraft({ id: "x", badge: { label: "X", tone: "red" } });
    draft.badgeTone = "";
    expect(toTag(draft, { id: "x" })).toEqual({ id: "x" });
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
    const blank = buildDraft(null);
    expect(hasContent({ ...blank, name: "gem:jade" })).toBe(true);
    expect(hasContent({ ...blank, label: "Jade" })).toBe(true);
    expect(hasContent({ ...blank, badgeTone: "teal" })).toBe(true);
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

  it("names a badge edit", () => {
    expect(
      diffLabel(
        JSON.stringify({ id: "x", badge: { tone: "red" } }),
        JSON.stringify({ id: "x", badge: { tone: "blue" } }),
      ),
    ).toContain("badge");
  });
});
