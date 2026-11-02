// A sheet slides in from the edge it is anchored to, inside the motion budget, and lands
// fully on screen.
import { test, expect } from "@playwright/test";
import { openBuilder } from "../support/app";
import { entersWithinBudget } from "../support/motion";

test.use({ contextOptions: { reducedMotion: "no-preference" } });

test("the nav drawer slides in within budget and ends inside the viewport", async ({
  page,
}) => {
  await openBuilder(page);
  await page.getByTestId("header-nav-toggle").click();
  const panel = page.getByTestId("nav-drawer").getByTestId("sheet-panel");
  await expect(panel).toBeVisible();
  expect(await entersWithinBudget(panel)).toBe(true);
  await expect(panel).toBeInViewport({ ratio: 1 });
});
