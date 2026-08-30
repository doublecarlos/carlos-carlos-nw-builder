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
