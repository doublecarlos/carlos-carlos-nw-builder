// What a browser that refuses IndexedDB gets. Hydration runs before Vue mounts, so a failure
// here strands the visitor on index.html's boot screen rather than showing an error.
import { test, expect, type Page } from "@playwright/test";

/** Throws on access, the way a browser with site data blocked does. Installed before any page
 *  script runs, so the app's first access is the failing one. */
async function blockIndexedDb(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      configurable: true,
      get() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
  });
}

/** The other shape: `indexedDB` is reachable, but opening the database errors. */
async function failIndexedDbOpen(page: Page) {
  await page.addInitScript(() => {
    window.indexedDB.open = () => {
      const request = {} as IDBOpenDBRequest & { onerror?: () => void };
      setTimeout(() => request.onerror?.(), 0);
      return request;
    };
  });
}

test("the builder still opens when indexedDB is blocked", async ({ page }) => {
  await blockIndexedDb(page);
  await page.goto("/");

  // The boot screen is index.html's own markup; Vue replaces it on mount, so it being still
  // there means the app never started.
  await expect(page.getByTestId("landing")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("boot-screen")).toHaveCount(0);
  await expect(page.getByTestId("loading-skeleton")).toHaveCount(0);
});

test("the builder still opens when the database fails to open", async ({
  page,
}) => {
  await failIndexedDbOpen(page);
  await page.goto("/");

  await expect(page.getByTestId("landing")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("boot-screen")).toHaveCount(0);
});

test("the header says work is not being saved, and keeps saying it", async ({
  page,
}) => {
  await blockIndexedDb(page);
  await page.goto("/");

  const indicator = page.getByTestId("autosave-indicator");
  await expect(indicator).toBeVisible({ timeout: 15000 });
  await expect(indicator).toHaveAttribute("data-state", "failed");
  await expect(indicator).toContainText("Not saved to this browser");

  // Wait the toast out rather than sleeping a fixed span: it is the toast disappearing that
  // makes the point, since the indicator is what has to still be telling the truth after it.
  await expect(
    page.getByText("Could not open this browser's storage"),
  ).toHaveCount(0, { timeout: 15000 });
  await expect(indicator).toHaveAttribute("data-state", "failed");
  await expect(indicator).toContainText("Not saved to this browser");
});

test("a build can still be made, in memory", async ({ page }) => {
  await blockIndexedDb(page);
  await page.goto("/");

  await page.getByTestId("landing-new-build").click();

  await expect(page.getByTestId("landing")).toHaveCount(0);
  await expect(page.getByTestId("app-header")).toBeVisible();
});

test("a working browser says the opposite", async ({ page }) => {
  await page.goto("/");

  const indicator = page.getByTestId("autosave-indicator");
  await expect(indicator).toBeVisible({ timeout: 15000 });
  await expect(indicator).toHaveAttribute("data-state", "saving");
  await expect(indicator).toContainText("Auto-saved to this browser");
});
