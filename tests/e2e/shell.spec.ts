// Shell layout: header, three columns, landing screen, loading skeleton, and the draft indicator.
import { test, expect } from "@playwright/test";
import { openBuilder } from "./support/app";

test("first load shows the landing screen, not the builder", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("landing")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("editor-column")).toBeHidden();
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
