// Nested slots: the layout keeps a child right after its parent, moves carry children along,
// and lint rejects a parent the layout cannot honor.
import { describe, expect, it } from "vitest";
import * as catalog from "../../src/data/catalog";
import { NW_BONUSES, NW_ITEMS, NW_SLOTS } from "../../src/data/data";
import {
  groupUnderParents,
  nestedParentId,
  stepIndex,
} from "../../src/lib/slot-parent";
import type { Item, ItemPickerSlot, Slot, SlotSection } from "../../src/types";

const picker = (
  id: string,
  extra: Partial<ItemPickerSlot> = {},
): ItemPickerSlot => ({
  id,
  label: id,
  section: "gear",
  type: "item_picker",
  filter: id,
  ...extra,
});

const section = (slotIds: string[]): SlotSection => ({
  id: "gear",
  label: "Gear",
  slotIds,
});

const ids = (slots: Slot[]) => slots.map((slot) => slot.id);

// a, p (children c1, c2), b, q (child d1)
const a = picker("a");
const p = picker("p");
const c1 = picker("c1", { parent: "p" });
const c2 = picker("c2", { parent: "p" });
const b = picker("b");
const q = picker("q");
const d1 = picker("d1", { parent: "q" });
const members = [a, p, c1, c2, b, q, d1];

describe("nestedParentId", () => {
  const byId = new Map<string, Slot>(members.map((slot) => [slot.id, slot]));

  it("names the parent of a nested slot only", () => {
    expect(nestedParentId(c1, byId)).toBe("p");
    expect(nestedParentId(p, byId)).toBeUndefined();
  });

  it("ignores a parent the slot cannot nest under", () => {
    const other = picker("other", { section: "options" });
    const nested = picker("nested", { parent: "c1" });
    const cases: [Slot, Slot][] = [
      [picker("x", { parent: "other" }), other],
      [nested, nested],
      [picker("y", { parent: "c1" }), c1],
    ];
    for (const [slot, parent] of cases) {
      const map = new Map<string, Slot>([...byId, [parent.id, parent]]);
      expect(nestedParentId(slot, map)).toBeUndefined();
    }
  });
});

describe("groupUnderParents", () => {
  it("pulls children right after their parent, keeping their order", () => {
    expect(ids(groupUnderParents([c2, a, d1, p, b, c1, q]))).toEqual([
      "a",
      "p",
      "c2",
      "c1",
      "b",
      "q",
      "d1",
    ]);
  });

  it("leaves a child whose parent is missing where it is", () => {
    expect(ids(groupUnderParents([c1, a]))).toEqual(["c1", "a"]);
  });
});

describe("compose places nested slots after their parent", () => {
  it("keeps the shipped gear mods under their gear pieces", () => {
    const gear = catalog
      .compose([])
      .slots.filter((slot) => slot.section === "gear")
      .map((slot) => slot.id);
    const at = (id: string) => gear.indexOf(id);
    expect(at("gear.headMod")).toBe(at("gear.head") + 2);
    expect(at("gear.armorMod")).toBe(at("gear.armor") + 2);
    expect(at("gear.armsMod")).toBe(at("gear.arms") + 2);
    expect(at("gear.mainhandMod")).toBe(at("gear.mainhand") + 1);
    expect(at("gear.offhandMod1")).toBe(at("gear.offhand") + 1);
    expect(at("gear.offhandMod2")).toBe(at("gear.offhand") + 2);
    expect(at("gear.bootsMod")).toBe(at("gear.boots") + 2);
  });

  it("regroups a child that a layer orders elsewhere", () => {
    const gear = NW_SLOTS.sections.find((entry) => entry.id === "gear")!;
    const reordered = [
      "gear.mainhandMod",
      ...gear.slotIds.filter((id) => id !== "gear.mainhandMod"),
    ];
    const composed = catalog.compose([
      {
        ...catalog.emptyOverlay(),
        sections: { gear: { ...gear, slotIds: reordered } },
      },
    ]);
    const gearIds = ids(composed.slots.filter((s) => s.section === "gear"));
    expect(gearIds.indexOf("gear.mainhandMod")).toBe(
      gearIds.indexOf("gear.mainhand") + 1,
    );
  });
});

describe("stepIndex", () => {
  it("steps a parent over its own children", () => {
    expect(stepIndex(members, "p", 1)).toBe(4);
    expect(stepIndex(members, "p", -1)).toBe(0);
  });

  it("keeps a nested slot among its siblings", () => {
    expect(stepIndex(members, "c1", -1)).toBeNull();
    expect(stepIndex(members, "c1", 1)).toBe(3);
    expect(stepIndex(members, "c2", 1)).toBeNull();
    expect(stepIndex(members, "d1", 1)).toBeNull();
  });

  it("stops at either end of the section", () => {
    expect(stepIndex(members, "a", -1)).toBeNull();
    expect(stepIndex(members, "q", 1)).toBeNull();
    expect(stepIndex(members, "nope", 1)).toBeNull();
  });
});

describe("catalog.moveSlot with nested slots", () => {
  const layout = {
    sections: [
      section(ids(members)),
      { id: "other", label: "Other", slotIds: [] },
    ],
    slots: members,
  };
  const move = (slotId: string, index: number, toSection = "gear") =>
    catalog.moveSlot(catalog.emptyOverlay(), layout, slotId, toSection, index);
  const order = (slotId: string, index: number) =>
    move(slotId, index).sections.gear?.slotIds;

  it("moves a parent together with its children", () => {
    expect(order("p", 6)).toEqual(["a", "b", "q", "d1", "p", "c1", "c2"]);
    expect(order("p", 0)).toEqual(["p", "c1", "c2", "a", "b", "q", "d1"]);
  });

  it("follows a step from stepIndex", () => {
    const down = stepIndex(members, "p", 1)!;
    expect(order("p", down)).toEqual(["a", "b", "p", "c1", "c2", "q", "d1"]);
  });

  it("never drops a slot between another parent and its children", () => {
    // Moving up into p's group lands before p, moving down into it lands after it.
    expect(order("q", 2)).toEqual(["a", "q", "d1", "p", "c1", "c2", "b"]);
    expect(order("a", 2)).toEqual(["p", "c1", "c2", "a", "b", "q", "d1"]);
  });

  it("reorders a nested slot among its siblings only", () => {
    expect(order("c1", 3)).toEqual(["a", "p", "c2", "c1", "b", "q", "d1"]);
    const empty = catalog.emptyOverlay();
    expect(catalog.moveSlot(empty, layout, "c1", "gear", 0)).toBe(empty);
  });

  it("takes the children along to another section, and keeps a child in its own", () => {
    const next = move("p", 0, "other");
    expect(next.sections.other?.slotIds).toEqual(["p", "c1", "c2"]);
    expect(next.sections.gear?.slotIds).toEqual(["a", "b", "q", "d1"]);
    expect(next.slots.c1?.section).toBe("other");
    expect(next.slots.c2?.section).toBe("other");

    const empty = catalog.emptyOverlay();
    expect(catalog.moveSlot(empty, layout, "c1", "other", 0)).toBe(empty);
  });
});

describe("catalog.checkSlotParent", () => {
  const items: Item[] = [
    { id: "relic", name: "Relic", filter: "p", tags: ["artifact"] },
    { id: "gem", name: "Gem", filter: "c1", tags: ["artifact"] },
  ];
  const refs = (slots: Slot[]) => ({ items, bonuses: [], slots });

  it("accepts a well-formed parent", () => {
    expect(catalog.checkSlotParent(c1, refs(members))).toEqual([]);
  });

  it("rejects a parent the layout cannot nest under", () => {
    const param = {
      id: "x",
      label: "X",
      section: "gear",
      type: "build_parameter",
      paramType: "number",
      path: "x",
      parent: "p",
    } as Slot;
    const cases: [Slot, Slot[], string][] = [
      [param, members, "only meaningful on an item_picker"],
      [picker("self", { parent: "self" }), members, "its own parent"],
      [picker("x", { parent: "ghost" }), members, "does not exist"],
      [
        picker("x", { parent: "list" }),
        [
          ...members,
          {
            id: "list",
            label: "List",
            section: "gear",
            type: "item_picker_list",
            filter: "x",
          },
        ],
        "only an item_picker can have nested slots",
      ],
      [
        picker("x", { parent: "p", section: "other" }),
        members,
        'in section "gear"',
      ],
      [picker("x", { parent: "c1" }), members, "nested itself"],
      [picker("p", { parent: "a" }), members, "has nested slots"],
    ];
    for (const [slot, slots, message] of cases)
      expect(catalog.checkSlotParent(slot, refs(slots))).toEqual([
        expect.stringContaining(message),
      ]);
  });

  it("rejects a parent condition the slot's own pick can meet", () => {
    const gated = picker("p", {
      availableWhen: { equipped: { tag: "artifact" } },
    });
    const slots = [a, gated, c1];
    expect(catalog.checkSlotParent(c1, refs(slots))).toEqual([
      expect.stringContaining("own pick"),
    ]);
  });

  it("finds nothing wrong with the shipped slots", () => {
    expect(
      catalog.validateSlotParents({
        items: NW_ITEMS,
        bonuses: NW_BONUSES,
        slots: NW_SLOTS.slots,
      }),
    ).toEqual([]);
  });
});
