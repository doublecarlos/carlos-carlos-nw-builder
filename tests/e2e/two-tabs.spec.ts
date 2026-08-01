// Multi-tab guarantee: two pages in one browser context on different builds, edit both,
// reload each, assert neither lost work.
import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

async function createBuild(page: Page, name: string) {
  await page.goto("/");
  const newBuildBtn = page.getByTestId("empty-new-build");
  if (await newBuildBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await newBuildBtn.click();
  }
  // Rename to make it identifiable.
  const nameInput = page.getByTestId("build-name-input");
  await nameInput.fill(name);
  await nameInput.blur();
}

test.describe.skip("two tabs on different builds", () => {
  test("edit both builds in different tabs, reload each, assert neither lost work", async ({
    context,
  }) => {
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    // Create build A in tab A and rename it.
    await createBuild(pageA, "Build A");
    // Create build B in tab B and rename it.
    await createBuild(pageB, "Build B");

    // Wait for IDB to flush saves.
    await pageA.waitForTimeout(500);
    await pageB.waitForTimeout(500);

    // Reload both.
    await pageA.reload();
    await pageB.reload();

    // Wait for builder to be ready.
    await expect(pageA.getByTestId("editor-column")).toBeVisible({
      timeout: 10000,
    });
    await expect(pageB.getByTestId("editor-column")).toBeVisible({
      timeout: 10000,
    });

    // Check names survived.
    await expect(pageA.getByTestId("build-name-input")).toHaveValue("Build A");
    await expect(pageB.getByTestId("build-name-input")).toHaveValue("Build B");

    await pageA.close();
    await pageB.close();
  });
});
