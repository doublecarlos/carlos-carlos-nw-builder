// A switched-off layer is still edited against its own catalogue: its entries reach the list,
// its forms follow an undo, and its faults are linted. `enabled` only decides what the build
// resolves to.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder, undoButton } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

const RING = "ZZZ Test Disabled Layer Ring";
const RENAMED = "ZZZ Test Renamed Ring";
const CAPPED = "ZZZ Test Capped Ring";
const ORPHAN = "ZZZ Test Orphan Filter Item";

async function openDisabledLayer(page: Page) {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByTestId("layer-enabled").click();
  await expect(page.getByText("This layer is disabled")).toBeVisible();
}

async function createItem(
  page: Page,
  name: string,
  filter: string,
  { maxCopies }: { maxCopies?: string } = {},
) {
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill(name);
  await page.getByTestId("item-filter-input").fill(filter);
  if (maxCopies !== undefined)
    await page.getByTestId("item-max-copies").fill(maxCopies);
  await page.getByRole("button", { name: "Save item" }).click();
}

async function openItem(page: Page, name: string) {
  await page.locator(".editor-row-name", { hasText: name }).first().click();
}

test("a disabled layer's own item is listed and its form follows an undo", async ({
  page,
}) => {
  await openDisabledLayer(page);
  await createItem(page, RING, "gear_ring");

  await openItem(page, RING);
  const name = page.getByTestId("item-name-input");
  await expect(name).toHaveValue(RING);

  // The list row is the live edit arriving in the layer, so undo cannot fire ahead of it and
  // take back the item's creation instead.
  await name.fill(RENAMED);
  await expect(
    page.locator(".editor-row-name", { hasText: RENAMED }),
  ).toBeVisible();
  await undoButton(page).click();
  await expect(name).toHaveValue(RING);
});

test("a numeric field on a disabled layer's item follows an undo", async ({
  page,
}) => {
  await openDisabledLayer(page);
  await createItem(page, CAPPED, "gear_ring", { maxCopies: "3" });

  await openItem(page, CAPPED);
  const maxCopies = page.getByTestId("item-max-copies");
  await expect(maxCopies).toHaveValue("3");

  // Same wait as above, on the undo tooltip naming the step it would take back.
  await maxCopies.fill("0");
  await undoButton(page).hover();
  await expect(page.getByTestId("tooltip")).toContainText("edit max copies");
  await undoButton(page).click();
  await expect(maxCopies).toHaveValue("3");
});

test("a fault authored only in a disabled layer is linted", async ({
  page,
}) => {
  await openDisabledLayer(page);
  await createItem(page, ORPHAN, "zzz_no_slot_claims_this");

  await expect(page.getByTestId("validation-drawer")).toContainText(
    "matches no slot",
  );
});
