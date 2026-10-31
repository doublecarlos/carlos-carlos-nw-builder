// The static first frame in index.html: what a crawler that never runs the bundle reads, and
// what a visitor sees until the app mounts and replaces it.
import { test, expect } from "@playwright/test";

test("the copy a crawler reads is really rendered, not just present", async ({
  page,
}) => {
  // Blocking the entry module keeps the first frame on screen. Text that only ever exists for
  // crawlers is cloaking, so the splash has to actually show what it claims to serve them.
  await page.route(/\/src\/main\.ts(\?|$)/, (route) => route.abort());
  await page.goto("/");

  const boot = page.getByTestId("boot-screen");
  await expect(boot).toBeVisible();
  await expect(boot.getByRole("heading", { level: 1 })).toBeVisible();
  const paragraphs = boot.locator("p");
  expect(await paragraphs.count()).toBeGreaterThan(0);
  for (const paragraph of await paragraphs.all())
    await expect(paragraph).toBeVisible();
});

test("the first frame does not resize when the app's stylesheet arrives", async ({
  page,
}) => {
  // Every metric on the splash derives from the root font size and the inherited line height,
  // and the app's stylesheet sets both on the same element. Whichever the boot styles leave
  // out, the whole screen jumps the moment that stylesheet lands -- 16px stepping down to
  // 14px, or `normal` loosening to 1.5.
  await page.route(/\/src\/main\.ts(\?|$)/, (route) => route.abort());
  await page.goto("/");
  await expect(page.getByTestId("boot-screen")).toBeVisible();
  const firstFrame = await page.evaluate(() => ({
    fontSize: getComputedStyle(document.documentElement).fontSize,
    lineHeight: getComputedStyle(document.querySelector(".boot")!).lineHeight,
  }));
  // Inherited from the browser rather than declared, which is the bug this guards.
  expect(firstFrame.lineHeight).not.toBe("normal");

  await page.unroute(/\/src\/main\.ts(\?|$)/);
  await page.goto("/");
  await expect(page.getByTestId("landing")).toBeVisible({ timeout: 15000 });
  const mounted = await page.evaluate(() => ({
    fontSize: getComputedStyle(document.documentElement).fontSize,
    lineHeight: getComputedStyle(document.body).lineHeight,
  }));

  expect(firstFrame).toEqual(mounted);
});

test("the boot screen is what the page opens on, and the app replaces it", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByTestId("landing")).toBeVisible({ timeout: 15000 });
  // Vue clears #app on mount, so nothing of the static first frame may survive alongside the
  // app -- a leftover would duplicate the title and give the page two h1s.
  await expect(page.getByTestId("boot-screen")).toHaveCount(0);
  await expect(page.locator("h1")).toHaveCount(1);
});
