// Quick options on a phone's Stats pane: a band above the stats, collapsed to a summary, whose
// controls change the numbers without switching panes.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder, chooseItem } from "../support/app";
import { importTestCatalog } from "../support/testCatalog";
import { MIN_SUPPORTED_WIDTH } from "../support/viewport";

const RING = "Test Crowd Ring";

const band = (page: Page) => page.getByTestId("quick-band");
const enemies = (page: Page) =>
  band(page).getByTestId("quick-param-options.enemies");

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

test("the stats pane's quick options start as a summary and change the stats", async ({
  page,
}) => {
  await openStatsPane(page);
  await expect(page.getByTestId("quick-band-summary")).toBeVisible();
  await expect(band(page).getByTestId("quick-options")).toHaveCount(0);

  await page.getByTestId("quick-band-toggle").click();
  await expect(page.getByTestId("quick-band-toggle")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  // Flipping a value from the Stats pane is the point: the numbers follow without a switch.
  const stats = page.getByTestId("details-sidebar");
  const before = await stats.innerText();
  await enemies(page).getByRole("button", { name: "3", exact: true }).click();
  await expect(
    enemies(page).getByRole("button", { name: "3", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => stats.innerText()).not.toBe(before);
});

test("preset buttons stay on one row at the narrowest width", async ({
  page,
}) => {
  await openStatsPane(page);
  await page.getByTestId("quick-band-toggle").click();

  const tops = await enemies(page)
    .locator("button[aria-pressed]")
    .evaluateAll((buttons) =>
      buttons.map((b) => Math.round(b.getBoundingClientRect().top)),
    );
  expect(tops.length).toBeGreaterThan(1);
  expect(new Set(tops).size).toBe(1);
});
