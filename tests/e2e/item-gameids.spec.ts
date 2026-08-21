// End-to-end coverage for the gameIds field (game-import ticket #171): a TokenInput on the
// item form that lets a layer teach the importer new Hitem mappings with no code change.
import { test, expect } from "@playwright/test";
import { openBuilder } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

const UNIQUE_ITEM = "ZZZ Test GameIds Item";

test("gameIds persist after saving and reopening the item", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill(UNIQUE_ITEM);
  await page.getByTestId("item-filter-input").fill("gear_head");

  const gameIdsField = page.getByTestId("item-gameids-input");
  const gameIdsInput = gameIdsField.locator("input");
  await gameIdsInput.fill("Head_Heavyheal_Test");
  await gameIdsInput.press("Enter");
  await gameIdsInput.fill("Insignia_Barbed_Test");
  await gameIdsInput.press("Enter");

  await expect(gameIdsField).toContainText("Head_Heavyheal_Test");
  await expect(gameIdsField).toContainText("Insignia_Barbed_Test");

  await page.getByRole("button", { name: "Save item" }).click();

  await page.locator(".editor-search").fill(UNIQUE_ITEM);
  await page.locator(".editor-row", { hasText: UNIQUE_ITEM }).click();

  const persisted = page.getByTestId("item-gameids-input");
  await expect(persisted).toContainText("Head_Heavyheal_Test");
  await expect(persisted).toContainText("Insignia_Barbed_Test");
});
