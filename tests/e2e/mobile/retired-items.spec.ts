// The build's retired-items notice on a phone: hover can't explain its parts there, so the
// list of retired items opens on a tap and the icon actions say what they do.
import { test, expect } from "@playwright/test";
import { chooseItem, openBuilder } from "../support/app";
import { importTestCatalog } from "../support/testCatalog";

test("the retired notice explains itself without hover", async ({ page }) => {
  await openBuilder(page);
  await importTestCatalog(page, {
    items: [
      {
        id: "test-old-ring",
        name: "Test Old Ring",
        filter: "gear_ring",
        replacedBy: "test-new-ring",
      },
      { id: "test-new-ring", name: "Test New Ring", filter: "gear_ring" },
    ],
  });
  await chooseItem(page, "gear.ring1", "Test Old Ring");
  await expect(page.getByTestId("retired-items")).toBeVisible();

  await page.getByTestId("retired-items-count").tap();
  await expect(page.getByTestId("tooltip")).toContainText(
    "Test Old Ring → Test New Ring",
  );
  await expect(page.getByTestId("retired-items-show")).toContainText("Show");
  await expect(page.getByTestId("retired-items-apply")).toContainText(
    "Replace all",
  );
});
