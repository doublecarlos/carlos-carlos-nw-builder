// The location is one shared pick. A bonus that holds in a place shows the Location control on
// its own row, and the Shared inputs section shows it too, all writing the same pick. A build
// whose gear cares about no place shows no Location at all.
import { test, expect, type Locator, type Page } from "@playwright/test";
import {
  chooseCombo,
  chooseItem,
  ensureSectionExpanded,
  headerRow,
  openBuilder,
  pickerInput,
  slotRow,
} from "./support/app";

const LOCATION = "globals.location";
const SHARED = "globals";

const control = (row: Locator) => row.getByTestId(`shared-picker-${LOCATION}`);

async function equipThayReaders(page: Page) {
  await ensureSectionExpanded(page, "gear");
  await chooseItem(page, "gear.ring1", "M31 Runebound Shackle");
  await chooseItem(page, "gear.shirt", "M31 Bloodwoven Signs");
}

test("a fresh build shows no Location", async ({ page }) => {
  await openBuilder(page);
  await expect(headerRow(page, "gear")).toBeVisible();
  await expect(headerRow(page, SHARED)).toBeHidden();
  await expect(page.getByTestId(`shared-picker-${LOCATION}`)).toHaveCount(0);
});

test("one Location control is shared by two reader rows and the section row", async ({
  page,
}) => {
  await openBuilder(page);
  await equipThayReaders(page);
  await ensureSectionExpanded(page, SHARED);
  const ring = slotRow(page, "gear.ring1");
  const shirt = slotRow(page, "gear.shirt");
  const own = pickerInput(slotRow(page, LOCATION));

  await chooseCombo(control(ring), "Thay");
  await expect(own).toHaveValue("Thay");
  await expect(control(shirt).getByTestId("picker-input")).toHaveValue("Thay");
  await expect(page.getByTestId(`slot-used-by:${LOCATION}`)).toHaveText(
    "Used by M31 Thayan Predator, M31 Critical Empowerment",
  );

  await chooseItem(page, LOCATION, "Chult");
  await expect(control(ring).getByTestId("picker-input")).toHaveValue("Chult");
  await expect(control(shirt).getByTestId("picker-input")).toHaveValue("Chult");
});
