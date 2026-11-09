// The section menu's "Copy to other builds…": a dialog of the build tree where a folder's box
// ticks every build under it, then one copy into all of them with a single Undo.
import { test, expect, type Page } from "@playwright/test";
import {
  openBuilder,
  openSectionActions,
  pickerInput,
  pickerMenu,
  slotRow,
} from "./support/app";
import {
  addBuild,
  addFolder,
  buildRow,
  folderRow,
  moveViaMenu,
  navName,
  renameViaSidebar,
} from "./support/nav";

/** Build 1 set to Tank, with Build 2 and Build 3 in a "Trials" folder. Leaves Build 1 open. */
async function buildsInTrials(page: Page) {
  await openBuilder(page);
  await addBuild(page);
  await addBuild(page);
  await addFolder(page);
  await renameViaSidebar(page, folderRow(page, "Folder 1"), "Trials");
  await moveViaMenu(buildRow(page, "Build 2"), "Trials");
  await moveViaMenu(buildRow(page, "Build 3"), "Trials");
  await buildRow(page, "Build 1").click();
  await chooseTank(page);
}

async function chooseTank(page: Page) {
  const roleRow = slotRow(page, "options.role");
  await roleRow.getByTestId("picker-input").click();
  await pickerMenu(roleRow).getByText("Tank", { exact: true }).click();
}

async function openCopyTo(page: Page) {
  await openSectionActions(page, "options");
  await page.getByTestId("section-actions-copy-to").click();
  return page.getByTestId("copy-to-builds");
}

const box = (dialog: ReturnType<Page["getByTestId"]>, name: string) =>
  dialog.getByRole("checkbox", { name, exact: true });

test("a folder's box ticks its builds, reads mixed when partly ticked, and copies into them", async ({
  page,
}) => {
  await buildsInTrials(page);
  const dialog = await openCopyTo(page);

  await box(dialog, "Trials").check();
  await expect(box(dialog, "Build 2")).toBeChecked();
  await expect(box(dialog, "Build 3")).toBeChecked();

  await box(dialog, "Build 3").uncheck();
  await expect(box(dialog, "Trials")).toBeChecked({ indeterminate: true });

  // Clicking a mixed folder ticks the rest rather than clearing it.
  await box(dialog, "Trials").click();
  await expect(box(dialog, "Build 3")).toBeChecked();

  await dialog.getByTestId("copy-to-builds-submit").click();
  await expect(dialog).toBeHidden();

  // The copy leaves the user on the build they copied from.
  await expect(navName(buildRow(page, "Build 1"))).toHaveAttribute(
    "aria-current",
    "true",
  );
  await buildRow(page, "Build 3").click();
  await expect(pickerInput(slotRow(page, "options.role"))).toHaveValue("Tank");
});

test("one Undo takes the copy back from every build", async ({ page }) => {
  await buildsInTrials(page);
  const dialog = await openCopyTo(page);
  await box(dialog, "Trials").check();
  await dialog.getByTestId("copy-to-builds-submit").click();

  await page.getByTestId("notice-action").click();

  for (const name of ["Build 2", "Build 3"]) {
    await buildRow(page, name).click();
    await expect(pickerInput(slotRow(page, "options.role"))).not.toHaveValue(
      "Tank",
    );
  }
});

// A folder's box must never tick a build the filter is hiding.
test("ticking while filtered reaches only the matching builds", async ({
  page,
}) => {
  await buildsInTrials(page);
  const dialog = await openCopyTo(page);

  await dialog.getByTestId("copy-to-builds-filter").fill("Build 2");
  await box(dialog, "Trials").check();
  await dialog.getByTestId("copy-to-builds-filter-clear").click();

  await expect(box(dialog, "Build 2")).toBeChecked();
  await expect(box(dialog, "Build 3")).not.toBeChecked();
  await expect(box(dialog, "Trials")).toBeChecked({ indeterminate: true });
  await expect(dialog.getByTestId("copy-to-builds-submit")).toHaveText(
    "Copy to 1 build",
  );
});

// A build already holding the section is marked and passed over, since copying there would
// change nothing.
test("a build that already matches is marked and skipped by its folder", async ({
  page,
}) => {
  await buildsInTrials(page);
  await buildRow(page, "Build 3").click();
  await chooseTank(page);
  await buildRow(page, "Build 1").click();
  const dialog = await openCopyTo(page);

  const build3 = box(dialog, "Build 3");
  await expect(build3).toBeDisabled();
  await expect(dialog.getByTestId("copy-to-builds-same")).toHaveCount(1);

  await box(dialog, "Trials").check();
  await expect(box(dialog, "Build 2")).toBeChecked();
  await expect(build3).not.toBeChecked();
  await expect(dialog.getByTestId("copy-to-builds-submit")).toHaveText(
    "Copy to 1 build",
  );
});
