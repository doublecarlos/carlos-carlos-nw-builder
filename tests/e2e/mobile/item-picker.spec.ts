// The item picker on a phone: it opens as a full-screen surface sized to the visual viewport,
// focused on itself so the keyboard stays down, closes on Back without leaving the build,
// with no item card beside the list, and hands focus back to its row when it closes. Rows give
// the picker their width instead of a stat summary, and "New item" stands in for Ctrl+click.
import { test, expect, type Page } from "@playwright/test";
import {
  chooseItem,
  openBuilder,
  pickerInput,
  pickerScreen,
  slotFilterStatCombo,
  slotRow,
} from "../support/app";

const HEAD_ITEM = "M29 Enchanted Depthweave Cap";

const search = (page: Page) => pickerScreen(page).getByTestId("picker-search");
const rowAnchor = (page: Page, slotId: string) =>
  slotRow(page, slotId).locator("[data-cursor-anchor]");

async function openPicker(page: Page, slotId: string) {
  await pickerInput(slotRow(page, slotId)).click();
  await expect(pickerScreen(page)).toBeVisible();
}

test("the picker opens full-screen with no item card, and the keyboard stays closed", async ({
  page,
}) => {
  await openBuilder(page);
  await openPicker(page, "gear.head");

  // Focus lands on the screen itself, not the search field that would raise the keyboard.
  await expect(pickerScreen(page)).toBeFocused();
  await expect(search(page)).not.toBeFocused();
  const viewport = page.viewportSize()!;
  expect(await pickerScreen(page).boundingBox()).toEqual({
    x: 0,
    y: 0,
    width: viewport.width,
    height: viewport.height,
  });

  // The empty choice still leads the list.
  const options = pickerScreen(page).getByTestId("picker-option");
  await expect(options.first()).toHaveText("- empty -");
  // A keyboard highlight fills the card at once on a wider screen.
  await pickerScreen(page).press("ArrowDown");
  await expect(options.nth(1)).toHaveAttribute("data-highlighted");
  await expect(page.getByTestId("picker-aside")).toHaveCount(0);
  await expect(page.getByTestId("item-card")).toHaveCount(0);
});

test("the list scrolls before the search field is touched, and a tap focuses it", async ({
  page,
}) => {
  await openBuilder(page);
  await openPicker(page, "gear.head");
  const list = pickerScreen(page).getByTestId("picker-menu");

  const box = (await list.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 600);
  await expect
    .poll(() => list.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  await expect(search(page)).not.toBeFocused();

  await search(page).click();
  await expect(search(page)).toBeFocused();
  await search(page).fill("depthweave");
  await expect(
    pickerScreen(page).getByText(HEAD_ITEM, { exact: true }),
  ).toBeVisible();
});

test("the keyboard reaches the search field and the list from the screen", async ({
  page,
}) => {
  await openBuilder(page);
  await openPicker(page, "gear.head");

  // Arrow keys and Enter work on the screen as they do in the field.
  await pickerScreen(page).press("ArrowDown");
  await pickerScreen(page).press("Enter");
  await expect(pickerScreen(page)).toHaveCount(0);
  await expect(pickerInput(slotRow(page, "gear.head"))).not.toHaveValue("");

  await openPicker(page, "gear.head");
  await page.keyboard.press("Tab");
  await expect(
    pickerScreen(page).getByTestId("picker-screen-close"),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(pickerScreen(page).getByTestId("picker-new-item")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(search(page)).toBeFocused();
});

test("Back closes the picker where the editor was, without leaving the build", async ({
  page,
}) => {
  await openBuilder(page);
  const row = slotRow(page, "gear.boots");
  await row.scrollIntoViewIfNeeded();
  const editor = page.getByTestId("editor-column");
  const scrollTop = await editor.evaluate((el) => el.scrollTop);
  const url = page.url();

  await openPicker(page, "gear.boots");
  await page.goBack();

  await expect(pickerScreen(page)).toHaveCount(0);
  expect(page.url()).toBe(url);
  await expect(rowAnchor(page, "gear.boots")).toBeFocused();
  expect(await editor.evaluate((el) => el.scrollTop)).toBe(scrollTop);
  await expect(row).toBeInViewport();
  await expect(page.getByTestId("editor-pane")).toBeVisible();
});

test("closing the picker leaves no history entry behind", async ({ page }) => {
  await openBuilder(page);
  const url = page.url();
  await chooseItem(page, "gear.head", HEAD_ITEM);
  await openPicker(page, "gear.head");
  await pickerScreen(page).getByTestId("picker-screen-close").click();
  await expect
    .poll(() => page.evaluate(() => history.state?.backToClose ?? false))
    .toBe(false);

  // Back now does what it did before the picker opened: it leaves this build's entry.
  await page.goBack();
  await expect.poll(() => page.url()).not.toBe(url);
});

test("the screen follows the visual viewport, so the list ends above the keyboard", async ({
  page,
}) => {
  await openBuilder(page);
  await openPicker(page, "gear.head");

  // An on-screen keyboard shrinks the visual viewport and leaves the window as it was.
  const visible = { top: 40, height: 400 };
  await page.evaluate(({ top, height }) => {
    const visual = window.visualViewport!;
    Object.defineProperty(visual, "height", { get: () => height });
    Object.defineProperty(visual, "offsetTop", { get: () => top });
    visual.dispatchEvent(new Event("resize"));
  }, visible);

  await expect
    .poll(async () => (await pickerScreen(page).boundingBox())?.height)
    .toBe(visible.height);
  const screen = (await pickerScreen(page).boundingBox())!;
  expect(screen.y).toBe(visible.top);
  const list = (await pickerScreen(page)
    .getByTestId("picker-menu")
    .boundingBox())!;
  expect(list.y + list.height).toBeLessThanOrEqual(
    visible.top + visible.height,
  );
  await expect(search(page)).toBeInViewport();
});

test("choosing an item fills the slot, closes the screen and returns to the row", async ({
  page,
}) => {
  await openBuilder(page);
  await chooseItem(page, "gear.head", HEAD_ITEM);

  await expect(pickerScreen(page)).toHaveCount(0);
  await expect(pickerInput(slotRow(page, "gear.head"))).toHaveValue(HEAD_ITEM);
  await expect(rowAnchor(page, "gear.head")).toBeFocused();
});

test("the close button and Escape both close the screen back onto the row", async ({
  page,
}) => {
  await openBuilder(page);
  await openPicker(page, "gear.head");
  await pickerScreen(page).getByTestId("picker-screen-close").click();
  await expect(pickerScreen(page)).toHaveCount(0);
  await expect(rowAnchor(page, "gear.head")).toBeFocused();

  await openPicker(page, "gear.head");
  await search(page).fill("depthweave");
  await search(page).press("Escape");
  await expect(pickerScreen(page)).toHaveCount(0);
  await expect(rowAnchor(page, "gear.head")).toBeFocused();
  // Nothing was chosen.
  await expect(pickerInput(slotRow(page, "gear.head"))).toHaveValue("");
});

test("a row leaves out its stat summary, giving the picker the room", async ({
  page,
}) => {
  await openBuilder(page);
  await chooseItem(page, "gear.head", HEAD_ITEM);
  const row = slotRow(page, "gear.head");
  await expect(row.getByTestId("slot-stat-summary")).toHaveCount(0);
});

test("New item opens the layer editor on an item seeded for the row", async ({
  page,
}) => {
  await openBuilder(page);
  await openPicker(page, "gear.boots");
  await pickerScreen(page).getByTestId("picker-new-item").click();

  await expect(pickerScreen(page)).toHaveCount(0);
  await expect(page.getByTestId("item-name-input")).toHaveValue("");
  await expect(page.getByTestId("item-filter-input")).toHaveValue("gear_boots");
});

test("the stat filter opens full-screen too, without New item", async ({
  page,
}) => {
  await openBuilder(page);
  await slotFilterStatCombo(page).getByTestId("picker-input").click();
  await expect(pickerScreen(page)).toBeVisible();
  await expect(pickerScreen(page)).toBeFocused();
  await expect(pickerScreen(page).getByTestId("picker-new-item")).toHaveCount(
    0,
  );
  await page.keyboard.press("Escape");
  await expect(pickerScreen(page)).toHaveCount(0);
  // Outside a cursor row focus goes back to the box itself, which a tap reopens.
  const trigger = slotFilterStatCombo(page).getByTestId("picker-input");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(pickerScreen(page)).toBeVisible();
});

test("a tablet keeps the floating menu and the item card", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 1000 });
  await openBuilder(page);
  const row = slotRow(page, "gear.head");
  await pickerInput(row).click();
  await pickerInput(row).press("ArrowDown");

  await expect(pickerScreen(page)).toHaveCount(0);
  await expect(row.getByTestId("picker-menu")).toBeVisible();
  await expect(
    row.getByTestId("picker-aside").getByTestId("item-card"),
  ).toBeVisible();
});
