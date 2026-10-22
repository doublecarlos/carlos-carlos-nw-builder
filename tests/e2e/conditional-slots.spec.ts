// End-to-end coverage for conditional slots (`availableWhen`): a slot whose condition fails is
// hidden and emptied, so the build stores only what the editor shows. Driven through the
// shipped mainhand mod slot, which exists only under an artifact mainhand, through comparing
// against a build that fills it, and through a condition authored in the slot form.
import { test, expect, type Page } from "@playwright/test";
import {
  openBuilder,
  ensureSectionExpanded,
  slotRow,
  pickerInput,
  chooseItem,
  chooseClass,
  chooseCombo,
  undoButton,
} from "./support/app";
import { addLayer, layerRow } from "./support/nav";
import { openSlotsTab } from "./support/layerEditor";

const MOD_SLOT = "gear.mainhandMod";
const ARTIFACT = "M32 Omen of Doom (Celestial)";
const PLAIN = "M28 Voidtouched Pactblade";
const MOD = "Modification: Dark Spiral";

/** Every stat the panel shows, as text, to compare two builds by. */
async function statTexts(page: Page): Promise<string[]> {
  return page
    .locator("[data-stat-row]")
    .getByTestId("stat-value")
    .allTextContents();
}

async function openWarlock(page: Page) {
  await openBuilder(page);
  await chooseClass(page, "warlock");
  await ensureSectionExpanded(page, "gear");
}

test.describe("weapon mods", () => {
  test("the mod row exists only under an artifact mainhand", async ({
    page,
  }) => {
    await openWarlock(page);
    await expect(slotRow(page, MOD_SLOT)).toHaveCount(0);
    await chooseItem(page, "gear.mainhand", ARTIFACT);
    await expect(slotRow(page, MOD_SLOT)).toBeVisible();
  });

  test("swapping to a plain weapon clears the mod, and undo brings both back", async ({
    page,
  }) => {
    await openWarlock(page);
    await chooseItem(page, "gear.mainhand", PLAIN);
    const withoutMod = await statTexts(page);

    await chooseItem(page, "gear.mainhand", ARTIFACT);
    await chooseItem(page, MOD_SLOT, MOD);
    await chooseItem(page, "gear.mainhand", PLAIN);

    await expect(slotRow(page, MOD_SLOT)).toHaveCount(0);
    await expect(page.getByTestId("app-header")).toContainText(
      "Cleared Mainhand mod",
    );
    expect(await statTexts(page)).toEqual(withoutMod);

    await undoButton(page).click();
    await expect(pickerInput(slotRow(page, "gear.mainhand"))).toHaveValue(
      ARTIFACT,
    );
    await expect(pickerInput(slotRow(page, MOD_SLOT))).toHaveValue(MOD);
  });

  test("the notice's undo takes back the swap and the clear together", async ({
    page,
  }) => {
    await openWarlock(page);
    await chooseItem(page, "gear.mainhand", ARTIFACT);
    await chooseItem(page, MOD_SLOT, MOD);
    await chooseItem(page, "gear.mainhand", PLAIN);

    await page.getByTestId("notice-action").click();
    await expect(pickerInput(slotRow(page, MOD_SLOT))).toHaveValue(MOD);
  });

  test("the cleared mod stays gone after a reload", async ({ page }) => {
    await openWarlock(page);
    await chooseItem(page, "gear.mainhand", ARTIFACT);
    await chooseItem(page, MOD_SLOT, MOD);
    await chooseItem(page, "gear.mainhand", PLAIN);
    await expect(slotRow(page, MOD_SLOT)).toHaveCount(0);

    // The reload itself flushes the pending save.
    await page.reload();
    await ensureSectionExpanded(page, "gear");
    await chooseItem(page, "gear.mainhand", ARTIFACT);
    await expect(pickerInput(slotRow(page, MOD_SLOT))).toHaveValue("");
  });
});

test("a condition authored in the slot form hides and clears its slot", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await openSlotsTab(page);
  await page.locator(".editor-search").fill("Arms");
  await page.locator(".editor-row", { hasText: "Arms" }).first().click();

  await page.getByTestId("slot-when-json-toggle").click();
  await page.getByTestId("slot-when-json").fill('{ "toggle": "combat" }');

  await page
    .getByTestId("library")
    .locator(".nav-row--build")
    .first()
    .locator(".nav-name")
    .click();
  await ensureSectionExpanded(page, "gear");

  // The shipped combat toggle starts on, so the slot is there to fill.
  const combat = page
    .getByTestId("quick-options")
    .getByLabel("Combat", { exact: true });
  await expect(combat).toBeChecked();
  await chooseItem(page, "gear.arms", "M28 Ultraviolet Elven Gloves");

  await combat.uncheck();
  await expect(slotRow(page, "gear.arms")).toHaveCount(0);
  await expect(page.getByTestId("app-header")).toContainText("Cleared Arms");

  // Back, but empty: nothing was stashed while it was hidden.
  await combat.check();
  await expect(pickerInput(slotRow(page, "gear.arms"))).toHaveValue("");
});

test.describe("comparing against a build that has the slot", () => {
  /** Build 2, on a plain weapon, compared against Build 1, which holds a mod. */
  async function compareWithModdedBuild(page: Page) {
    await openWarlock(page);
    await chooseItem(page, "gear.mainhand", ARTIFACT);
    await chooseItem(page, MOD_SLOT, MOD);

    await page.getByTestId("nav-add-build").click();
    await chooseClass(page, "warlock");
    await ensureSectionExpanded(page, "gear");
    await chooseItem(page, "gear.mainhand", PLAIN);
    await chooseCombo(page.locator(".compare-select"), "Build 1");
  }

  const compareOnlyRow = (page: Page) =>
    page.getByTestId(`compare-only:${MOD_SLOT}`);

  test("highlighting changes shows what the compare build holds there", async ({
    page,
  }) => {
    await compareWithModdedBuild(page);
    await expect(compareOnlyRow(page)).toHaveCount(0);

    const highlight = page.getByRole("checkbox", { name: "Highlight changes" });
    await highlight.check();
    await expect(compareOnlyRow(page)).toHaveClass(/is-diff/);
    await expect(compareOnlyRow(page)).toContainText(
      "Not available in this build",
    );
    await expect(compareOnlyRow(page)).toContainText(`Build 1: ${MOD}`);
    // Read-only: there is nothing here this build could hold.
    await expect(compareOnlyRow(page).locator("input")).toHaveCount(0);

    await highlight.uncheck();
    await expect(compareOnlyRow(page)).toHaveCount(0);
  });

  test("only showing changes keeps it among the changes", async ({ page }) => {
    await compareWithModdedBuild(page);
    await page.getByRole("checkbox", { name: "Only show changes" }).check();

    await expect(compareOnlyRow(page)).toBeVisible();
    await expect(slotRow(page, "gear.mainhand")).toBeVisible();
    await expect(page.getByTestId("slot-filter-count")).toHaveText("2 matches");
  });
});
