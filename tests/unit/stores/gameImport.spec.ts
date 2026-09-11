// Tests for stores/gameImport.ts's mapUnrecognizedItem: mapping an unrecognized game id
// onto a catalog item, in a layer overlay, and re-resolving the committed build in place.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as catalog from "../../../src/data/catalog";
import type { Item } from "../../../src/types";

const fixture = readFileSync(
  join(__dirname, "../fixtures/build-export.demo.txt"),
  "utf-8",
);

/** One loadout carrying the same `Hitem` in the OffenseGem and DefenseGem bags. */
const sharedGameIdFixture = readFileSync(
  join(__dirname, "../fixtures/build-export-shared-gameid.demo.txt"),
  "utf-8",
);

/** A full companion bar of unmapped ids. Mapping them one at a time is what forces the
 *  re-seating to displace an already-placed pick. */
const companionBarFixture = readFileSync(
  join(__dirname, "../fixtures/build-export-companion-bar.demo.txt"),
  "utf-8",
);

async function freshStores() {
  vi.resetModules();
  // Loaded after `resetModules`: a `setBackend` bound to this file's own import would land on
  // the stale instance and leave the stores without an IndexedDB.
  const { installWindowShim, installIdbShim } = await import("./window-shim");
  installWindowShim();
  installIdbShim();
  const gameImport = await import("../../../src/stores/gameImport");
  const builds = await import("../../../src/stores/builds");
  const layers = await import("../../../src/stores/layers");
  const resolved = await import("../../../src/stores/resolved");
  builds._setLoading(false);
  layers._setLoading(false);
  return { gameImport, builds, layers, resolved };
}

/** Imports the fixture's active loadout and returns its report index plus the outcome index of
 *  the `Head_Heavyheal_Test` row. The fixture's game ids are synthetic, so nothing shipped
 *  resolves that row out from under the test. */
function commitFixture(
  gameImport: Awaited<ReturnType<typeof freshStores>>["gameImport"],
) {
  gameImport.parseFile(fixture);
  gameImport.commit();
  const report = gameImport.reports.value[0].report;
  const outcomeIndex = report.outcomes.findIndex(
    (o) => o.kind === "unrecognized" && o.gameId === "Head_Heavyheal_Test",
  );
  return { reportIndex: 0, outcomeIndex };
}

describe("gameImport store: mapUnrecognizedItem", () => {
  it("moves the row to imported, stamps the layer item's gameIds, and equips it", async () => {
    const { gameImport, builds, layers, resolved } = await freshStores();
    const { reportIndex, outcomeIndex } = commitFixture(gameImport);
    expect(outcomeIndex).toBeGreaterThanOrEqual(0);

    const itemId = resolved.db.value.forSlot("gear.head")[0].id;
    const buildId = gameImport.reports.value[reportIndex].buildId;

    gameImport.mapUnrecognizedItem(reportIndex, outcomeIndex, itemId);

    const updated = gameImport.reports.value[reportIndex].report;
    expect(updated.outcomes[outcomeIndex]).toMatchObject({
      kind: "imported",
      slotId: "gear.head",
      itemId,
      gameId: "Head_Heavyheal_Test",
    });
    expect(updated.counts.imported).toBeGreaterThanOrEqual(1);

    expect(builds.get(buildId)?.choices["gear.head"]).toBe(itemId);
    expect(resolved.db.value.get(itemId)?.gameIds).toContain(
      "Head_Heavyheal_Test",
    );

    const layer = layers.layers.value.find(
      (l) => l.overlay.items[itemId] != null,
    );
    expect(layer?.overlay.items[itemId]?.gameIds).toContain(
      "Head_Heavyheal_Test",
    );
  });

  it("does not disturb a slot the user hand-edited on the build after commit", async () => {
    const { gameImport, builds, resolved } = await freshStores();
    const { reportIndex, outcomeIndex } = commitFixture(gameImport);
    const buildId = gameImport.reports.value[reportIndex].buildId;

    const neckItemId = resolved.db.value.forSlot("gear.neck")[0].id;
    builds.setChoiceFor(buildId, "gear.neck", neckItemId, "test hand-edit");

    const itemId = resolved.db.value.forSlot("gear.head")[0].id;
    gameImport.mapUnrecognizedItem(reportIndex, outcomeIndex, itemId);

    expect(builds.get(buildId)?.choices["gear.neck"]).toBe(neckItemId);
  });

  it("does not throw, and still updates the report, once the build has been deleted", async () => {
    const { gameImport, builds, resolved } = await freshStores();
    const { reportIndex, outcomeIndex } = commitFixture(gameImport);
    const buildId = gameImport.reports.value[reportIndex].buildId;
    builds.deleteBuild(buildId);

    const itemId = resolved.db.value.forSlot("gear.head")[0].id;
    expect(() =>
      gameImport.mapUnrecognizedItem(reportIndex, outcomeIndex, itemId),
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

    gameImport.mapUnrecognizedItem(reportIndex, outcomeIndex, itemId);

    expect(
      gameImport.reports.value[reportIndex].unrecognizedOrigin.get(
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

    gameImport.mapUnrecognizedItem(reportIndex, outcomeIndex, firstItemId);
    expect(resolved.db.value.get(firstItemId)?.gameIds).toContain(
      "Head_Heavyheal_Test",
    );

    gameImport.mapUnrecognizedItem(reportIndex, outcomeIndex, secondItemId);

    expect(resolved.db.value.get(firstItemId)?.gameIds ?? []).not.toContain(
      "Head_Heavyheal_Test",
    );
    expect(resolved.db.value.get(secondItemId)?.gameIds).toContain(
      "Head_Heavyheal_Test",
    );
    expect(
      gameImport.reports.value[reportIndex].report.outcomes[outcomeIndex],
    ).toMatchObject({ kind: "imported", itemId: secondItemId });
  });

  it("mapping one game id onto a second filter's form leaves the first form's claim alone", async () => {
    // Retraction is scoped to the new item's filter: one enchantment's offense and defense
    // forms are both legitimate claimants.
    const { gameImport, resolved } = await freshStores();
    gameImport.parseFile(sharedGameIdFixture);
    gameImport.commit();

    const report = gameImport.reports.value[0].report;
    const rowFor = (bag: string) =>
      report.outcomes.findIndex(
        (o) => o.kind === "unrecognized" && o.bag === bag,
      );
    const offenseRow = rowFor("OffenseGem");
    const defenseRow = rowFor("DefenseGem");
    expect(offenseRow).toBeGreaterThanOrEqual(0);
    expect(defenseRow).toBeGreaterThanOrEqual(0);

    const offenseItem = resolved.db.value.forSlot("enchantments.offense1")[0]
      .id;
    const defenseItem = resolved.db.value.forSlot("enchantments.defense1")[0]
      .id;

    gameImport.mapUnrecognizedItem(0, offenseRow, offenseItem);
    gameImport.mapUnrecognizedItem(0, defenseRow, defenseItem);

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

describe("gameImport store: re-seating a bag moves an already-placed pick", () => {
  /** One power reaching every companion power slot, and one reaching only offense. Seeded
   *  into a layer so no shipped item's game ids can shift the count. */
  const ANY_POWER = "test-power-any";
  const OFFENSE_ONLY = "test-power-offense";
  const power = (id: string, roles: string[]): Item => ({
    id,
    name: id,
    filter: "companion_power",
    tags: roles.map((role) => `companion_power:${role}`),
  });

  it("keeps every mapped power in the build, in the slots the report ends on", async () => {
    const { gameImport, builds, layers, resolved } = await freshStores();
    const layer = layers.createLayer();
    let overlay = catalog.emptyOverlay();
    for (const item of [
      power(ANY_POWER, ["offense", "defense", "utility"]),
      power(OFFENSE_ONLY, ["offense"]),
    ]) {
      overlay = catalog.upsert(overlay, "items", item.id, item);
    }
    layers.updateOverlay(layer.id, overlay);

    gameImport.parseFile(companionBarFixture);
    gameImport.commit();
    const buildId = gameImport.reports.value[0].buildId;

    const mapId = (gameId: string, itemId: string) => {
      const outcomeIndex =
        gameImport.reports.value[0].report.outcomes.findIndex(
          (o) => o.kind === "unrecognized" && o.gameId === gameId,
        );
      expect(outcomeIndex).toBeGreaterThanOrEqual(0);
      gameImport.mapUnrecognizedItem(0, outcomeIndex, itemId);
    };

    // The four flexible powers fill offense, defense and both universals.
    for (const n of [1, 2, 3, 4]) mapId(`Pet_Anywhere_${n}_Test`, ANY_POWER);
    expect(resolved.db.value.get(ANY_POWER)?.gameIds).toHaveLength(4);

    // The offense-only power has nowhere left, so re-seating moves a flexible pick aside.
    mapId("Pet_Offense_Only_Test", OFFENSE_ONLY);

    const choices = builds.get(buildId)?.choices ?? {};
    expect(choices["companions.offense"]).toBe(OFFENSE_ONLY);
    // Nothing was dropped on the way.
    expect(
      [
        "companions.offense",
        "companions.defense",
        "companions.universal1",
        "companions.universal2",
        "companions.utility",
      ].filter((slotId) => choices[slotId]),
    ).toHaveLength(5);

    // The build agrees with the report it was re-resolved from.
    for (const outcome of gameImport.reports.value[0].report.outcomes) {
      if (outcome.kind !== "imported") continue;
      expect(choices[outcome.slotId]).toBe(outcome.itemId);
    }
  });
});
