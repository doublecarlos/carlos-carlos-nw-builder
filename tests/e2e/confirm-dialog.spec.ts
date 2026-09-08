// End-to-end coverage for the shared confirmation dialog (ConfirmDialog.vue + stores/confirm):
// the ways out of it, the Shift gesture that skips it, and the folder checkbox.
import { test, expect } from "@playwright/test";
import { openBuilder } from "./support/app";
import {
  addBuild,
  addFolder,
  addLayer,
  buildRow,
  buildRowNesting,
  confirmDialog,
  folderRow,
  layerRow,
  openRowMenu,
  recentlyDeletedHeader,
} from "./support/nav";
import { dragOnto } from "./support/dragDrop";

test("cancelling a delete leaves the build alone", async ({ page }) => {
  await openBuilder(page);
  await addBuild(page);

  const menu = await openRowMenu(buildRow(page, "Build 2"));
  await menu.getByRole("button", { name: "Delete" }).click();

  await expect(confirmDialog(page)).toBeVisible();
  await expect(
    page.getByText("Restorable from Recently deleted"),
  ).toBeVisible();

  await page.getByTestId("confirm-cancel").click();
  await expect(confirmDialog(page)).toHaveCount(0);
  await expect(buildRow(page, "Build 2")).toBeVisible();
});

test("Escape closes the dialog without acting", async ({ page }) => {
  await openBuilder(page);
  await addBuild(page);

  const menu = await openRowMenu(buildRow(page, "Build 2"));
  await menu.getByRole("button", { name: "Delete" }).click();
  await expect(confirmDialog(page)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(confirmDialog(page)).toHaveCount(0);
  await expect(buildRow(page, "Build 2")).toBeVisible();
});

test("Shift+Delete on a focused row skips the dialog", async ({ page }) => {
  await openBuilder(page);
  await addBuild(page);

  await buildRow(page, "Build 2").locator(".nav-name").focus();
  await page.keyboard.press("Shift+Delete");

  await expect(confirmDialog(page)).toHaveCount(0);
  await expect(buildRow(page, "Build 2")).toHaveCount(0);
  await expect(recentlyDeletedHeader(page)).toBeVisible();
});

test("Shift-clicking a menu delete skips the dialog", async ({ page }) => {
  await openBuilder(page);
  await addLayer(page);

  const menu = await openRowMenu(layerRow(page, "Layer 1"));
  await menu
    .getByRole("button", { name: "Delete" })
    .click({ modifiers: ["Shift"] });

  await expect(confirmDialog(page)).toHaveCount(0);
  await expect(layerRow(page, "Layer 1")).toHaveCount(0);
});

test("deleting a folder takes its builds with it when the box stays ticked", async ({
  page,
}) => {
  await openBuilder(page);
  await addBuild(page);
  await addFolder(page);
  await dragOnto(
    buildRow(page, "Build 2"),
    folderRow(page, "Folder 1"),
    "into",
  );
  await expect(buildRowNesting(page, "Build 2")).toHaveClass(/nav-row--nested/);

  const menu = await openRowMenu(folderRow(page, "Folder 1"));
  await menu.getByRole("button", { name: "Delete folder" }).click();

  const checkbox = page.getByTestId("confirm-checkbox").locator("input");
  await expect(checkbox).toBeChecked();
  await expect(page.getByTestId("confirm-checkbox")).toContainText(
    "Also delete the 1 build inside",
  );

  await page.getByTestId("confirm-accept").click();

  await expect(folderRow(page, "Folder 1")).toHaveCount(0);
  await expect(buildRow(page, "Build 2")).toHaveCount(0);
  await expect(recentlyDeletedHeader(page)).toBeVisible();
});

test("an empty folder's dialog offers no build checkbox", async ({ page }) => {
  await openBuilder(page);
  await addFolder(page);

  const menu = await openRowMenu(folderRow(page, "Folder 1"));
  await menu.getByRole("button", { name: "Delete folder" }).click();

  await expect(confirmDialog(page)).toBeVisible();
  await expect(page.getByTestId("confirm-checkbox")).toHaveCount(0);

  await page.getByTestId("confirm-accept").click();
  await expect(folderRow(page, "Folder 1")).toHaveCount(0);
});
