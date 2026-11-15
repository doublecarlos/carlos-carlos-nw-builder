// An equipped condition matches either a tag or one exact item, chosen with a tag | item
// switch. The item is picked from the catalog by name or id, so a typo can't save an id no
// item has, and an id the catalog lacks still shows, marked invalid.
import { test, expect, type Page } from "@playwright/test";
import { comboBoxValueId, openBuilder, pickerMenu } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

async function openLayer(page: Page) {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
}

/** A new bonus's first grant, with one equipped leaf. */
async function openEquippedLeaf(page: Page) {
  await openLayer(page);
  await page.getByRole("button", { name: /Bonuses \d+/ }).click();
  await page.getByTestId("new-bonus").click();
  await page.getByLabel("Add grant").click();
  await page.getByLabel("Add condition").click();
  const row = page.getByTestId("condition-row").first();
  await row.getByTestId("picker-input").first().click();
  await pickerMenu(row).getByText("equipped", { exact: true }).click();
  return row;
}

async function grantJson(page: Page) {
  const grant = page.getByTestId("bonus-grant-row").first();
  await grant.getByLabel("Edit as JSON").click();
  return JSON.parse(await grant.locator("textarea").inputValue()) as {
    when?: { equipped?: Record<string, unknown> };
  };
}

test("switching to item swaps the tag picker for an item picker found by id", async ({
  page,
}) => {
  const row = await openEquippedLeaf(page);
  const matchTag = row.getByTestId("condition-match-tag");
  const matchItem = row.getByTestId("condition-match-item");
  await expect(matchTag).toHaveAttribute("aria-pressed", "true");
  await row.getByTestId("condition-tag").fill("aura");

  await matchItem.click();
  await expect(matchItem).toHaveAttribute("aria-pressed", "true");
  await expect(row.getByTestId("condition-tag")).toHaveCount(0);

  const item = row.getByTestId("condition-item").getByTestId("picker-input");
  await item.click();
  const first = pickerMenu(row).getByTestId("picker-option").first();
  const id = (await first.getByTestId("option-row-id").textContent())!.trim();
  // The id finds its item, as well as the name does.
  await item.fill(id);
  await pickerMenu(row)
    .getByTestId("picker-option")
    .filter({
      has: page.getByTestId("option-row-id").getByText(id, { exact: true }),
    })
    .first()
    .click();
  await expect(comboBoxValueId(item)).toHaveText(id);
  await expect(item).not.toHaveAttribute("aria-invalid");

  // Only the chosen target is saved; the tag typed before the switch is gone.
  expect((await grantJson(page)).when?.equipped).toEqual({ item: id });
});

test("an item id the catalog lacks still shows, marked invalid", async ({
  page,
}) => {
  await openLayer(page);
  await page.getByTestId("tab-slots").click();
  await page.locator(".editor-search").fill("Arms");
  await page.locator(".editor-row", { hasText: "Arms" }).first().click();
  await page.getByTestId("slot-when-json-toggle").click();
  await page
    .getByTestId("slot-when-json")
    .fill(JSON.stringify({ equipped: { item: "no-such-item" } }));
  await page.getByTestId("slot-when-json-toggle").click();

  const row = page
    .getByTestId("slot-when")
    .getByTestId("condition-row")
    .first();
  await expect(row.getByTestId("condition-match-item")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const item = row.getByTestId("condition-item").getByTestId("picker-input");
  await expect(item).toHaveValue("no-such-item");
  await expect(item).toHaveAttribute("aria-invalid", "true");
});
