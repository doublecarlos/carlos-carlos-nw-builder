// The item editor's stable fields. A mount's plain universal slot carries no shape and no
// preference, so it is the one that a save can silently drop.
import { test, expect, type Page } from "@playwright/test";
import { openBuilder, chooseCombo } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

const MOUNT = "ZZZ Test Stable Mount";

async function openNewMountForm(page: Page) {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-name-input").fill(MOUNT);
  await page.getByTestId("item-filter-input").fill("mount");
}

const slotRows = (page: Page) => page.locator(".insignia-slot-row");

test("a mount keeps every insignia slot across a save, universal ones included", async ({
  page,
}) => {
  await openNewMountForm(page);

  await page.getByTestId("item-add-insignia-slot").click();
  for (let i = 0; i < 3; i++) {
    await slotRows(page)
      .last()
      .getByRole("button", { name: "Add insignia slot" })
      .click();
  }
  await expect(slotRows(page)).toHaveCount(4);

  // Fixed, then two plain universal, then universal with a preference.
  await chooseCombo(page.getByTestId("item-insignia-slot-0"), "crescent");
  await chooseCombo(
    page.getByTestId("item-insignia-slot-preferred-3"),
    "regal",
  );

  await page.getByRole("button", { name: "Save item" }).click();
  await page.locator(".editor-row-name", { hasText: MOUNT }).first().click();

  // All four survive: the two carrying neither a shape nor a preference are universal slots,
  // not blank rows.
  await expect(slotRows(page)).toHaveCount(4);
  const slotValue = (id: string) =>
    page.getByTestId(id).getByTestId("picker-input");
  await expect(slotValue("item-insignia-slot-0")).toHaveValue("crescent");
  await expect(slotValue("item-insignia-slot-1")).toHaveValue("universal");
  await expect(slotValue("item-insignia-slot-2")).toHaveValue("universal");
  await expect(slotValue("item-insignia-slot-preferred-3")).toHaveValue(
    "regal",
  );
});
