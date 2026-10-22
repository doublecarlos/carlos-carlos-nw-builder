// End-to-end coverage for nested slots (`parent`): a nested row renders right after its parent
// with an indent guide, only while the parent holds a pick, keeps its parent on screen while
// filtering, and can be authored in the slot form. Driven through the shipped gear slots.
import { test, expect, type Page } from "@playwright/test";
import {
  openBuilder,
  ensureSectionExpanded,
  slotRow,
  chooseItem,
  chooseClass,
  chooseCombo,
  slotFilterInput,
} from "./support/app";
import { addLayer, layerRow } from "./support/nav";
import { openSlotsTab } from "./support/layerEditor";

const ARTIFACT_MAINHAND = "M32 Omen of Doom (Celestial)";

/** The gear section's rendered row ids, top to bottom. */
async function gearRowIds(page: Page): Promise<string[]> {
  const keys = await page
    .locator('[data-section-id="gear"] [data-cursor-key^="slot:"]')
    .evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-cursor-key") ?? ""),
    );
  return keys.map((key) => key.slice("slot:".length));
}

async function openArtifactWarlock(page: Page) {
  await openBuilder(page);
  await chooseClass(page, "warlock");
  await ensureSectionExpanded(page, "gear");
  await chooseItem(page, "gear.mainhand", ARTIFACT_MAINHAND);
}

test("a weapon mod renders nested right after its weapon", async ({ page }) => {
  await openArtifactWarlock(page);

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
  await chooseClass(page, "warlock");
  await ensureSectionExpanded(page, "gear");
  await expect(slotRow(page, "reinforcements.armorKit1")).toHaveCount(0);

  await chooseItem(page, "gear.head", "M34 Ashen Coif of the Devourer +2");
  await expect(slotRow(page, "reinforcements.armorKit1")).toBeVisible();
});

test("filtering to a nested slot keeps its parent as context", async ({
  page,
}) => {
  await openArtifactWarlock(page);
  await slotFilterInput(page).fill("Mainhand mod");

  await expect(slotRow(page, "gear.mainhandMod")).toBeVisible();
  await expect(slotRow(page, "gear.mainhand")).toBeVisible();
  await expect(slotRow(page, "gear.mainhand")).toHaveClass(/opacity-60/);
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

  await page
    .getByTestId("library")
    .locator(".nav-row--build")
    .first()
    .locator(".nav-name")
    .click();
  await ensureSectionExpanded(page, "gear");
  await chooseItem(page, "gear.shirt", "M31 Bloodwoven Ink");

  const ids = await gearRowIds(page);
  expect(ids.indexOf("gear.pants")).toBe(ids.indexOf("gear.shirt") + 1);
  await expect(
    slotRow(page, "gear.pants").getByTestId("nest-guide"),
  ).toHaveCount(1);
});
