// End-to-end coverage for the item editor's "Default build parameters" section:
// like Stats, it's a repeatable list of rows hidden behind a single "+" until used, so most
// items' forms show no extra clutter. Each row pairs a build_parameter slot picker with that
// slot's own control (BuildParamInput), reused as-is from the build editor.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

const UNIQUE_ITEM = "ZZZ Test Default Params Item";

async function openNewItemForm(page: Page) {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill(UNIQUE_ITEM);
  await page.getByTestId("item-filter-input").fill("paragon");
}

test("the section is hidden behind a single + button until a row is added", async ({
  page,
}) => {
  await openNewItemForm(page);

  await expect(
    page.getByRole("button", { name: "Add default build parameter" }),
  ).toBeVisible();
  await expect(page.locator(".default-param-row")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Remove default build parameter" }),
  ).toHaveCount(0);

  await page
    .getByRole("button", { name: "Add default build parameter" })
    .click();
  // The empty-state row (a bare "+") is replaced by a real, removable row -- same one-row
  // footprint as before, now with content instead of a placeholder.
  await expect(page.locator(".default-param-row")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Remove default build parameter" }),
  ).toHaveCount(1);
});

test("picking a slot and value round-trips through save", async ({ page }) => {
  await openNewItemForm(page);
  await page
    .getByRole("button", { name: "Add default build parameter" })
    .click();
  const row = page.locator(".default-param-row").last();

  const slotPicker = row.getByTestId("picker-input").first();
  await slotPicker.click();
  await slotPicker.fill("Role");
  await row.getByText("Role", { exact: true }).click();

  const valuePicker = row.getByTestId("picker-input").last();
  await valuePicker.click();
  await valuePicker.fill("DPS");
  await row.getByText("DPS", { exact: true }).click();

  await page.getByRole("button", { name: "Save item" }).click();

  await page.locator(".editor-search").fill(UNIQUE_ITEM);
  await page.locator(".editor-row", { hasText: UNIQUE_ITEM }).click();
  const savedRow = page.locator(".default-param-row").first();
  await expect(savedRow.getByTestId("picker-input").first()).toHaveValue(
    "Role",
  );
  await expect(savedRow.getByTestId("picker-input").last()).toHaveValue("DPS");
});

test("removing the only row collapses the section back to a single + button", async ({
  page,
}) => {
  await openNewItemForm(page);
  await page
    .getByRole("button", { name: "Add default build parameter" })
    .click();
  await expect(page.locator(".default-param-row")).toHaveCount(1);

  await page
    .getByRole("button", { name: "Remove default build parameter" })
    .click();
  await expect(page.locator(".default-param-row")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Add default build parameter" }),
  ).toBeVisible();
});
