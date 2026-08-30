// The manifest's contents are pinned against the committed source in
// tests/unit/manifest.spec.ts. What only a server and a browser can show is here: that the file
// survives the pipeline to the deploy root, that it arrives with a content type a browser will
// parse rather than download, and that the URLs inside it resolve on the running site.
import { test, expect } from "@playwright/test";

test("the page links a manifest the server actually has", async ({ page }) => {
  await page.goto("/");

  const link = page.locator('link[rel="manifest"]');
  await expect(link).toHaveAttribute("href", /\.webmanifest$/);

  const response = await page.request.get((await link.getAttribute("href"))!);
  expect(response.status()).toBe(200);
  // Browsers accept application/manifest+json; anything with `json` in it parses, while a
  // host answering text/plain or octet-stream gets the manifest ignored or downloaded.
  expect(response.headers()["content-type"]).toContain("json");
});

test("the manifest is JSON with the fields an install prompt needs", async ({
  request,
}) => {
  const response = await request.get("/manifest.webmanifest");

  const manifest = JSON.parse(await response.text());
  expect(manifest.name).toBeTruthy();
  expect(manifest.short_name).toBeTruthy();
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.length).toBeGreaterThan(0);
});

test("every icon the manifest names resolves to an image", async ({
  request,
}) => {
  const response = await request.get("/manifest.webmanifest");
  const manifest = JSON.parse(await response.text());

  for (const { src } of manifest.icons as { src: string }[]) {
    const icon = await request.get(src);
    expect(icon.status()).toBe(200);
    expect(icon.headers()["content-type"]).toMatch(/^image\//);
  }
});

test("the installed app's entry point is the app itself", async ({ page }) => {
  const manifest = JSON.parse(
    await (await page.request.get("/manifest.webmanifest")).text(),
  );

  // start_url is what the launcher opens, and nothing else in the app exercises it, so a
  // wrong one shows up only on someone's home screen.
  await page.goto(manifest.start_url);
  await expect(page.getByTestId("landing")).toBeVisible({ timeout: 15000 });
});
