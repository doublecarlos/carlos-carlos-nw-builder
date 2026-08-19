// The app declares its icons in index.html and serves them from public/. Both halves can break
// independently -- a renamed file leaves a live <link> pointing at a 404, and a dropped <link>
// sends the browser back to guessing /favicon.ico.
import { test, expect } from "@playwright/test";

test("every declared icon resolves to an image", async ({ page, request }) => {
  await page.goto("/");

  const hrefs = await page
    .locator('link[rel="icon"], link[rel="apple-touch-icon"]')
    .evaluateAll((links) =>
      links.map((link) => (link as HTMLLinkElement).getAttribute("href") ?? ""),
    );

  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs) {
    const response = await request.get(href);
    expect(response.status(), href).toBe(200);
    expect(response.headers()["content-type"], href).toMatch(/^image\//);
  }
});

test("/favicon.ico answers the browser's own unprompted request", async ({
  request,
}) => {
  const response = await request.get("/favicon.ico");

  expect(response.status()).toBe(200);
});

// iOS composites a transparent icon onto black rather than onto the home screen's own
// background, so the apple-touch icon is the one output that must be painted on an opaque
// ground. Nothing about the file's own format records that, hence the pixel read.
test("the apple-touch icon is fully opaque", async ({ page }) => {
  await page.goto("/");

  const minAlpha = await page.evaluate(async () => {
    const image = new Image();
    image.src = "/apple-touch-icon.png";
    await image.decode();

    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0);

    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let lowest = 255;
    for (let i = 3; i < data.length; i += 4) lowest = Math.min(lowest, data[i]);
    return lowest;
  });

  expect(minAlpha).toBe(255);
});
