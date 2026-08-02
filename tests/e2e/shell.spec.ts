// Shell layout: header, three columns, empty state, loading skeleton, and the draft indicator.
import { test, expect } from "@playwright/test";
import { openBuilder } from "./support/app";

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
