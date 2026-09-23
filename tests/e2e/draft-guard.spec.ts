// Warn before navigation drops an unsaved new-entry draft: an in-progress item or bonus, a
// pending bonus card nested in an item form, and the sidebar jump out of a layer.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder, setItemFilter } from "./support/app";
import {
  addBuild,
  addLayer,
  buildRow,
  confirmDialog,
  layerRow,
} from "./support/nav";

const SAVED_ITEM = "ZZZ Guard Saved Item";
const DRAFT_ITEM = "ZZZ Guard Draft Item";
const OTHER_ITEM = "ZZZ Guard Other Item";

async function createItem(page: Page, name: string) {
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill(name);
  await setItemFilter(page, "gear_head");
  await page.getByRole("button", { name: "Save item" }).click();
  await expect(page.locator(".editor-row", { hasText: name })).toHaveCount(1);
}

async function openLayer(page: Page) {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
}

async function openRow(page: Page, name: string) {
  await page.locator(".editor-search").fill(name);
  await page.locator(".editor-row", { hasText: name }).first().click();
}

test("picking another item while a new one is unsaved warns first", async ({
  page,
}) => {
  await openLayer(page);
  await createItem(page, SAVED_ITEM);
  await createItem(page, OTHER_ITEM);

  // Start a third item and type a name, but do not save it.
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill(DRAFT_ITEM);

  await openRow(page, SAVED_ITEM);
  await expect(confirmDialog(page)).toBeVisible();
  await expect(confirmDialog(page)).toContainText("This cannot be undone");
  await expect(confirmDialog(page)).not.toContainText("Hold Shift to skip");
  await expect(page.getByTestId("confirm-accept")).toHaveText("Discard");
  await page.getByTestId("confirm-cancel").click();

  // Cancelling keeps the draft exactly where it was.
  await expect(page.getByTestId("item-name-input")).toHaveValue(DRAFT_ITEM);

  await openRow(page, SAVED_ITEM);
  await page.getByTestId("confirm-accept").click();
  await expect(page.getByTestId("item-name-input")).toHaveValue(SAVED_ITEM);
});

test("switching sections while a new bonus is unsaved warns first", async ({
  page,
}) => {
  await openLayer(page);
  await page.getByRole("button", { name: /Bonuses \d+/ }).click();
  await page.getByTestId("new-bonus").click();
  await page.getByTestId("bonus-name-input").fill("ZZZ Guard Draft Bonus");

  await page.getByRole("button", { name: /Items \d+/ }).click();
  await expect(confirmDialog(page)).toBeVisible();
  await page.getByTestId("confirm-cancel").click();

  // Still on the Bonuses section with the draft intact.
  await expect(page.getByTestId("bonus-name-input")).toHaveValue(
    "ZZZ Guard Draft Bonus",
  );
});

test("a pending bonus card in the item form warns before leaving the item", async ({
  page,
}) => {
  await openLayer(page);
  await createItem(page, SAVED_ITEM);
  await createItem(page, OTHER_ITEM);

  await openRow(page, SAVED_ITEM);
  await page.getByRole("button", { name: "Add bonus" }).click();
  const card = page.getByTestId("bonus-card");
  await expect(card).toHaveCount(1);
  await card.getByTestId("bonus-name-input").fill("ZZZ Pending Attached Bonus");

  await openRow(page, OTHER_ITEM);
  await expect(confirmDialog(page)).toBeVisible();
  await page.getByTestId("confirm-cancel").click();
  await expect(page.getByTestId("item-name-input")).toHaveValue(SAVED_ITEM);
  await expect(page.getByTestId("bonus-card")).toHaveCount(1);

  await openRow(page, OTHER_ITEM);
  await page.getByTestId("confirm-accept").click();
  await expect(page.getByTestId("item-name-input")).toHaveValue(OTHER_ITEM);
});

test("jumping to a build from a dirty layer draft warns first", async ({
  page,
}) => {
  await openLayer(page);
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill(DRAFT_ITEM);

  await buildRow(page, "Build 1").locator(".nav-name").click();
  await expect(confirmDialog(page)).toBeVisible();
  await page.getByTestId("confirm-cancel").click();

  // The layer editor is still on screen with the draft.
  await expect(page.getByTestId("item-name-input")).toHaveValue(DRAFT_ITEM);

  await buildRow(page, "Build 1").locator(".nav-name").click();
  await page.getByTestId("confirm-accept").click();
  await expect(page.getByTestId("item-name-input")).toHaveCount(0);
});

test("the go-to palette warns before jumping to another build", async ({
  page,
}) => {
  await openBuilder(page);
  await addBuild(page);
  await addLayer(page);
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill(DRAFT_ITEM);

  await page.getByTestId("header-go-to").click();
  await page.getByTestId("go-to-input").fill("Build 1");
  await page
    .getByTestId(/^go-to-option-build:/)
    .first()
    .click();
  await expect(confirmDialog(page)).toBeVisible();
  await page.getByTestId("confirm-cancel").click();
  await expect(page.getByTestId("item-name-input")).toHaveValue(DRAFT_ITEM);
  // The palette stays open after a cancelled jump, so dismiss it before reopening.
  await page.keyboard.press("Escape");

  await page.getByTestId("header-go-to").click();
  await page.getByTestId("go-to-input").fill("Build 1");
  await page
    .getByTestId(/^go-to-option-build:/)
    .first()
    .click();
  await page.getByTestId("confirm-accept").click();
  await expect(page.getByTestId("item-name-input")).toHaveCount(0);
});

test("creating a new build from a dirty layer draft warns first", async ({
  page,
}) => {
  await openLayer(page);
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill(DRAFT_ITEM);

  await page.getByTestId("nav-add-build").click();
  await expect(confirmDialog(page)).toBeVisible();
  await page.getByTestId("confirm-cancel").click();
  await expect(page.getByTestId("item-name-input")).toHaveValue(DRAFT_ITEM);

  await page.getByTestId("nav-add-build").click();
  await page.getByTestId("confirm-accept").click();
  await expect(page.getByTestId("item-name-input")).toHaveCount(0);
});

test("creating a new layer from a dirty layer draft warns first", async ({
  page,
}) => {
  await openLayer(page);
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill(DRAFT_ITEM);

  await page.getByTestId("nav-add-layer").click();
  await expect(confirmDialog(page)).toBeVisible();
  await page.getByTestId("confirm-cancel").click();
  await expect(page.getByTestId("item-name-input")).toHaveValue(DRAFT_ITEM);

  await page.getByTestId("nav-add-layer").click();
  await page.getByTestId("confirm-accept").click();
  // The new layer opens a blank draft; the old one is discarded.
  await expect(page.getByTestId("item-name-input")).toHaveValue("");
});

test("browser back inside the app uses the in-app dialog, not the browser's", async ({
  page,
}) => {
  let browserPrompted = false;
  page.on("dialog", (dialog) => {
    browserPrompted = true;
    void dialog.dismiss();
  });
  await openLayer(page);
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill(DRAFT_ITEM);

  await page.goBack();
  await expect(confirmDialog(page)).toBeVisible();
  await page.getByTestId("confirm-cancel").click();
  await expect(page.getByTestId("item-name-input")).toHaveValue(DRAFT_ITEM);
  expect(browserPrompted).toBe(false);
});

test("leaving the page with a dirty draft asks through the browser", async ({
  page,
}) => {
  await openLayer(page);
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill(DRAFT_ITEM);

  const dialog = page.waitForEvent("dialog");
  await page.close({ runBeforeUnload: true });
  const prompt = await dialog;
  expect(prompt.type()).toBe("beforeunload");
  await prompt.dismiss();

  // Staying keeps the draft.
  await expect(page.getByTestId("item-name-input")).toHaveValue(DRAFT_ITEM);
});

test("leaving the page without a dirty draft does not ask", async ({
  page,
}) => {
  let browserPrompted = false;
  page.on("dialog", (dialog) => {
    browserPrompted = true;
    void dialog.dismiss();
  });
  await openLayer(page);
  await page.getByTestId("new-item").click();

  const closed = page.waitForEvent("close");
  await page.close({ runBeforeUnload: true });
  await closed;
  expect(browserPrompted).toBe(false);
});
