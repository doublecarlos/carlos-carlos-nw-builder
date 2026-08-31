// What a crawler, a link unfurler and a real visitor each get from the served page. The head
// tags themselves are pinned in tests/unit/seo-metadata.spec.ts against the committed source;
// these check the parts only a server and a browser can show -- that the markup survives the
// pipeline, that robots.txt is actually served, and that the boot screen hands over to the app
// instead of lingering behind it.
import { test, expect } from "@playwright/test";

test("the served HTML carries the app's name and purpose before any script runs", async ({
  page,
}) => {
  const response = await page.request.get("/");
  expect(response.status()).toBe(200);
  const html = await response.text();

  // A crawler that never runs the bundle sees exactly this.
  expect(html).toContain("NW Builder");
  expect(html).toContain("Neverwinter");
  expect(html).toContain('name="description"');
  expect(html).toContain('property="og:title"');
  expect(html).toMatch(/<link rel="canonical" href="https:\/\/[^"]+"/);
  expect(html).toContain('type="application/ld+json"');
  expect(html).toMatch(/<h1[^>]*>/);
});

test("robots.txt is served and keeps crawlers off the OCR assets", async ({
  page,
}) => {
  const response = await page.request.get("/robots.txt");
  expect(response.status()).toBe(200);

  const body = await response.text();
  expect(body).toContain("User-agent: *");
  expect(body).toContain("Disallow: /tessdata/");
  // Absolute by spec, so it names the deployed origin rather than wherever this ran.
  expect(body).toMatch(/^Sitemap: https:\/\/\S+\/sitemap\.xml$/m);
});

test("the sitemap is served as XML a crawler can parse", async ({ page }) => {
  const response = await page.request.get("/sitemap.xml");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("xml");

  const body = await response.text();
  expect(body).toContain("http://www.sitemaps.org/schemas/sitemap/0.9");
  expect(body).toMatch(/<loc>https:\/\/\S+<\/loc>/);
});

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
  await expect(
    boot.getByText("Create and compare Neverwinter builds."),
  ).toBeVisible();
  await expect(boot.getByText(/customization\s+layers/)).toBeVisible();
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
