// End-to-end coverage for undo routing. Ctrl+Z follows the undo scope: the sidebar's stack of
// list operations with focus in the nav, the selected item's content stack with focus in the
// editor. The two button pairs each act on their own stack, whatever has focus.
import { test, expect, type Page } from "@playwright/test";
import {
  openBuilder,
  chooseItem,
  navRedoButton,
  navUndoButton,
  parkCursorOnRow,
  pickerInput,
  redoButton,
  slotRow,
  undoButton,
} from "./support/app";
import {
  addBuild,
  buildRow,
  confirmDangerAction,
  openRowMenu,
} from "./support/nav";

const HEAD_ITEM = "M29 Enchanted Depthweave Cap";

function activeScope(page: Page) {
  return page.locator("[data-undo-scope-active]");
}

/** Creates "Build 2" and deletes it again, leaving one nav step to undo. */
async function createAndDeleteBuild2(page: Page) {
  await addBuild(page);
  await expect(buildRow(page, "Build 2")).toBeVisible();
  const menu = await openRowMenu(buildRow(page, "Build 2"));
  await confirmDangerAction(menu, "Delete");
  await expect(buildRow(page, "Build 2")).toHaveCount(0);
}

/** Moves focus onto a nav row without changing the selection. */
async function focusNavRow(page: Page, name: string) {
  await buildRow(page, name).locator(".nav-name").focus();
  await expect(activeScope(page)).toHaveAttribute(
    "data-undo-scope-active",
    "nav",
  );
}

test("Ctrl+Z with a nav row focused restores a deleted build", async ({
  page,
}) => {
  await openBuilder(page);
  await createAndDeleteBuild2(page);

  await focusNavRow(page, "Build 1");
  await page.keyboard.press("Control+z");
  await expect(buildRow(page, "Build 2")).toBeVisible();
  await expect(buildRow(page, "Build 2")).toHaveClass(/is-active/);
});

test("Ctrl+Z in the editor reverts the slot and keeps the build selected", async ({
  page,
}) => {
  await openBuilder(page);
  await addBuild(page);
  await expect(buildRow(page, "Build 2")).toHaveClass(/is-active/);

  await chooseItem(page, "gear.head", HEAD_ITEM);
  await expect(pickerInput(slotRow(page, "gear.head"))).toHaveValue(HEAD_ITEM);
  // Parks focus on the row itself: inside the editor, and not a text field that would keep
  // the shortcut for the browser's own undo.
  await parkCursorOnRow(page, "gear.head");
  await expect(activeScope(page)).toHaveAttribute(
    "data-undo-scope-active",
    "editor",
  );

  await page.keyboard.press("Control+z");
  await expect(pickerInput(slotRow(page, "gear.head"))).toHaveValue("");
  await expect(buildRow(page, "Build 2")).toHaveClass(/is-active/);
  await expect(buildRow(page, "Build 1")).toBeVisible();
});

test("Ctrl+Z in the nav ignores item history", async ({ page }) => {
  await openBuilder(page);
  // Chosen by keyboard alone: text typed into the picker lands on the browser's own undo
  // stack, which Ctrl+Z replays from anywhere in the document and would clear the field for
  // reasons of its own.
  await parkCursorOnRow(page, "gear.head");
  await page.keyboard.press("Enter");
  await expect(
    slotRow(page, "gear.head").getByTestId("picker-menu"),
  ).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const head = pickerInput(slotRow(page, "gear.head"));
  await expect(head).not.toHaveValue("");
  const chosen = await head.inputValue();
  await expect(undoButton(page)).toBeEnabled();

  await focusNavRow(page, "Build 1");
  await expect(navUndoButton(page)).toBeDisabled();
  await page.keyboard.press("Control+z");

  await expect(activeScope(page)).toHaveAttribute(
    "data-undo-scope-active",
    "nav",
  );
  await expect(head).toHaveValue(chosen);
  await expect(undoButton(page)).toBeEnabled();
});

test("the editor pair acts on the item stack with focus in the nav", async ({
  page,
}) => {
  await openBuilder(page);
  await chooseItem(page, "gear.head", HEAD_ITEM);
  await focusNavRow(page, "Build 1");

  await undoButton(page).click();
  await expect(pickerInput(slotRow(page, "gear.head"))).toHaveValue("");
  await expect(redoButton(page)).toBeEnabled();

  await redoButton(page).click();
  await expect(pickerInput(slotRow(page, "gear.head"))).toHaveValue(HEAD_ITEM);
});

test("the nav pair acts on the list stack with focus in the editor", async ({
  page,
}) => {
  await openBuilder(page);
  await createAndDeleteBuild2(page);

  await parkCursorOnRow(page, "gear.head");
  await expect(activeScope(page)).toHaveAttribute(
    "data-undo-scope-active",
    "editor",
  );
  await expect(navUndoButton(page)).toBeEnabled();
  await expect(navRedoButton(page)).toBeDisabled();

  await navUndoButton(page).click();
  await expect(buildRow(page, "Build 2")).toBeVisible();
  await expect(navRedoButton(page)).toBeEnabled();

  await navRedoButton(page).click();
  await expect(buildRow(page, "Build 2")).toHaveCount(0);
});

test("the pairs name the step they would take back", async ({ page }) => {
  await openBuilder(page);
  await addBuild(page);
  await chooseItem(page, "gear.head", HEAD_ITEM);

  await navUndoButton(page).hover();
  await expect(page.getByTestId("tooltip")).toHaveText(
    'Undo: create build "Build 2" (Ctrl+Z)',
  );
  await page.mouse.move(0, 0);

  await undoButton(page).hover();
  await expect(page.getByTestId("tooltip")).toHaveText(
    `Undo: Head → ${HEAD_ITEM} (Ctrl+Z)`,
  );
});
