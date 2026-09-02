// "Save to repo" wiring, from the export modal to the request that leaves the page.
//
// Every test here intercepts the endpoint. The dev server Playwright drives does mount it, so
// an unintercepted click would rewrite this worktree's own data/db-items.json with whatever
// the test layer holds. What lands on disk is covered in tests/unit/writeback.spec.ts.
import { test, expect, type Page, type Request } from "@playwright/test";
import { addLayer, layerRow } from "./support/nav";

const WRITEBACK = "**/__data/write";
const FAKE_REPO = "E:\\worktrees\\data-writeback";

async function openExport(page: Page) {
  const newBuild = page.getByTestId("landing-new-build");
  await page.goto("/");
  await expect(newBuild).toBeVisible({ timeout: 15000 });
  await newBuild.click();
  await page.mouse.move(0, 0);

  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByTestId("layer-export-toggle").click();
  await expect(page.getByTestId("layer-export")).toBeVisible();
}

const saveButton = (page: Page) => page.getByTestId("layer-export-save");
const saveStatus = (page: Page) => page.getByTestId("layer-export-save-status");

async function openItemsTab(page: Page) {
  await page
    .getByTestId("layer-export")
    .getByRole("button", { name: "db-items.json" })
    .click();
  await expect(saveButton(page)).toBeEnabled();
}

test("sends the composed file to the endpoint and says where it landed", async ({
  page,
}) => {
  let sent: Request | null = null;
  await page.route(WRITEBACK, async (route) => {
    sent = route.request();
    await route.fulfill({ json: { ok: true, repo: FAKE_REPO } });
  });

  await openExport(page);
  await openItemsTab(page);
  await saveButton(page).click();

  await expect(saveStatus(page)).toHaveText(
    `Wrote db-items.json to ${FAKE_REPO}`,
  );

  const payload = sent!.postDataJSON() as { file: string; body: string };
  expect(payload.file).toBe("db-items.json");
  // The body is the same text the tab is showing, not a re-derivation.
  expect(payload.body).toBe(
    await page.getByTestId("layer-export").locator("textarea").inputValue(),
  );
});

test("tells you how to fix it when nothing is listening", async ({ page }) => {
  await page.route(WRITEBACK, (route) => route.abort("connectionrefused"));

  await openExport(page);
  await openItemsTab(page);
  await saveButton(page).click();

  await expect(saveStatus(page)).toContainText("npm run data-server");
});

test("passes the endpoint's own refusal straight through", async ({ page }) => {
  await page.route(WRITEBACK, (route) =>
    route.fulfill({
      status: 400,
      json: { ok: false, error: "catalog.ts is not one of the writable files" },
    }),
  );

  await openExport(page);
  await openItemsTab(page);
  await saveButton(page).click();

  await expect(saveStatus(page)).toHaveText(
    "catalog.ts is not one of the writable files",
  );
});

test("offers no save on the tab that is not a repo file", async ({ page }) => {
  await openExport(page);

  await expect(
    page
      .getByTestId("layer-export")
      .getByRole("button", { name: "This layer" }),
  ).toBeVisible();
  await expect(saveButton(page)).toHaveCount(0);
});

test("drops a stale result when the tab changes", async ({ page }) => {
  await page.route(WRITEBACK, (route) =>
    route.fulfill({ json: { ok: true, repo: FAKE_REPO } }),
  );

  await openExport(page);
  await openItemsTab(page);
  await saveButton(page).click();
  await expect(saveStatus(page)).toBeVisible();

  await page
    .getByTestId("layer-export")
    .getByRole("button", { name: "slots.json" })
    .click();

  await expect(saveStatus(page)).toHaveCount(0);
});
