// Coverage for lib/tag-badges.ts: which badges an item card shows and what each reads.
import { describe, it, expect } from "vitest";
import { itemBadges } from "../../src/lib/tag-badges";
import type { Item, TagDef } from "../../src/types";

const tags: TagDef[] = [
  { id: "role:a", label: "A role", badge: { label: "A", tone: "orange" } },
  { id: "role:b", label: "B role", badge: { tone: "blue" } },
  { id: "role:c", badge: { tone: "green" } },
  { id: "plain", label: "Plain" },
];

describe("itemBadges", () => {
  // Cards read the same only if badges keep the item's own tag order.
  it("gives one badge per badged tag, in the item's tag order", () => {
    const item: Item = {
      id: "x",
      name: "X",
      tags: ["role:c", "plain", "untagged", "role:a"],
    };
    expect(itemBadges(item, tags).map((badge) => badge.tag)).toEqual([
      "role:c",
      "role:a",
    ]);
  });

  it("reads the badge label, then the tag label, then the raw tag", () => {
    const item: Item = {
      id: "x",
      name: "X",
      tags: ["role:a", "role:b", "role:c"],
    };
    expect(itemBadges(item, tags).map((badge) => badge.label)).toEqual([
      "A",
      "B role",
      "role:c",
    ]);
  });
});
