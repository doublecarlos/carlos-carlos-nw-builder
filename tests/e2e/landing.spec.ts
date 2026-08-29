// Landing screen: what a first visit (no builds, no layers) shows, and the way out of it.
import { test, expect } from "@playwright/test";
import { openBuilder } from "./support/app";
import {
  buildRow,
  openRowMenu,
  confirmDangerAction,
  addBuild,
} from "./support/nav";

test("a fresh visit lands on the intro with a New build button", async ({
  page,
}) => {
  await page.goto("/");

  const landing = page.getByTestId("landing");
  await expect(landing).toBeVisible({ timeout: 10000 });
  await expect(
    landing.getByRole("heading", { name: "Carlos Carlos' NW Builder" }),
  ).toBeVisible();
  await expect(
    landing.getByText("Create and compare Neverwinter builds."),
  ).toBeVisible();

  // The watermark is decoration: present, faint, and invisible to the a11y tree.
  const watermark = page.getByTestId("landing-watermark");
  await expect(watermark).toHaveAttribute("aria-hidden", "true");
  const opacity = await watermark.evaluate((el) =>
    Number(getComputedStyle(el).opacity),
  );
  expect(opacity).toBeGreaterThan(0);
  expect(opacity).toBeLessThan(0.2);
});

test("New build leaves the landing screen for the builder", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("landing-new-build").click();

  await expect(page.getByTestId("landing")).toBeHidden();
  await expect(page.getByTestId("nav-column")).toBeVisible();
});

test("entering the builder lands on the one build the store already keeps", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("landing-new-build").click();

  const nav = page.getByTestId("nav-column");
  await expect(nav.getByRole("button", { name: "Build 1" })).toBeVisible();
  await expect(nav.getByRole("button", { name: /^Build \d+$/ })).toHaveCount(1);
});

test("a visit with stored builds skips the landing", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("landing-new-build").click();
  await expect(page.getByTestId("editor-column")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("editor-column")).toBeVisible({
    timeout: 10000,
  });
  await expect(page.getByTestId("landing")).toBeHidden();
});

test("deleting the last build drops back to the landing", async ({ page }) => {
  await openBuilder(page);

  const menu = await openRowMenu(buildRow(page, "Build 1"));
  await confirmDangerAction(menu, "Delete");

  await expect(page.getByTestId("landing")).toBeVisible();
  await expect(page.getByTestId("editor-column")).toBeHidden();
});

test("deleting all but one build keeps the builder up", async ({ page }) => {
  await openBuilder(page);
  await addBuild(page);

  const menu = await openRowMenu(buildRow(page, "Build 2"));
  await confirmDangerAction(menu, "Delete");

  await expect(page.getByTestId("editor-column")).toBeVisible();
  await expect(page.getByTestId("landing")).toBeHidden();
});

test("the landing survives a reload after the last build is deleted", async ({
  page,
}) => {
  await openBuilder(page);
  const menu = await openRowMenu(buildRow(page, "Build 1"));
  await confirmDangerAction(menu, "Delete");
  await expect(page.getByTestId("landing")).toBeVisible();

  // The build waiting behind the landing screen is a placeholder: it must not have been
  // written on the way out, or the next visit would open straight into the builder.
  await page.reload();
  await expect(page.getByTestId("landing")).toBeVisible({ timeout: 10000 });
});

test("New build works again after deleting the last build", async ({
  page,
}) => {
  await openBuilder(page);
  const menu = await openRowMenu(buildRow(page, "Build 1"));
  await confirmDangerAction(menu, "Delete");

  await page.getByTestId("landing-new-build").click();
  await expect(page.getByTestId("editor-column")).toBeVisible();
  await expect(
    page.getByTestId("nav-column").getByRole("button", { name: /^Build \d+$/ }),
  ).toHaveCount(1);
});
