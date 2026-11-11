// The item form's first row in a cramped editor: the name keeps room to read, the fields after
// it wrap instead, and the long id stays narrower than the name, copied whole by a click.
import { test, expect, type Page } from "@playwright/test";
import { chooseItem, openBuilder, slotRow } from "./support/app";
import { shippedItemName } from "./support/shippedData";

const HEAD_ITEM = shippedItemName("m29-enchanted-depthweave-cap-ca");

async function openHeadItem(page: Page) {
  await openBuilder(page);
  await chooseItem(page, "gear.head", HEAD_ITEM);
  await slotRow(page, "gear.head").click({ modifiers: ["ControlOrMeta"] });
  await expect(page.getByTestId("item-name-input")).toHaveValue(HEAD_ITEM);
}

test(
  "a cramped form wraps after the name instead of squeezing it",
  { tag: "@cross-browser" },
  async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 800 });
    await openHeadItem(page);
    const name = page.getByTestId("item-name-input");
    const id = page.getByTestId("item-id-copy").first();

    // The whole name fits in its box, with no sideways scroll inside it.
    expect(
      await name.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
    const nameBox = (await name.boundingBox())!;
    const idBox = (await id.boundingBox())!;
    expect(idBox.width).toBeLessThan(nameBox.width);
  },
);

test("clicking the id copies it", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await openHeadItem(page);
  const id = await page.getByTestId("item-id-value").first().textContent();

  await page.getByTestId("item-id-copy").first().click();
  await expect(page.getByText(/Copied the id/)).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(id);
});
