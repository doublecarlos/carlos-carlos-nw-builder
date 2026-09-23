// End-to-end coverage for the layer editor's Filters tab: authoring a category's copy cap and
// field groups, including categories that have no declaration yet.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder, setItemFilter } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

/** A category items carry with no declaration of its own in data/filters.json. */
const UNDECLARED = "overload";

/** Creates a layer, selects it, and opens the Filters tab. */
async function openFiltersTab(page: Page) {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByTestId("tab-filters").click();
}

/** The list row for one category. */
const filterRow = (page: Page, name: string) =>
  page.locator(".editor-row", { has: page.getByText(name, { exact: true }) });

/** Searches for a category and opens its row. */
async function openFilter(page: Page, name: string) {
  await page.locator(".editor-search").fill(name);
  await filterRow(page, name).first().click();
  await expect(page.getByTestId("item-id-value")).toHaveText(name);
}

test("a category with no declaration lists its items and can be given metadata", async ({
  page,
}) => {
  await openFiltersTab(page);

  const row = filterRow(page, UNDECLARED).first();
  await page.locator(".editor-search").fill(UNDECLARED);
  await expect(row).toContainText("item(s)");
  await expect(row.getByText("added")).toHaveCount(0);

  await openFilter(page, UNDECLARED);
  // The id is the category's own name, so there is nothing to type.
  await expect(page.getByTestId("filter-name-input")).toHaveCount(0);
  await expect(page.getByTestId("filter-item-count")).toContainText(
    "4 item(s)",
  );

  await page.getByTestId("filter-max-copies").fill("2");
  await page.getByTestId("save-filter").click();

  await expect(row.getByText("added")).toBeVisible();
  await expect(page.getByTestId("filter-max-copies")).toHaveValue("2");
});

test("a shipped filter's cap reaches the item form's blank-field hint", async ({
  page,
}) => {
  await openFiltersTab(page);
  await openFilter(page, "gear_ring");
  await expect(page.getByTestId("filter-max-copies")).toHaveValue("1");

  await page.getByTestId("filter-max-copies").fill("3");

  await page.getByTestId("tab-items").click();
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill("ZZZ Test Cap Item");
  await setItemFilter(page, "gear_ring");
  await expect(page.getByTestId("item-max-copies")).toHaveAttribute(
    "placeholder",
    "3 for this filter",
  );
});

test("claiming a field group offers it in the item form for that category", async ({
  page,
}) => {
  await openFiltersTab(page);
  await openFilter(page, "gear_head");
  await page.getByTestId("filter-field-publishes").locator("input").check();

  await page.getByTestId("tab-items").click();
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill("ZZZ Test Publishing Head");
  await setItemFilter(page, "gear_head");
  await expect(page.getByTestId("group-publishes")).toBeVisible();
  // Saved rather than left as a draft, so leaving the tab raises no discard prompt.
  await page.getByRole("button", { name: "Save item" }).click();

  // Unclaiming it withdraws the group again, so the checkbox is the whole contract.
  await page.getByTestId("tab-filters").click();
  await openFilter(page, "gear_head");
  await page.getByTestId("filter-field-publishes").locator("input").uncheck();

  await page.getByTestId("tab-items").click();
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill("ZZZ Test Plain Head");
  await setItemFilter(page, "gear_head");
  await expect(page.getByTestId("group-publishes")).toBeHidden();
});

test("removing a declaration leaves a restorable row", async ({ page }) => {
  await openFiltersTab(page);
  await openFilter(page, "artifact");
  await page.getByTestId("delete-filter").click();

  const row = filterRow(page, "artifact").first();
  await expect(row.getByText("removed")).toBeVisible();

  await row.getByRole("button", { name: "restore" }).click();
  await expect(row.getByText("removed")).toHaveCount(0);
  await openFilter(page, "artifact");
  await expect(page.getByTestId("filter-max-copies")).toHaveValue("1");
});

test("the item form's edit-filter link opens that category", async ({
  page,
}) => {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();

  await page.locator(".editor-search").fill("M29 Enchanted Depthweave Cap");
  await page.locator(".editor-row").first().click();
  await expect(page.getByTestId("item-filter-input")).toHaveValue("gear_head");

  await page.getByTestId("edit-filter-link").click();
  await expect(page.getByTestId("filter-max-copies")).toBeVisible();
  await expect(page.getByTestId("item-id-value")).toHaveText("gear_head");
});

test("a new declaration's id keeps the snake_case a filter name is written in", async ({
  page,
}) => {
  await openFiltersTab(page);
  await page.getByTestId("new-filter").click();
  await page.getByTestId("filter-name-input").fill("zzz_test_trinket");
  await expect(page.getByTestId("item-id-value")).toHaveText(
    "zzz_test_trinket",
  );

  await page.getByTestId("filter-name-input").fill("zzz test trinket");
  await expect(page.getByTestId("item-id-value")).toHaveText(
    "zzz_test_trinket",
  );
});

test("a filter finding jumps to its row", async ({ page }) => {
  await openFiltersTab(page);
  await page.getByTestId("new-filter").click();
  await page.getByTestId("filter-name-input").fill("zzz unused");
  await page.getByTestId("filter-max-copies").fill("1");
  await page.getByTestId("save-filter").click();

  const finding = page
    .getByTestId("validation-drawer")
    .getByRole("button", { name: "zzz_unused" });
  await expect(finding).toBeVisible();

  await page.getByTestId("tab-items").click();
  await expect(page.getByTestId("new-item")).toBeVisible();

  await finding.click();
  await expect(page.getByTestId("new-filter")).toBeVisible();
  await expect(page.getByTestId("item-id-value")).toHaveText("zzz_unused");
});
