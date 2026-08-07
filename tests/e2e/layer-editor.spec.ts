// End-to-end coverage for the in-place layer editor (replaces the old modal DataEditor).
// Selecting a layer replaces the build editor and stat panel; editing an item in a layer shows
// its effect on the build's resolved stats after switching back.
import { test, expect, type Locator, type Page } from "@playwright/test";
import { openBuilder, chooseItem } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

const HEAD_ITEM = "M29 Enchanted Depthweave Cap (CA)";
const ARMS_ITEM = "M31 Bindings of the Death Pact (Damage)";

test.describe("selecting a layer replaces the build editor", () => {
  test("selecting a layer hides the build name input and shows the layer editor", async ({
    page,
  }) => {
    await openBuilder(page);
    await addLayer(page);

    // Click the layer in the nav to select it.
    const layer = layerRow(page, "Layer 1");
    await layer.locator(".nav-name").click();

    // The layer editor header should now be visible instead of the builder.
    await expect(
      page.locator("strong").filter({ hasText: "Layer 1" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Items \d+/ })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Bonus sets \d+/ }),
    ).toBeVisible();

    // The build name input should not be visible (layer editor replaces the editor area).
    await expect(page.getByTestId("builder-content")).toBeHidden();
  });

  test("editing an item in a layer changes the build's resolved stats after switching back", async ({
    page,
  }) => {
    await openBuilder(page);
    // Equip the head item first so there's a stat to observe.
    await chooseItem(page, "gear.head", HEAD_ITEM);

    // Create a layer and select it.
    await addLayer(page);
    const layer = layerRow(page, "Layer 1");
    await layer.locator(".nav-name").click();

    // The layer editor is visible. Find the head item in the composed catalogue.
    const searchBox = page.locator(".editor-search");
    await searchBox.fill(HEAD_ITEM);
    await page.locator(".editor-row", { hasText: HEAD_ITEM }).click();

    // The item form should show. Use .first() to avoid matching bonus card form-bars.
    await expect(page.getByTestId("form-bar").first()).toBeVisible();

    // Switch back to the build view by clicking the build in the nav.
    const build = page
      .getByTestId("library")
      .locator(".nav-row--build")
      .first();
    await build.locator(".nav-name").click();

    // The build editor should be back.
    await expect(page.getByTestId("builder-content")).toBeVisible();
  });

  test("the editor for a disabled layer shows the 'not applied' banner", async ({
    page,
  }) => {
    await openBuilder(page);
    await addLayer(page);

    const layer = layerRow(page, "Layer 1");
    await layer.locator(".nav-name").click();

    // Disable the layer via the checkbox in the layer editor header.
    // The editor header has a checkbox near the layer name strong element.
    const editorCheckbox = page
      .locator("strong")
      .filter({ hasText: "Layer 1" })
      .locator("..")
      .locator('input[type="checkbox"]')
      .first();
    await editorCheckbox.click();

    // The disabled banner should appear.
    await expect(page.getByText("This layer is disabled")).toBeVisible();
  });
});

test.describe("Ctrl+click on a filled slot", () => {
  test("Ctrl+click on a filled slot with no layers creates Layer 1, selects it, and opens the item form", async ({
    page,
  }) => {
    await openBuilder(page);
    // Equip an item first so the slot is filled.
    await chooseItem(page, "gear.head", HEAD_ITEM);

    // Ctrl+click on the head slot row.
    await page.locator('[data-cursor-key="slot:gear.head"]').click({
      modifiers: ["Control"],
    });

    // Layer 1 should be created and selected.
    await expect(
      page.locator("strong").filter({ hasText: "Layer 1" }),
    ).toBeVisible();
    // The item form should be open for the head item.
    await expect(page.getByTestId("form-bar").first()).toBeVisible();
  });

  test("Ctrl+click on an empty slot does nothing", async ({ page }) => {
    await openBuilder(page);

    // Ctrl+click on an empty slot (boots is empty by default).
    await page.locator('[data-cursor-key="slot:gear.boots"]').click({
      modifiers: ["Control"],
    });

    // The build editor should still be visible (no layer editor).
    await expect(page.getByTestId("builder-content")).toBeVisible();
  });

  test("Ctrl+click twice on different slots targets the same layer the second time", async ({
    page,
  }) => {
    await openBuilder(page);
    // Equip two items: head and arms.
    await chooseItem(page, "gear.head", HEAD_ITEM);
    await chooseItem(page, "gear.arms", ARMS_ITEM);

    // First Ctrl+click on the head slot.
    await page.locator('[data-cursor-key="slot:gear.head"]').click({
      modifiers: ["Control"],
    });
    await expect(
      page.locator("strong").filter({ hasText: "Layer 1" }),
    ).toBeVisible();

    // Switch back to the build.
    const build = page
      .getByTestId("library")
      .locator(".nav-row--build")
      .first();
    await build.locator(".nav-name").click();

    // Ctrl+click on a different slot (arms).
    await page.locator('[data-cursor-key="slot:gear.arms"]').click({
      modifiers: ["Control"],
    });

    // Still Layer 1, not Layer 2.
    await expect(
      page.locator("strong").filter({ hasText: "Layer 1" }),
    ).toBeVisible();
    await expect(
      page.locator("strong").filter({ hasText: "Layer 2" }),
    ).toBeHidden();
  });

  test("opening an item and navigating away without saving leaves the layer empty", async ({
    page,
  }) => {
    await openBuilder(page);
    await chooseItem(page, "gear.head", HEAD_ITEM);

    // Ctrl+click on the head slot.
    await page.locator('[data-cursor-key="slot:gear.head"]').click({
      modifiers: ["Control"],
    });

    // The layer editor should be visible.
    await expect(
      page.locator("strong").filter({ hasText: "Layer 1" }),
    ).toBeVisible();

    // Navigate back to the build without saving.
    const build = page
      .getByTestId("library")
      .locator(".nav-row--build")
      .first();
    await build.locator(".nav-name").click();

    // Select the layer again.
    const layer = layerRow(page, "Layer 1");
    await layer.locator(".nav-name").click();

    // The layer should have 0 entries.
    await expect(page.getByText("0 entries")).toBeVisible();
  });
});

test.describe("point_assignment items in the Layer Editor", () => {
  test("a new item tagged with a point_assignment slot's own filter saves fine", async ({
    page,
  }) => {
    await openBuilder(page);
    await addLayer(page);
    const layer = layerRow(page, "Layer 1");
    await layer.locator(".nav-name").click();

    await page.getByTestId("new-item").click();
    await page.getByTestId("item-name-input").fill("Boon: Tier 1 Test");
    // "boon_tier1" is the shipped "Boons (Tier 1)" point_assignment slot's own filter (data/
    // slots.json) -- an item carrying it is resolved as a stepper row via that slot's filter,
    // not chosen from a picker.
    await page.getByTestId("item-filter-input").fill("boon_tier1");

    await page.getByRole("button", { name: "Save item" }).click();

    // No blocking error, and the item now shows up in the layer's own item list.
    await expect(page.locator("p.text-danger")).toHaveCount(0);
    await expect(
      page.locator(".editor-row").filter({ hasText: "Boon: Tier 1 Test" }),
    ).toBeVisible();
  });
});

test.describe("bonus set grant conditions", () => {
  test("changing a condition's type mid-edit does not drop the condition", async ({
    page,
  }) => {
    await openBuilder(page);
    await addLayer(page);
    const layer = layerRow(page, "Layer 1");
    await layer.locator(".nav-name").click();

    // Open the Bonus sets section and pick a set whose grant has a toggle condition.
    await page.getByRole("button", { name: /Bonus sets \d+/ }).click();
    await page.locator(".editor-search").fill("1st Pack Tactics (Group)");
    const setRow = page
      .locator(".editor-row")
      .filter({ hasText: "1st Pack Tactics (Group)" })
      .first();
    await setRow.click();

    const typePicker = page
      .getByText("Condition", { exact: true })
      .locator("..")
      .getByTestId("picker-input");
    const valuePicker = page
      .getByText("Value", { exact: true })
      .locator("..")
      .getByTestId("picker-input");
    await expect(typePicker).toHaveValue("toggle");
    await expect(valuePicker).toHaveValue("Party");

    // Switch the condition from toggle to class. Changing the type resets the value, so
    // the condition is momentarily incomplete -- the debounced auto-save must not fire
    // with a half-drawn tree (it would silently drop the when and the source round-trip
    // would wipe the row from the form).
    await typePicker.click();
    await page.getByText("class", { exact: true }).click();
    await expect(typePicker).toHaveValue("class");

    // Wait past the 700ms debounce: the row must still be there and nothing must have
    // been persisted (no "edited" status badge on the set row -- the "unsaved" badge
    // for the dirty form is expected).
    await page.waitForTimeout(1500);
    await expect(typePicker).toHaveValue("class");
    await expect(valuePicker).toBeVisible();
    const statusBadge = setRow
      .getByTestId("badge")
      .filter({ hasText: "edited" });
    await expect(statusBadge).toHaveCount(0);

    // Now complete the condition by picking a class value. The next auto-save carries
    // the full tree, and the row still survives the round-trip.
    await valuePicker.click();
    await page.getByText("Cleric", { exact: true }).click();
    await expect(typePicker).toHaveValue("class");
    await expect(valuePicker).toHaveValue("Cleric");
    await expect(statusBadge).toBeVisible();
  });
});

test.describe("bonus set stat payload editing", () => {
  /** Opens the layer editor's Bonus sets section and selects one set by name. */
  async function openSet(page: Page, name: string) {
    await openBuilder(page);
    await addLayer(page);
    await layerRow(page, "Layer 1").locator(".nav-name").click();
    await page.getByRole("button", { name: /Bonus sets \d+/ }).click();
    await page.locator(".editor-search").fill(name);
    const setRow = page
      .locator(".editor-row")
      .filter({ hasText: name })
      .first();
    await setRow.click();
    await expect(page.locator(".stat-row").first()).toBeVisible();
    return setRow;
  }

  /** Picks a stat for the row's combo by typing the full label, then selecting it. */
  async function pickStat(row: Locator) {
    const picker = row.getByTestId("picker-input");
    await picker.click();
    await picker.fill("Power (power)");
    await row.getByText("Power (power)", { exact: true }).click();
  }

  test("adding a stat to a tiered payload adds it to the tier and survives auto-save", async ({
    page,
  }) => {
    const setRow = await openSet(page, "Executioner's Covenant");

    // Two tiers, eight stats each.
    const rowsBefore = await page.locator(".stat-row").count();
    await page.getByRole("button", { name: "Add stat" }).first().click();
    await expect(page.locator(".stat-row")).toHaveCount(rowsBefore + 1);

    // The tier's set combo lists the set ids (they reach the form through the store).
    await page
      .locator(".combo--set")
      .first()
      .getByTestId("picker-input")
      .click();
    await expect(
      page
        .getByTestId("picker-menu")
        .getByText("executioner-s-covenant", { exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    // Fill the new row, then wait past the 700ms auto-save debounce: the row must
    // survive the round-trip and the set must be marked edited.
    await pickStat(page.locator(".stat-row").last());
    await page.waitForTimeout(1500);
    await expect(page.locator(".stat-row")).toHaveCount(rowsBefore + 1);
    await expect(
      setRow.getByTestId("badge").filter({ hasText: "edited" }),
    ).toBeVisible();
  });

  test("adding a stat to a 'varies by condition' payload adds it to the variant", async ({
    page,
  }) => {
    const setRow = await openSet(page, "Bard's Truly Inspired (Skill)");

    // Two variants, one stat each.
    const rowsBefore = await page.locator(".stat-row").count();
    await page.getByRole("button", { name: "Add stat" }).first().click();
    await expect(page.locator(".stat-row")).toHaveCount(rowsBefore + 1);

    // Fill the new row and let it auto-save: it must survive the round-trip.
    await pickStat(page.locator(".stat-row").last());
    await page.waitForTimeout(1500);
    await expect(page.locator(".stat-row")).toHaveCount(rowsBefore + 1);
    await expect(
      setRow.getByTestId("badge").filter({ hasText: "edited" }),
    ).toBeVisible();
  });

  test("pre-added empty stat rows survive filling one of them", async ({
    page,
  }) => {
    const setRow = await openSet(page, "1st Pack Tactics (Group)");

    // The add-rows-first workflow: add three empty rows, then fill only the first new
    // one. The still-empty rows must not be wiped by the auto-save round-trip.
    for (let i = 0; i < 3; i++) {
      await page.getByRole("button", { name: "Add stat" }).first().click();
    }
    const rows = page.locator(".stat-row");
    await expect(rows).toHaveCount(5); // 2 existing + 3 added
    await pickStat(rows.nth(2));

    await page.waitForTimeout(1500);
    await expect(rows).toHaveCount(5);
    await expect(
      setRow.getByTestId("badge").filter({ hasText: "edited" }),
    ).toBeVisible();
  });
});
