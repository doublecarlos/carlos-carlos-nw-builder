// The privacy notice is a file in public/, not a route, so the only thing worth checking in a
// browser is that it is actually served and readable without the bundle.
import { test, expect } from "@playwright/test";

test("privacy.html is served as a standalone page", async ({ page }) => {
  const response = await page.goto("/privacy.html");

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Privacy" })).toBeVisible();
  await expect(page.locator("body")).toContainText("IndexedDB");
  await expect(page.locator("body")).toContainText("No cookies");
});

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
