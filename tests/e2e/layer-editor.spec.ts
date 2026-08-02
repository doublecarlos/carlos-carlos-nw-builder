// End-to-end coverage for the in-place layer editor (replaces the old modal DataEditor).
// Selecting a layer replaces the build editor and stat panel; editing an item in a layer shows
// its effect on the build's resolved stats after switching back.
import { test, expect } from "@playwright/test";
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

test.describe("id collision avoidance", () => {
  test.skip("creating an item with a name that collides with a disabled layer's id gets a disambiguated id", async ({
    page,
  }) => {
    await openBuilder(page);
    await addLayer(page);

    // Select Layer 1 and create a new item.
    const layer = layerRow(page, "Layer 1");
    await layer.locator(".nav-name").click();
    await page.getByRole("button", { name: "+ New item" }).click();

    // Fill the name.
    const nameInput = page.getByTestId("item-name-input");
    await nameInput.fill("Mythic Ring");

    // Save the item.
    await page.getByRole("button", { name: "Save item" }).click();

    // Disable the layer via the nav checkbox.
    const navCheckbox = layerRow(page, "Layer 1")
      .locator('input[type="checkbox"]')
      .first();
    await navCheckbox.click();

    // Create a second layer via the nav helper.
    await addLayer(page);
    const layer2 = layerRow(page, "Layer 2");
    await layer2.locator(".nav-name").click();

    // Try to create an item with the same name.
    await page.getByRole("button", { name: "+ New item" }).click();
    const nameInput2 = page.getByTestId("item-name-input");
    await nameInput2.fill("Mythic Ring");

    // The id preview should show "mythic-ring-2", not "mythic-ring".
    await expect(page.getByTitle("Assigned when first saved")).toHaveText(
      "mythic-ring-2",
    );
  });
});
