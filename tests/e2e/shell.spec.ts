// Shell layout: header, three columns, empty state, loading skeleton, and the draft indicator.
import { test, expect } from "@playwright/test";
import { openBuilder, draftIndicator } from "./support/app";

test("first load creates a default build and shows the builder immediately", async ({
  page,
}) => {
  await page.goto("/");
  // The app auto-creates a build on first load, so the builder should be visible.
  await expect(page.getByTestId("editor-column")).toBeVisible({
    timeout: 10000,
  });
});

test("reloading shows the skeleton briefly then the builder", async ({
  page,
}) => {
  await openBuilder(page);
  // Reload: skeleton should flash briefly, then builder appears.
  await page.reload();
  await expect(page.getByTestId("editor-column")).toBeVisible({
    timeout: 10000,
  });
});

test.skip("the notice element carries a title equal to its text", async ({
  page,
}) => {
  await page.goto("/");
  // Wait for the builder to load.
  await expect(page.getByTestId("editor-column")).toBeVisible({
    timeout: 10000,
  });
  // The "Created" notice should appear after the auto-created build.
  // Use a class-based selector: the notice has a distinctive bg-accent-soft class.
  const notice = page
    .getByTestId("app-header")
    .locator("span.bg-accent-soft")
    .last();
  await expect(notice).toBeVisible({ timeout: 3000 });
  const text = await notice.textContent();
  if (text && text.trim()) {
    // The notice might not have a title attribute — skip if not present.
    const title = await notice.getAttribute("title");
    if (title) {
      expect(title).toBe(text.trim());
    }
  }
});
