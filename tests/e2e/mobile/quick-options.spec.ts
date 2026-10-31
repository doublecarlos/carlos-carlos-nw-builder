// Quick options on a phone: a one-line summary on each pane that opens the controls in a
// bottom sheet, so on the Stats pane they change the numbers without switching panes.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder, chooseItem } from "../support/app";
import { importTestCatalog } from "../support/testCatalog";
import { MIN_SUPPORTED_WIDTH } from "../support/viewport";

const RING = "Test Crowd Ring";

const sheet = (page: Page) => page.getByTestId("quick-sheet");
const enemies = (page: Page) =>
  sheet(page).getByTestId("quick-param-options.enemies");
const statsToggle = (page: Page) =>
  page.getByTestId("stat-panel-column").getByTestId("quick-band-toggle");

/** A build wearing a ring whose bonus needs at least 3 enemies, shown on the Stats pane. */
async function openStatsPane(page: Page) {
  await page.setViewportSize({ width: MIN_SUPPORTED_WIDTH, height: 740 });
  await openBuilder(page);
  await importTestCatalog(page, {
    items: [
      {
        id: "test-crowd-ring",
        name: RING,
        filter: "gear_ring",
        bonuses: ["test-crowd-ring-bonus"],
      },
    ],
    bonuses: [
      {
        id: "test-crowd-ring-bonus",
        name: "Test Crowd Ring Bonus",
        grants: [
          {
            stats: { acc_p: 0.05 },
            when: { param: { key: "enemies", atLeast: 3 } },
          },
        ],
      },
    ],
  });
  await chooseItem(page, "gear.ring1", RING);
  await page.getByTestId("pane-stats").click();
}

test("the stats pane's quick options open in a sheet and change the stats", async ({
  page,
}) => {
  await openStatsPane(page);
  await expect(page.getByTestId("quick-sheet")).toHaveCount(0);

  await statsToggle(page).click();
  // Flipping a value from the Stats pane is the point: the numbers follow without a switch.
  const stats = page.getByTestId("details-sidebar");
  const before = await stats.innerText();
  await enemies(page).getByRole("button", { name: "3", exact: true }).click();
  await expect(
    enemies(page).getByRole("button", { name: "3", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => stats.innerText()).not.toBe(before);

  // The summary line reflects the new value once the sheet closes.
  await page.getByTestId("sheet-close").click();
  await expect(sheet(page)).toHaveCount(0);
  await expect(
    statsToggle(page).getByTestId("quick-band-summary"),
  ).toContainText("3");
});

test("the quick options take one line on each pane", async ({ page }) => {
  await openStatsPane(page);
  const statsBox = (await statsToggle(page).boundingBox())!;
  const tabs = (await page
    .getByTestId("details-sidebar")
    .getByRole("button", { name: "Stats" })
    .boundingBox())!;
  // The stats start right under one line, instead of under the whole set of controls.
  expect(tabs.y - (statsBox.y + statsBox.height)).toBeLessThan(40);

  await page.getByTestId("pane-editor").click();
  const editorToggle = page
    .getByTestId("editor-pane")
    .getByTestId("quick-band-toggle");
  await expect(editorToggle).toBeVisible();
  await expect(
    page.getByTestId("editor-pane").getByTestId("quick-options"),
  ).toHaveCount(0);
});

test("preset buttons stay on one row at the narrowest width", async ({
  page,
}) => {
  await openStatsPane(page);
  await statsToggle(page).click();

  const tops = await enemies(page)
    .locator("button[aria-pressed]")
    .evaluateAll((buttons) =>
      buttons.map((b) => Math.round(b.getBoundingClientRect().top)),
    );
  expect(tops.length).toBeGreaterThan(1);
  expect(new Set(tops).size).toBe(1);
});
