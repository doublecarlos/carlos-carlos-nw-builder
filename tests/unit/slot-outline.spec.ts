// Coverage for lib/slot-outline.ts and `catalog.removeSectionMembers`, the cascade a section
// delete offers.
import { describe, it, expect } from "vitest";
import * as catalog from "../../src/data/catalog";
import * as db from "../../src/data/db";
import { NW_SCHEMA } from "../../src/data/data";
import {
  buildOutline,
  filterOutline,
  outlineRows,
  ORPHAN_LABEL,
} from "../../src/lib/slot-outline";
import type {
  CatalogOverlay,
  Item,
  SectionPreset,
  Slot,
  SlotSection,
} from "../../src/types";

const section = (id: string, slotIds: string[] = []): SlotSection => ({
  id,
  label: id.toUpperCase(),
  slotIds,
});

const picker = (id: string, sectionId: string): Slot => ({
  id,
  label: id,
  section: sectionId,
  type: "item_picker",
  filter: "gear",
});

const preset = (id: string, sectionId: string): SectionPreset => ({
  id,
  label: id,
  section: sectionId,
});

const items: Item[] = [{ id: "helm", name: "Helm", filter: "gear" }];

function outlineOf(
  sections: SlotSection[],
  slots: Slot[],
  presets: SectionPreset[],
  overlay: CatalogOverlay = catalog.emptyOverlay(),
) {
  const testDb = db.build(items, [], NW_SCHEMA, { sections, slots, presets });
  return buildOutline(testDb, overlay);
}

describe("buildOutline", () => {
  it("groups slots and presets under their own section, in layout order", () => {
    const groups = outlineOf(
      [section("gear"), section("boons")],
      [picker("gear.head", "gear"), picker("boons.a", "boons")],
      [preset("p1", "boons")],
    );
    expect(groups.map((group) => group.label)).toEqual(["GEAR", "BOONS"]);
    expect(groups[0].slots.map((row) => row.key)).toEqual(["gear.head"]);
    expect(groups[0].presets).toEqual([]);
    expect(groups[1].presets.map((row) => row.key)).toEqual(["p1"]);
  });

  it("shows a slot's type as its secondary column", () => {
    const groups = outlineOf(
      [section("gear")],
      [picker("gear.head", "gear")],
      [],
    );
    expect(groups[0].slots[0].detail).toBe("item_picker");
  });

  it("collects rows whose section does not exist into a trailing bucket", () => {
    const groups = outlineOf(
      [section("gear")],
      [picker("gear.head", "gear"), picker("ghost.a", "ghost")],
      [preset("p1", "ghost")],
    );
    const orphans = groups[groups.length - 1];
    expect(orphans.section).toBeNull();
    expect(orphans.label).toBe(ORPHAN_LABEL);
    expect(orphans.slots.map((row) => row.key)).toEqual(["ghost.a"]);
    expect(orphans.presets.map((row) => row.key)).toEqual(["p1"]);
  });

  it("marks an overlay-added section and slot as added", () => {
    const overlay: CatalogOverlay = {
      ...catalog.emptyOverlay(),
      sections: { extra: section("extra") },
      slots: { "extra.a": picker("extra.a", "extra") },
    };
    const groups = outlineOf(
      [section("extra")],
      [picker("extra.a", "extra")],
      [],
      overlay,
    );
    expect(groups[0].section?.status).toBe("added");
    expect(groups[0].slots[0].status).toBe("added");
  });
});

describe("filterOutline", () => {
  const groups = () =>
    outlineOf(
      [section("gear"), section("boons")],
      [picker("gear.head", "gear"), picker("boons.a", "boons")],
      [preset("boonPreset", "boons")],
    );

  it("keeps the heading of a matching row while dropping the rest", () => {
    const filtered = filterOutline(groups(), {
      query: "gear.head",
      status: "all",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].label).toBe("GEAR");
    expect(filtered[0].slots.map((row) => row.key)).toEqual(["gear.head"]);
  });

  it("keeps a section whose own name matches, with no children", () => {
    const only = outlineOf([section("gear")], [picker("helmet", "gear")], []);
    const filtered = filterOutline(only, { query: "GEAR", status: "all" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].slots).toEqual([]);
  });

  it("drops everything on a status filter nothing satisfies", () => {
    expect(filterOutline(groups(), { query: "", status: "added" })).toEqual([]);
  });
});

describe("outlineRows", () => {
  it("flattens section, then slots, then presets, top to bottom", () => {
    const groups = outlineOf(
      [section("gear"), section("boons")],
      [picker("gear.head", "gear"), picker("boons.a", "boons")],
      [preset("p1", "boons")],
    );
    expect(outlineRows(groups).map((row) => row.key)).toEqual([
      "gear",
      "gear.head",
      "boons",
      "boons.a",
      "p1",
    ]);
  });
});

describe("removeSectionMembers", () => {
  it("drops only the named section's own slots and presets", () => {
    // Ids nothing ships, so `remove` drops the entry outright instead of tombstoning a base
    // one; the point here is which entries it touches, not how it hides them.
    const slots = [picker("mine.a", "mine"), picker("other.b", "other")];
    const presets = [preset("mineP", "mine"), preset("otherP", "other")];
    let overlay = catalog.emptyOverlay();
    for (const slot of slots)
      overlay = catalog.upsert(overlay, "slots", slot.id, slot);
    for (const entry of presets)
      overlay = catalog.upsert(overlay, "sectionPresets", entry.id, entry);

    const next = catalog.removeSectionMembers(overlay, slots, presets, "mine");
    expect(Object.keys(next.slots)).toEqual(["other.b"]);
    expect(Object.keys(next.sectionPresets)).toEqual(["otherP"]);
  });
});
