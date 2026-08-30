// End-to-end coverage for the `options.class` migration: the class is an ordinary
// item_picker over `class`-tagged items, and the class item publishes the value everything that
// reads a class already expected. Nothing downstream was supposed to notice -- these are the
// four places that would break loudly if it had.
import { test, expect } from "@playwright/test";
import {
  openBuilder,
  slotRow,
  pickerInput,
  chooseItem,
  chooseClass,
  className,
} from "./support/app";

test("the class row is a picker over class items", async ({ page }) => {
  await openBuilder(page);
  const row = slotRow(page, "options.class");

  await pickerInput(row).click();
  // One row per class item, named by the item rather than by a hand-written option label.
  await expect(
    row.getByText(className("warlock"), { exact: true }),
  ).toBeVisible();
  await expect(
    row.getByText(className("wizard"), { exact: true }),
  ).toBeVisible();

  await row.getByText(className("warlock"), { exact: true }).click();
  await expect(pickerInput(row)).toHaveValue(className("warlock"));
});

test("picking a class still filters class-restricted items out of other pickers", async ({
  page,
}) => {
  await openBuilder(page);
  // A Warlock-only paragon: visible as a candidate for a warlock, gone for a wizard. The
  // filtering reads the *published* class now, not a stored context field.
  await chooseClass(page, "warlock");
  const paragon = slotRow(page, "options.paragon");
  await pickerInput(paragon).click();
  await expect(paragon.getByText("Hellbringer", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");

  await chooseClass(page, "wizard");
  await pickerInput(paragon).click();
  await expect(paragon.getByText("Hellbringer", { exact: true })).toHaveCount(
    0,
  );
});

test("a class-restricted item flags its class error against the published class", async ({
  page,
}) => {
  await openBuilder(page);
  await chooseClass(page, "warlock");
  await chooseItem(page, "options.paragon", "Hellbringer");
  await expect(slotRow(page, "options.paragon")).not.toContainText("requires");

  // Switching class leaves the now-illegal paragon equipped, which is exactly when the error
  // has to fire -- picker filtering alone would never surface it.
  await chooseClass(page, "wizard");
  await expect(slotRow(page, "options.paragon")).toContainText("requires");
});

test("the class is stored as a pick, not as a context value", async ({
  page,
}) => {
  await openBuilder(page);
  await chooseClass(page, "warlock");

  const firstBuild = page.locator(".nav-row--build").first();
  await firstBuild.locator(".nav-kebab").click();
  const downloadPromise = page.waitForEvent("download");
  await page
    .locator(".navmenu")
    .getByRole("button", { name: "Download…" })
    .click();
  const download = await downloadPromise;
  const text = await (
    await download.createReadStream()
  )
    .toArray()
    .then((chunks) => Buffer.concat(chunks).toString("utf-8"));
  const exported = JSON.parse(text);

  expect(exported.data.choices["options.class"]).toBe("class-warlock");
  // The old home of this value. A build written today should not be putting one here --
  // `context.class` only survives on builds saved before the migration.
  expect(exported.data.context.class).toBeUndefined();
});
