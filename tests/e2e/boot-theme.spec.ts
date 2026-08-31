// The boot screen's theme, which is decided before any of the app's own code runs.
//
// Each test blocks the entry module, so the static boot screen stays on screen instead of
// being replaced a moment later -- that hand-over is exactly the window these assertions are
// about, and it is far too short to catch by racing it.
import { test, expect, type Browser } from "@playwright/test";

async function bootWith(
  browser: Browser,
  preference: string,
  colorScheme: "light" | "dark",
) {
  const context = await browser.newContext({ colorScheme });
  await context.addInitScript(
    (pref) => localStorage.setItem("nw:theme", pref),
    preference,
  );
  const page = await context.newPage();
  // A regex, not a glob: the dev server appends a cache-busting `?t=…` to the entry module, and
  // a glob for the bare path silently matches nothing -- letting the app mount and replace the
  // very screen under test.
  await page.route(/\/src\/main\.ts(\?|$)/, (route) => route.abort());
  await page.goto("/");

  const boot = page.getByTestId("boot-screen");
  await expect(boot).toBeVisible();
  const background = await boot.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  const dark = await page
    .locator("html")
    .evaluate((el) => el.classList.contains("dark"));

  return { context, background, dark };
}

test("a stored dark preference wins over a light system", async ({
  browser,
}) => {
  const { context, dark } = await bootWith(browser, "dark", "light");
  expect(dark).toBe(true);
  await context.close();
});

test("a stored light preference wins over a dark system", async ({
  browser,
}) => {
  const { context, dark } = await bootWith(browser, "light", "dark");
  expect(dark).toBe(false);
  await context.close();
});

test("the system preference still decides when nothing is stored", async ({
  browser,
}) => {
  const onDark = await bootWith(browser, "system", "dark");
  expect(onDark.dark).toBe(true);
  await onDark.context.close();

  const onLight = await bootWith(browser, "system", "light");
  expect(onLight.dark).toBe(false);
  await onLight.context.close();
});

test("the two themes actually paint differently", async ({ browser }) => {
  // Compared rather than pinned to a literal: which colours they are is
  // tests/unit/seo-metadata.spec.ts's business, against src/base.css.
  const light = await bootWith(browser, "light", "light");
  const dark = await bootWith(browser, "dark", "light");

  expect(light.background).not.toBe(dark.background);
  await light.context.close();
  await dark.context.close();
});
