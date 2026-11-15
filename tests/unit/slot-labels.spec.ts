// A slot without a label of its own reads its category's label, so slots.json need not repeat
// it. The fill is a read-side concern: authored data and exports keep the slot unlabeled.
import { describe, it, expect } from "vitest";
import * as catalog from "../../src/data/catalog";
import * as catalogExport from "../../src/data/catalogExport";
import * as db from "../../src/data/db";
import { NW_SCHEMA } from "../../src/data/data";
import { rowSlotId } from "../../src/lib/item-picker-list";
import type { AuthoredSlot, FilterDef, SlotSection } from "../../src/types";

const sections: SlotSection[] = [{ id: "gear", label: "Gear", slotIds: [] }];
const filters: FilterDef[] = [
  { id: "gear_ring", label: "Ring" },
  { id: "plain" },
];
const slots: AuthoredSlot[] = [
  {
    id: "gear.ring",
    section: "gear",
    type: "item_picker",
    filter: "gear_ring",
  },
  {
    id: "gear.ring2",
    label: "Ring 2",
    section: "gear",
    type: "item_picker",
    filter: "gear_ring",
  },
  { id: "gear.plain", section: "gear", type: "item_picker", filter: "plain" },
  {
    id: "gear.rings",
    section: "gear",
    type: "item_picker_list",
    filter: "gear_ring",
  },
];
const built = db.build([], [], NW_SCHEMA, { sections, slots }, filters);

describe("slot labels from categories", () => {
  it("fills an unlabeled slot from its category's label", () => {
    expect(built.slotFor("gear.ring")?.label).toBe("Ring");
  });

  it("keeps an authored label over the category's", () => {
    expect(built.slotFor("gear.ring2")?.label).toBe("Ring 2");
  });

  it("reads as its id when the category has no label either", () => {
    expect(built.slotFor("gear.plain")?.label).toBe("gear.plain");
  });

  // A list's rows and its add button read the container's label, so they follow the fill.
  it("names an unlabeled list's rows after its category", () => {
    expect(built.slotFor(rowSlotId("gear.rings", 2))?.label).toBe("Ring 2");
  });

  it("leaves the authored slots unlabeled for the write side", () => {
    expect(
      built.authoredSlots.find((slot) => slot.id === "gear.ring")?.label,
    ).toBeUndefined();
  });

  it("exports an unlabeled slot without a label", () => {
    const parsed = JSON.parse(
      catalogExport.toSlotsFile(sections, built.authoredSlots, []),
    );
    const ring = parsed.sections[0].slots.find(
      (slot: { id: string }) => slot.id === "gear.ring",
    );
    expect(ring).not.toHaveProperty("label");
  });
});

describe("catalog.validateSlotLabels", () => {
  it("warns on a slot with neither a label nor a labeled category", () => {
    const findings = catalog.validateSlotLabels(slots, filters);
    expect(findings.map((finding) => [finding.level, finding.name])).toEqual([
      ["warn", "gear.plain"],
    ]);
  });

  it("does not warn on a separator, which shows no label", () => {
    expect(
      catalog.validateSlotLabels(
        [{ id: "gear.sep", section: "gear", type: "separator" }],
        [],
      ),
    ).toEqual([]);
  });
});

describe("catalog.validateSlots", () => {
  // A rowLabel names a row, so a type that renders none has nothing to name.
  it("rejects a row label on a slot that shows no row", () => {
    const findings = catalog.validateSlots([
      {
        id: "gear.sep",
        section: "gear",
        type: "separator",
        rowLabel: "Defense",
      } as unknown as AuthoredSlot,
    ]);
    expect(findings.map((finding) => finding.message).join(" ")).toMatch(
      /rowLabel is only meaningful on a row slot/,
    );
  });
});
