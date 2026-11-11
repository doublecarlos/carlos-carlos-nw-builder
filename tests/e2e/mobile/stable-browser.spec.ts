// The stable reference on a phone: each card's and row's insignia line wraps below the name
// instead of truncating, since the slot list is what the reference is read for.
import { test, expect, type Locator, type Page } from "@playwright/test";
import { ensureSectionExpanded, openBuilder } from "../support/app";
import { expectNoHorizontalScroll } from "../support/viewport";

/** Every insignia line in the browser that is clipped by its own box. */
const clippedLines = (modal: Locator) =>
  modal
    .locator("[data-testid=stable-card-meta], [data-testid=stable-row-meta]")
    .evaluateAll(
      (els) => els.filter((el) => el.scrollWidth > el.clientWidth + 1).length,
    );

async function expectBelow(lower: Locator, upper: Locator) {
  const top = (await lower.boundingBox())!.y;
  const above = (await upper.boundingBox())!;
  expect(top).toBeGreaterThanOrEqual(above.y + above.height - 1);
}

async function openStableBrowser(page: Page) {
  await openBuilder(page);
  await ensureSectionExpanded(page, "insignia");
  await page.getByTestId("open-stable-browser:insignia.mount1").click();
  const modal = page.getByTestId("stable-browser");
  await expect(modal.getByTestId("stable-group-card").first()).toBeVisible();
  return modal;
}

test("the stable reference shows every insignia line in full", async ({
  page,
}) => {
  const modal = await openStableBrowser(page);

  for (const tab of ["stable-tab-mount", "stable-tab-bonus"]) {
    await modal.getByTestId(tab).click();
    const card = modal.getByTestId("stable-group-card").first();
    const row = card.getByTestId("stable-reach-row").first();

    expect(await clippedLines(modal)).toBe(0);
    await expectBelow(
      card.getByTestId("stable-card-meta"),
      card.getByTestId("stable-card-name"),
    );
    await expectBelow(
      row.getByTestId("stable-row-meta"),
      row.getByTestId("stable-row-name"),
    );
    await expectNoHorizontalScroll(page);
  }

  // "Use mount" keeps to the name line, above the insignia line it applies.
  const row = modal.getByTestId("stable-reach-row").first();
  await expectBelow(
    row.getByTestId("stable-row-meta"),
    row.getByTestId("stable-apply"),
  );
});
