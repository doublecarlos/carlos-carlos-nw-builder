// BaseButton sizing. A plain button sits level with the fields beside it, and an icon-only one
// stands as tall as a labeled one, so a toolbar of fields and actions reads as one even row.
import { test, expect, type Locator } from "@playwright/test";
import {
  openBuilder,
  slotFilterClearButton,
  slotFilterInput,
} from "./support/app";

async function height(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!.height;
}

test(
  "a button is no taller than the field beside it",
  { tag: "@cross-browser" },
  async ({ page }) => {
    await openBuilder(page);
    expect(await height(slotFilterClearButton(page))).toBeLessThanOrEqual(
      (await height(slotFilterInput(page))) + 1,
    );
  },
);

test("an icon-only button is as tall as a labeled one", async ({ page }) => {
  await openBuilder(page);
  const labeled = await height(page.getByTestId("header-export-bundle"));
  const iconOnly = await height(page.getByTestId("header-about"));
  expect(Math.abs(labeled - iconOnly)).toBeLessThanOrEqual(1);
});
