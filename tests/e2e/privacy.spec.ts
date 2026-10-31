// The privacy notice is a file in public/, not a route. Its content type is checked in
// static-files.spec.ts; here it has to work without the bundle and keep the app honest.
import { test, expect } from "@playwright/test";

test("privacy.html leads back to the builder", async ({ page }) => {
  await page.goto("/privacy.html");

  await page.getByRole("link", { name: /Back to the builder/ }).click();

  await expect(page.getByTestId("landing")).toBeVisible({ timeout: 15000 });
});

test("the app sets no cookies, as the page claims", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("landing")).toBeVisible({ timeout: 15000 });

  expect(await page.context().cookies()).toEqual([]);
});
