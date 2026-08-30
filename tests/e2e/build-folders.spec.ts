// End-to-end coverage for grouping builds into folders in the sidebar (issue #337): one level
// deep, drag-and-drop in and out, the keyboard/menu equivalents, and what a bundle export
// carries with it.
import { test, expect } from "@playwright/test";
import { openBuilder } from "./support/app";
import {
  addBuild,
  addFolder,
  buildRow,
  folderRow,
  filterBuilds,
  openRowMenu,
  confirmDangerAction,
  renameViaSidebar,
} from "./support/nav";
import { dragOnto } from "./support/dragDrop";

/** Drags a build row onto a folder header's middle band, which is "put it in this folder". */
async function dropIntoFolder(
  build: ReturnType<typeof buildRow>,
  folder: ReturnType<typeof folderRow>,
) {
  await dragOnto(build.getByTestId("build-drag-handle"), folder, "into");
}

test("the Folder button adds an empty folder", async ({ page }) => {
  await openBuilder(page);
  await addFolder(page);

  await expect(folderRow(page, "Folder 1")).toBeVisible();
  await expect(page.getByTestId("folder-empty")).toContainText(
    "Drop builds here",
  );
});

test("dragging a build onto a folder puts it inside, and it survives a reload", async ({
  page,
}) => {
  await openBuilder(page);
  await addBuild(page);
  await addFolder(page);
  await renameViaSidebar(page, folderRow(page, "Folder 1"), "Alts");

  await dropIntoFolder(buildRow(page, "Build 1"), folderRow(page, "Alts"));

  await expect(page.getByTestId("folder-empty")).toHaveCount(0);
  // The folder row reports how many builds it holds.
  await expect(folderRow(page, "Alts")).toContainText("1");
  // Build 2 stays at the top level, so the folder's own build is the indented one.
  await expect(buildRow(page, "Build 1")).toHaveClass(/pl-9/);
  await expect(buildRow(page, "Build 2")).not.toHaveClass(/pl-9/);

  // eslint-disable-next-line playwright/no-wait-for-timeout -- No DOM event to observe for IDB flush
  await page.waitForTimeout(500);
  await page.reload();
  await page.getByTestId("library").waitFor({ state: "visible" });

  await expect(buildRow(page, "Build 1")).toHaveClass(/pl-9/);
});

test("collapsing a folder hides its builds and the state survives a reload", async ({
  page,
}) => {
  await openBuilder(page);
  await addBuild(page);
  await addFolder(page);
  await dropIntoFolder(buildRow(page, "Build 2"), folderRow(page, "Folder 1"));

  await folderRow(page, "Folder 1").locator(".nav-name").click();
  await expect(buildRow(page, "Build 2")).toHaveCount(0);
  await expect(buildRow(page, "Build 1")).toBeVisible();

  // eslint-disable-next-line playwright/no-wait-for-timeout -- No DOM event to observe for IDB flush
  await page.waitForTimeout(500);
  await page.reload();
  await page.getByTestId("library").waitFor({ state: "visible" });

  await expect(buildRow(page, "Build 2")).toHaveCount(0);
});

test("the filter reaches builds inside a collapsed folder", async ({
  page,
}) => {
  await openBuilder(page);
  await addBuild(page);
  await addFolder(page);
  await dropIntoFolder(buildRow(page, "Build 2"), folderRow(page, "Folder 1"));
  await folderRow(page, "Folder 1").locator(".nav-name").click();
  await expect(buildRow(page, "Build 2")).toHaveCount(0);

  await filterBuilds(page, "Build 2");

  await expect(buildRow(page, "Build 2")).toBeVisible();
  await expect(buildRow(page, "Build 1")).toHaveCount(0);
});

test("a folder can be renamed from the sidebar", async ({ page }) => {
  await openBuilder(page);
  await addFolder(page);

  await renameViaSidebar(page, folderRow(page, "Folder 1"), "Alts");

  await expect(folderRow(page, "Alts")).toBeVisible();
});

test("the build menu moves a build into a folder and back out", async ({
  page,
}) => {
  await openBuilder(page);
  await addFolder(page);
  await renameViaSidebar(page, folderRow(page, "Folder 1"), "Alts");

  let menu = await openRowMenu(buildRow(page, "Build 1"));
  await menu.getByRole("button", { name: "Move to “Alts”" }).click();
  await expect(buildRow(page, "Build 1")).toHaveClass(/pl-9/);

  menu = await openRowMenu(buildRow(page, "Build 1"));
  await menu.getByRole("button", { name: "Move to top level" }).click();
  await expect(buildRow(page, "Build 1")).not.toHaveClass(/pl-9/);
});

test("dragging a build out of a folder returns it to the top level", async ({
  page,
}) => {
  await openBuilder(page);
  await addBuild(page);
  await addFolder(page);
  await renameViaSidebar(page, folderRow(page, "Folder 1"), "Alts");
  await dropIntoFolder(buildRow(page, "Build 1"), folderRow(page, "Alts"));
  await expect(buildRow(page, "Build 1")).toHaveClass(/pl-9/);

  // Build 2 is a top-level row, so landing after it means leaving the folder.
  await dragOnto(
    buildRow(page, "Build 1").getByTestId("build-drag-handle"),
    buildRow(page, "Build 2"),
  );

  await expect(buildRow(page, "Build 1")).not.toHaveClass(/pl-9/);
  await expect(folderRow(page, "Alts")).toContainText("0");
});

test("builds reorder within a folder", async ({ page }) => {
  await openBuilder(page);
  await addBuild(page);
  await addFolder(page);
  await dropIntoFolder(buildRow(page, "Build 1"), folderRow(page, "Folder 1"));
  await dropIntoFolder(buildRow(page, "Build 2"), folderRow(page, "Folder 1"));

  const rows = page.locator(".nav-row--build");
  await expect(rows.nth(0)).toContainText("Build 1");

  await dragOnto(
    buildRow(page, "Build 1").getByTestId("build-drag-handle"),
    buildRow(page, "Build 2"),
  );

  await expect(rows.nth(0)).toContainText("Build 2");
  await expect(rows.nth(1)).toContainText("Build 1");
});

test("a folder reorders among the top-level rows", async ({ page }) => {
  await openBuilder(page);
  await addFolder(page);
  await addFolder(page);

  const folderRows = page.locator(".nav-row--folder");
  await expect(folderRows.nth(0)).toContainText("Folder 1");

  await dragOnto(
    folderRow(page, "Folder 1").getByTestId("folder-drag-handle"),
    folderRow(page, "Folder 2"),
  );

  await expect(folderRows.nth(0)).toContainText("Folder 2");
  await expect(folderRows.nth(1)).toContainText("Folder 1");
});

test("deleting a folder keeps its builds, at the top level", async ({
  page,
}) => {
  await openBuilder(page);
  await addBuild(page);
  await addFolder(page);
  await dropIntoFolder(buildRow(page, "Build 2"), folderRow(page, "Folder 1"));

  const menu = await openRowMenu(folderRow(page, "Folder 1"));
  await confirmDangerAction(menu, "Delete folder (keeps builds)");

  await expect(folderRow(page, "Folder 1")).toHaveCount(0);
  await expect(buildRow(page, "Build 2")).toBeVisible();
  await expect(buildRow(page, "Build 2")).not.toHaveClass(/pl-9/);
});

test("a bundle export carries the folders of the builds it exports", async ({
  page,
}) => {
  await openBuilder(page);
  await addBuild(page);
  await addFolder(page);
  await renameViaSidebar(page, folderRow(page, "Folder 1"), "Alts");
  await dropIntoFolder(buildRow(page, "Build 2"), folderRow(page, "Alts"));

  await page.getByTestId("header-export-bundle").click();
  await expect(page.getByTestId("bundle-export-picker")).toBeVisible();
  await expect(page.getByTestId("bundle-folder-label")).toContainText("Alts");

  // Tick only the foldered build, so the folder travels with exactly that member.
  const picker = page.getByTestId("bundle-export-picker");
  await picker
    .locator("label", { hasText: "Build 2" })
    .getByTestId("bundle-build-checkbox")
    .check();

  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("bundle-export-button").click();
  const download = await downloadPromise;
  const text = await (
    await download.createReadStream()
  )
    .toArray()
    .then((chunks) => Buffer.concat(chunks).toString("utf-8"));
  const bundle = JSON.parse(text) as {
    data: {
      builds: { id: string; name: string }[];
      folders: { name: string; builds: string[] }[];
    };
  };

  expect(bundle.data.builds.map((b) => b.name)).toEqual(["Build 2"]);
  expect(bundle.data.folders).toHaveLength(1);
  expect(bundle.data.folders[0].name).toBe("Alts");
  expect(bundle.data.folders[0].builds).toEqual([bundle.data.builds[0].id]);
});
