// The About dialog and the disclaimer, which has to be reachable from inside the app and not
// only from the README.
import { test, expect } from "@playwright/test";
import { openBuilder } from "./support/app";

test("the landing screen states the project is unofficial", async ({
  page,
}) => {
  await page.goto("/");

  const disclaimer = page.getByTestId("landing-disclaimer");
  await expect(disclaimer).toBeVisible({ timeout: 15000 });
  await expect(disclaimer).toContainText("Unofficial fan-made tool");
  await expect(disclaimer).toContainText("not affiliated");
});

test("About opens from the header and names this build", async ({ page }) => {
  await openBuilder(page);

  await page.getByTestId("header-about").click();

  const dialog = page.getByTestId("about-dialog");
  await expect(dialog).toBeVisible();
  // Anchored, so the line is the version and nothing else -- but tolerant of the whitespace
  // the template indents it with, which a regex match does not normalise away.
  await expect(dialog.getByTestId("about-version")).toHaveText(
    /^\s*Version \d+\.\d+\.\d+\s*$/,
  );
});

test("About links out to the source and the issue tracker", async ({
  page,
}) => {
  await openBuilder(page);
  await page.getByTestId("header-about").click();

  const repo = page.getByTestId("about-repo-link");
  const issues = page.getByTestId("about-issues-link");

  for (const link of [repo, issues]) {
    await expect(link).toHaveAttribute("href", /^https:\/\/github\.com\//);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
  }
  await expect(issues).toHaveAttribute("href", /\/issues$/);
});

test("About reaches the privacy notice", async ({ page }) => {
  await openBuilder(page);
  await page.getByTestId("header-about").click();

  await expect(page.getByTestId("about-privacy-link")).toHaveAttribute(
    "href",
    "/privacy.html",
  );
});

test("About carries the disclaimer for anyone past the landing screen", async ({
  page,
}) => {
  await openBuilder(page);
  await page.getByTestId("header-about").click();

  await expect(page.getByTestId("about-disclaimer")).toContainText(
    "Unofficial fan-made tool",
  );
});

test("About closes on Escape and hands focus back", async ({ page }) => {
  await openBuilder(page);

  await page.getByTestId("header-about").click();
  await expect(page.getByTestId("about-dialog")).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(page.getByTestId("about-dialog")).toHaveCount(0);
  await expect(page.getByTestId("header-about")).toBeFocused();
});
