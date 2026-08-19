// Two things that are easy to break silently, because nothing about a broken one looks wrong
// on screen: a `<label for>` pointing at an id that no control claims, and a combobox whose
// open/closed state and active option never reach the accessibility tree.
import { test, expect } from "@playwright/test";
import { openBuilder, slotRow, pickerInput } from "./support/app";

/** Opens every section, so the sweep below sees all ~200 rows rather than the few that start
 *  expanded. The toolbar's own "expand all" is the same control a user would reach for. */
async function expandEverything(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "expand all" }).click();
}

test("every label points at a control that exists", async ({ page }) => {
  await openBuilder(page);
  await expandEverything(page);

  const broken = await page.evaluate(() =>
    [...document.querySelectorAll("label[for]")]
      .map((label) => label.getAttribute("for")!)
      .filter((id) => !document.getElementById(id)),
  );

  expect(broken).toEqual([]);
});

test("every label is attached to something, by `for` or by wrapping", async ({
  page,
}) => {
  await openBuilder(page);
  await expandEverything(page);

  // A `<label>` with neither a `for` nor a control inside it names nothing at all -- the state
  // every slot row was in before, just without the dangling attribute to prove it.
  const orphans = await page.evaluate(() =>
    [...document.querySelectorAll("label")]
      .filter(
        (label) =>
          !label.getAttribute("for") &&
          !label.querySelector("input, select, textarea"),
      )
      .map((label) => label.textContent?.trim() ?? ""),
  );

  expect(orphans).toEqual([]);
});

test("no id is claimed twice", async ({ page }) => {
  await openBuilder(page);
  await expandEverything(page);

  // Slot ids are only unique within the slot list; as DOM ids they share one document-wide
  // namespace with everything else. A duplicate silently breaks `for`/`aria-*` targeting,
  // since every one of them resolves to whichever element happens to come first.
  const duplicates = await page.evaluate(() => {
    const seen = new Set<string>();
    const twice = new Set<string>();
    for (const el of document.querySelectorAll("[id]")) {
      if (seen.has(el.id)) twice.add(el.id);
      seen.add(el.id);
    }
    return [...twice];
  });

  expect(duplicates).toEqual([]);
});

test("clicking a slot label focuses that row's control", async ({ page }) => {
  await openBuilder(page);

  const row = slotRow(page, "enchantments.offense1");
  await row.locator(".slot-label").click();

  await expect(pickerInput(row)).toBeFocused();
});

test("a point_assignment row labels its steppers as a group", async ({
  page,
}) => {
  await openBuilder(page);
  await expandEverything(page);

  // No single stepper could honestly answer to "Leveling STR", so the row names the group
  // rather than pointing `for` at an arbitrary one of them.
  const row = slotRow(page, "raceLeveling.leveling_str");
  const group = row.getByRole("group");

  await expect(group).toHaveAttribute(
    "aria-labelledby",
    "slot-raceLeveling.leveling_str-label",
  );
});

test("the picker reports open state and the active option", async ({
  page,
}) => {
  await openBuilder(page);

  const row = slotRow(page, "enchantments.offense1");
  const input = pickerInput(row);

  await expect(input).toHaveAttribute("role", "combobox");
  await expect(input).toHaveAttribute("aria-expanded", "false");

  await input.click();
  await expect(input).toHaveAttribute("aria-expanded", "true");

  // The listbox the input claims to control has to be the one actually on screen, and the
  // active option has to be a row inside it -- a dangling id reads as no active option at all.
  const listboxId = (await input.getAttribute("aria-controls")) ?? "";
  const listbox = page.locator(`[id="${listboxId}"]`);
  await expect(listbox).toHaveAttribute("role", "listbox");

  const activeId = (await input.getAttribute("aria-activedescendant")) ?? "";
  await expect(listbox.locator(`[id="${activeId}"]`)).toHaveAttribute(
    "role",
    "option",
  );

  // Arrowing moves the active option, and the row it names is the one actually highlighted --
  // the two are derived from the same index, and this is what would catch them drifting apart.
  await page.keyboard.press("ArrowDown");
  await expect(input).not.toHaveAttribute("aria-activedescendant", activeId);

  const movedId = (await input.getAttribute("aria-activedescendant")) ?? "";
  await expect(listbox.locator(`[id="${movedId}"]`)).toHaveAttribute(
    "data-highlighted",
    "true",
  );
});

test("the picker drops its listbox wiring once closed", async ({ page }) => {
  await openBuilder(page);

  const row = slotRow(page, "enchantments.offense1");
  const input = pickerInput(row);
  await input.click();
  await expect(input).toHaveAttribute("aria-expanded", "true");

  await page.keyboard.press("Escape");

  await expect(input).toHaveAttribute("aria-expanded", "false");
  // Both would otherwise point at ids that no longer exist in the document.
  await expect(input).not.toHaveAttribute("aria-controls", /./);
  await expect(input).not.toHaveAttribute("aria-activedescendant", /./);
});
