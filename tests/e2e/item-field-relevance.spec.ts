// The item form offers a field group only where the item's filter is authored with it
// (`filterFields` in data/slots.json), plus the two escapes: a group the item already carries
// a value in stays, and "Show all fields" brings everything back.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder, setItemFilter } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

const ITEM = "ZZZ Test Relevance Item";

/** A brand-new item draft under `filter`, with the item form open. */
async function openNewItemForm(page: Page, filter: string) {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill(ITEM);
  await setItemFilter(page, filter);
}

const group = (page: Page, name: string) => page.getByTestId(`group-${name}`);

test("a boon is offered its repetition and none of the stable, class or publish groups", async ({
  page,
}) => {
  await openNewItemForm(page, "boon_tier1");

  await expect(group(page, "inline-repetition")).toBeVisible();
  await expect(group(page, "allowed-class")).toBeHidden();
  await expect(group(page, "publishes")).toBeHidden();
  await expect(group(page, "default-params")).toBeHidden();
  await expect(group(page, "insignia")).toBeHidden();
  await expect(group(page, "insignia-slots")).toBeHidden();
  await expect(group(page, "insignia-recipe")).toBeHidden();
});

test("a mount is offered its insignia slots and nothing else from the stable", async ({
  page,
}) => {
  await openNewItemForm(page, "mount");

  await expect(group(page, "insignia-slots")).toBeVisible();
  await expect(group(page, "insignia")).toBeHidden();
  await expect(group(page, "insignia-recipe")).toBeHidden();
  await expect(group(page, "inline-repetition")).toBeHidden();
});

test("a gear item keeps its classes group and drops the rest", async ({
  page,
}) => {
  await openNewItemForm(page, "gear_head");

  await expect(group(page, "allowed-class")).toBeVisible();
  await expect(group(page, "publishes")).toBeHidden();
  await expect(group(page, "insignia-slots")).toBeHidden();
});

test("groups nothing declares are offered to every item", async ({ page }) => {
  await openNewItemForm(page, "boon_tier1");

  // No `filterFields` entry claims these, so narrowing never reaches them.
  await expect(group(page, "dynamic-stats")).toBeVisible();
  await expect(group(page, "description")).toBeVisible();
  await expect(group(page, "retirement")).toBeVisible();
});

test("Show all fields brings back every group, and is remembered across a reload", async ({
  page,
}) => {
  await openNewItemForm(page, "boon_tier1");

  await page.getByTestId("show-all-fields").locator("input").check();
  await expect(group(page, "allowed-class")).toBeVisible();
  await expect(group(page, "publishes")).toBeVisible();
  await expect(group(page, "insignia-slots")).toBeVisible();
  await expect(group(page, "insignia-recipe")).toBeVisible();

  await page.reload();
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByTestId("new-item").click();
  await expect(
    page.getByTestId("show-all-fields").locator("input"),
  ).toBeChecked();
  await expect(group(page, "insignia-slots")).toBeVisible();

  await page.getByTestId("show-all-fields").locator("input").uncheck();
  await expect(group(page, "insignia-slots")).toBeHidden();
});

test("a value in a group the filter does not claim keeps that group, and survives a save", async ({
  page,
}) => {
  await openNewItemForm(page, "gear_head");

  await page.getByTestId("show-all-fields").locator("input").check();
  await page.getByRole("button", { name: "Add published value" }).click();
  await page.getByTestId("publishes-path-0").fill("class");
  await page.getByTestId("publishes-value-0").fill("wizard");

  // The declaration never claims `publishes` for gear, yet the group stays.
  await page.getByTestId("show-all-fields").locator("input").uncheck();
  await expect(group(page, "publishes")).toBeVisible();
  await expect(page.getByTestId("publishes-path-0")).toHaveValue("class");

  await page.getByRole("button", { name: "Save item" }).click();
  await expect(group(page, "publishes")).toBeVisible();
  await expect(page.getByTestId("publishes-path-0")).toHaveValue("class");
  await expect(page.getByTestId("publishes-value-0")).toHaveValue("wizard");
});
