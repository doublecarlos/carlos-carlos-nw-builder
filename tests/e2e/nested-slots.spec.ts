// End-to-end coverage for nested slots (`parent`): a nested row renders right after its parent
// with an indent guide, only while the parent holds a pick, keeps its parent on screen while
// filtering, and can be authored in the slot form. Driven through the shipped gear slots, with
// test items to fill them.
import { test, expect, type Page } from "@playwright/test";
import {
  openBuilder,
  ensureSectionExpanded,
  slotRow,
  chooseItem,
  chooseCombo,
  slotFilterInput,
} from "./support/app";
import { addLayer, layerRow } from "./support/nav";
import { openSlotsTab } from "./support/layerEditor";
import { importTestCatalog } from "./support/testCatalog";

// The mainhand mod row needs an artifact weapon; the tag is the shipped slot's own rule.
const ARTIFACT_MAINHAND_ID = "test-artifact-mainhand";
const HEAD = "Test Nested Head";
const SHIRT_ID = "test-nested-shirt";

/** The gear section's rendered row ids, top to bottom. */
async function gearRowIds(page: Page): Promise<string[]> {
  const keys = await page
    .locator('[data-section-id="gear"] [data-cursor-key^="slot:"]')
    .evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-cursor-key") ?? ""),
    );
  return keys.map((key) => key.slice("slot:".length));
}

async function openArtifactMainhand(page: Page) {
  await openBuilder(page);
  await importTestCatalog(page, {
    items: [
      {
        id: ARTIFACT_MAINHAND_ID,
        name: "Test Artifact Mainhand",
        filter: "gear_weapon_mainhand",
        tags: ["artifact:mainhand"],
      },
    ],
    choices: { "gear.mainhand": ARTIFACT_MAINHAND_ID },
  });
  await ensureSectionExpanded(page, "gear");
}

test("a weapon mod renders nested right after its weapon", async ({ page }) => {
  await openArtifactMainhand(page);

  const ids = await gearRowIds(page);
  expect(ids.indexOf("gear.mainhandMod")).toBe(
    ids.indexOf("gear.mainhand") + 1,
  );
  await expect(
    slotRow(page, "gear.mainhandMod").getByTestId("nest-guide"),
  ).toHaveCount(1);
  await expect(
    slotRow(page, "gear.mainhand").getByTestId("nest-guide"),
  ).toHaveCount(0);
});

test("a reinforcement shows only while its gear piece is picked", async ({
  page,
}) => {
  await openBuilder(page);
  await importTestCatalog(page, {
    items: [{ id: "test-nested-head", name: HEAD, filter: "gear_head" }],
  });
  await ensureSectionExpanded(page, "gear");
  await expect(slotRow(page, "reinforcements.armorKit1")).toHaveCount(0);

  await chooseItem(page, "gear.head", HEAD);
  await expect(slotRow(page, "reinforcements.armorKit1")).toBeVisible();
});

test("filtering to a nested slot keeps its parent as context", async ({
  page,
}) => {
  await openArtifactMainhand(page);
  await slotFilterInput(page).fill("Mainhand mod");

  await expect(slotRow(page, "gear.mainhandMod")).toBeVisible();
  await expect(slotRow(page, "gear.mainhand")).toBeVisible();
  // The parent shows only as context, not as a match of its own.
  await expect(slotRow(page, "gear.mainhand")).toHaveAttribute(
    "data-filter-context",
  );
  await expect(slotRow(page, "gear.mainhandMod")).not.toHaveAttribute(
    "data-filter-context",
  );
  await expect(page.getByTestId("slot-filter-count")).toHaveText("1 match");
});

test("nesting a slot in the slot form moves it under its parent", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await openSlotsTab(page);
  await page.locator(".editor-search").fill("Pants");
  await page.locator(".editor-row", { hasText: "Pants" }).first().click();

  await chooseCombo(page.getByTestId("slot-parent-input"), "Shirt");
  await page.locator(".editor-search").fill("");
  await expect(
    page
      .locator('[data-outline-key="slot:gear.pants"]')
      .getByTestId("outline-nest-guide"),
  ).toHaveCount(1);

  // The import opens its own build, with the shirt picked so its nested row shows.
  await importTestCatalog(page, {
    items: [{ id: SHIRT_ID, name: "Test Nested Shirt", filter: "gear_shirt" }],
    choices: { "gear.shirt": SHIRT_ID },
  });
  await ensureSectionExpanded(page, "gear");

  const ids = await gearRowIds(page);
  expect(ids.indexOf("gear.pants")).toBe(ids.indexOf("gear.shirt") + 1);
  await expect(
    slotRow(page, "gear.pants").getByTestId("nest-guide"),
  ).toHaveCount(1);
});
