// Regression coverage for a popover trapped inside its own sticky header's stacking context.
// See data-writeback.spec.ts's "names the local server..." test for the sibling case (tooltip
// vs modal, plain z-order rather than a stacking-context trap).
import { test, expect, type Page } from "@playwright/test";
import { openBuilder, headerRow } from "./support/app";
import { expectTopmost } from "./support/occlusion";

function presetMenuButton(page: Page, sectionId: string) {
  return headerRow(page, sectionId)
    .locator("..")
    .locator(".section-preset-btn");
}

test("a section preset popover paints over its own sticky header, not under it", async ({
  page,
}) => {
  await openBuilder(page);
  await presetMenuButton(page, "gear").click();

  const popover = page.locator(".preset-popover");
  await expect(popover).toBeVisible();

  // Teleported out of the section, not just placed to dodge the trap by luck of this layout.
  await expect(
    popover.evaluate((el) => !el.closest("[data-section-id]")),
  ).resolves.toBe(true);

  await expectTopmost(popover);
});
