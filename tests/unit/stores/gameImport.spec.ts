// Tests for stores/gameImport.ts's mapUnrecognisedItem (#177): mapping an unrecognised game id
// onto a catalogue item, in a layer overlay, and re-resolving the committed build in place.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { installWindowShim } from "./window-shim";

const fixture = readFileSync(
  join(__dirname, "../fixtures/build-export.demo.txt"),
  "utf-8",
);

/** One loadout carrying the same `Hitem` in the OffenseGem and DefenseGem bags -- the shape an
 *  in-game enchantment takes when its stats depend on the slot it sits in. */
const sharedGameIdFixture = readFileSync(
  join(__dirname, "../fixtures/build-export-shared-gameid.demo.txt"),
  "utf-8",
);

async function freshStores() {
  vi.resetModules();
  installWindowShim();
  const gameImport = await import("../../../src/stores/gameImport");
  const builds = await import("../../../src/stores/builds");
  const layers = await import("../../../src/stores/layers");
  const resolved = await import("../../../src/stores/resolved");
  builds._setLoading(false);
  layers._setLoading(false);
  return { gameImport, builds, layers, resolved };
}

/** Imports the shared fixture's active loadout ("1. DPS ST") and returns the committed report
 *  index plus the outcome index of its `Head_M31_Heavyheal_S-tier` unrecognised row. */
function commitFixture(
  gameImport: Awaited<ReturnType<typeof freshStores>>["gameImport"],
) {
  gameImport.parseFile(fixture);
  gameImport.commit();
  const report = gameImport.reports.value[0].report;
  const outcomeIndex = report.outcomes.findIndex(
    (o) =>
      o.kind === "unrecognised" && o.gameId === "Head_M31_Heavyheal_S-tier",
  );
  return { reportIndex: 0, outcomeIndex };
}

describe("gameImport store: mapUnrecognisedItem", () => {
  it("moves the row to imported, stamps the layer item's gameIds, and equips it", async () => {
    const { gameImport, builds, layers, resolved } = await freshStores();
    const { reportIndex, outcomeIndex } = commitFixture(gameImport);
    expect(outcomeIndex).toBeGreaterThanOrEqual(0);

    const itemId = resolved.db.value.forSlot("gear.head")[0].id;
    const buildId = gameImport.reports.value[reportIndex].buildId;

    gameImport.mapUnrecognisedItem(reportIndex, outcomeIndex, itemId);

    const updated = gameImport.reports.value[reportIndex].report;
    expect(updated.outcomes[outcomeIndex]).toMatchObject({
      kind: "imported",
      slotId: "gear.head",
      itemId,
      gameId: "Head_M31_Heavyheal_S-tier",
    });
    expect(updated.counts.imported).toBeGreaterThanOrEqual(1);

    expect(builds.get(buildId)?.choices["gear.head"]).toBe(itemId);
    expect(resolved.db.value.get(itemId)?.gameIds).toContain(
      "Head_M31_Heavyheal_S-tier",
    );

    const layer = layers.layers.value.find(
      (l) => l.overlay.items[itemId] != null,
    );
    expect(layer?.overlay.items[itemId]?.gameIds).toContain(
      "Head_M31_Heavyheal_S-tier",
    );
  });

  it("does not disturb a slot the user hand-edited on the build after commit", async () => {
    const { gameImport, builds, resolved } = await freshStores();
    const { reportIndex, outcomeIndex } = commitFixture(gameImport);
    const buildId = gameImport.reports.value[reportIndex].buildId;

    const neckItemId = resolved.db.value.forSlot("gear.neck")[0].id;
    builds.setChoiceFor(buildId, "gear.neck", neckItemId, "test hand-edit");

    const itemId = resolved.db.value.forSlot("gear.head")[0].id;
    gameImport.mapUnrecognisedItem(reportIndex, outcomeIndex, itemId);

    expect(builds.get(buildId)?.choices["gear.neck"]).toBe(neckItemId);
  });

  it("does not throw, and still updates the report, once the build has been deleted", async () => {
    const { gameImport, builds, resolved } = await freshStores();
    const { reportIndex, outcomeIndex } = commitFixture(gameImport);
    const buildId = gameImport.reports.value[reportIndex].buildId;
    builds.deleteBuild(buildId);

    const itemId = resolved.db.value.forSlot("gear.head")[0].id;
    expect(() =>
      gameImport.mapUnrecognisedItem(reportIndex, outcomeIndex, itemId),
    ).not.toThrow();

    expect(
      gameImport.reports.value[reportIndex].report.outcomes[outcomeIndex].kind,
    ).toBe("imported");
    expect(builds.get(buildId)).toBeUndefined();
  });

  it("keeps the row's origin around after mapping, so it can be found and re-mapped", async () => {
    const { gameImport, resolved } = await freshStores();
    const { reportIndex, outcomeIndex } = commitFixture(gameImport);
    const itemId = resolved.db.value.forSlot("gear.head")[0].id;

    gameImport.mapUnrecognisedItem(reportIndex, outcomeIndex, itemId);

    expect(
      gameImport.reports.value[reportIndex].unrecognisedOrigin.get(
        outcomeIndex,
      ),
    ).toEqual({ bag: "Head", slot: expect.any(Number) });
  });

  it("re-mapping to a different item retracts the game id from the previous one", async () => {
    const { gameImport, resolved } = await freshStores();
    const { reportIndex, outcomeIndex } = commitFixture(gameImport);
    const [firstItemId, secondItemId] = resolved.db.value
      .forSlot("gear.head")
      .map((item) => item.id);
    expect(secondItemId).toBeDefined();

    gameImport.mapUnrecognisedItem(reportIndex, outcomeIndex, firstItemId);
    expect(resolved.db.value.get(firstItemId)?.gameIds).toContain(
      "Head_M31_Heavyheal_S-tier",
    );

    gameImport.mapUnrecognisedItem(reportIndex, outcomeIndex, secondItemId);

    expect(resolved.db.value.get(firstItemId)?.gameIds ?? []).not.toContain(
      "Head_M31_Heavyheal_S-tier",
    );
    expect(resolved.db.value.get(secondItemId)?.gameIds).toContain(
      "Head_M31_Heavyheal_S-tier",
    );
    expect(
      gameImport.reports.value[reportIndex].report.outcomes[outcomeIndex],
    ).toMatchObject({ kind: "imported", itemId: secondItemId });
  });

  it("mapping one game id onto a second filter's form leaves the first form's claim alone", async () => {
    // Retraction is scoped to the new item's own filter: the offense and defense forms of one
    // in-game enchantment are both legitimate claimants, not a mapping being corrected.
    const { gameImport, resolved } = await freshStores();
    gameImport.parseFile(sharedGameIdFixture);
    gameImport.commit();

    const report = gameImport.reports.value[0].report;
    const rowFor = (bag: string) =>
      report.outcomes.findIndex(
        (o) => o.kind === "unrecognised" && o.bag === bag,
      );
    const offenseRow = rowFor("OffenseGem");
    const defenseRow = rowFor("DefenseGem");
    expect(offenseRow).toBeGreaterThanOrEqual(0);
    expect(defenseRow).toBeGreaterThanOrEqual(0);

    const offenseItem = resolved.db.value.forSlot("enchantments.offense1")[0]
      .id;
    const defenseItem = resolved.db.value.forSlot("enchantments.defense1")[0]
      .id;

    gameImport.mapUnrecognisedItem(0, offenseRow, offenseItem);
    gameImport.mapUnrecognisedItem(0, defenseRow, defenseItem);

    expect(resolved.db.value.get(offenseItem)?.gameIds).toContain(
      "Enchantment_Shared_Test",
    );
    expect(resolved.db.value.get(defenseItem)?.gameIds).toContain(
      "Enchantment_Shared_Test",
    );

    const updated = gameImport.reports.value[0].report;
    expect(updated.outcomes[offenseRow]).toMatchObject({
      kind: "imported",
      slotId: "enchantments.offense1",
      itemId: offenseItem,
    });
    expect(updated.outcomes[defenseRow]).toMatchObject({
      kind: "imported",
      slotId: "enchantments.defense1",
      itemId: defenseItem,
    });
  });
});
