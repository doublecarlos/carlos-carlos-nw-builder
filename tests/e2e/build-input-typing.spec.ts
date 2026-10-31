// Typing over a build input from scratch: emptying the field must not refill it with the
// default mid-edit, while leaving it empty still falls back to the default.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder, chooseItem, slotRow } from "./support/app";
import { importTestCatalog } from "./support/testCatalog";

const SLOT = "gear.ring1";

async function openTypedRing(page: Page) {
  await openBuilder(page);
  await importTestCatalog(page, {
    items: [
      {
        id: "test-typed-ring",
        name: "Test Typed Ring",
        filter: "gear_ring",
        dynamicStats: [{ stat: "power", min: 100, max: 1000, default: 100 }],
      },
    ],
  });
  await chooseItem(page, SLOT, "Test Typed Ring");
  return slotRow(page, SLOT).getByTestId("slot-dynamic:power");
}

test("an emptied field stays empty while typing a new value", async ({
  page,
}) => {
  const input = await openTypedRing(page);
  // Deleting one character at a time writes each shorter value, so the last Backspace is
  // what would put the default back.
  await input.fill("250");
  await input.press("End");
  for (let i = 0; i < 3; i++) await input.press("Backspace");
  await expect(input).toHaveValue("");

  await input.pressSequentially("750");
  await expect(input).toHaveValue("750");
  await input.blur();
  await expect(input).toHaveValue("750");
});

test("a field left empty falls back to its default", async ({ page }) => {
  const input = await openTypedRing(page);
  await input.fill("750");
  await input.fill("");
  await input.blur();
  await expect(input).toHaveValue("100");
});
