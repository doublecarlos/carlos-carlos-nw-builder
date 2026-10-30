// The first-run landing screen on a phone: it fits the viewport at the device's own width and
// at the narrowest width the app supports.
import { test, expect } from "@playwright/test";
import {
  MIN_SUPPORTED_WIDTH,
  expectNoHorizontalScroll,
} from "../support/viewport";

test("the landing screen fits a phone without sideways scroll", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("landing-new-build")).toBeVisible({
    timeout: 15000,
  });

  await expectNoHorizontalScroll(page);
});

test("the landing screen fits the narrowest supported width", async ({
  page,
}) => {
  await page.setViewportSize({ width: MIN_SUPPORTED_WIDTH, height: 740 });
  await page.goto("/");
  await expect(page.getByTestId("landing-new-build")).toBeVisible({
    timeout: 15000,
  });

  await expectNoHorizontalScroll(page);
});
