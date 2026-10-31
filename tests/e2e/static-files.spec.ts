// The files in public/ and index.html reach the browser through the server, not the bundle.
// Their contents are pinned against each other in tests/unit/static-files.spec.ts; what only a
// running server shows is that each one is served, with a content type a browser will use
// rather than ignore or download.
import { test, expect, type APIRequestContext } from "@playwright/test";

/** What the server answered for `url`, with the URL kept so a failure names it. */
async function served(request: APIRequestContext, url: string) {
  const response = await request.get(url);
  return {
    url,
    status: response.status(),
    type: response.headers()["content-type"] ?? "",
    text: () => response.text(),
  };
}

const servedAs = (type: RegExp) => ({
  status: 200,
  type: expect.stringMatching(type),
});

for (const [url, contentType] of [
  ["/", /^text\/html/],
  ["/privacy.html", /^text\/html/],
  ["/robots.txt", /^text\/plain/],
  ["/sitemap.xml", /xml/],
  // The browser asks for this one unprompted, whatever the page links.
  ["/favicon.ico", /^image\//],
] as const) {
  test(`${url} is served as ${contentType.source}`, async ({ request }) => {
    expect(await served(request, url)).toMatchObject(servedAs(contentType));
  });
}

test("the linked manifest is served as JSON and its icons as images", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");

  // Browsers parse anything with `json` in it; text/plain gets the manifest ignored.
  const response = await served(request, href!);
  expect(response).toMatchObject(servedAs(/json/));
  const manifest = JSON.parse(await response.text());

  for (const { src } of manifest.icons as { src: string }[])
    expect(await served(request, src)).toMatchObject(servedAs(/^image\//));
});

test("every icon the page links is served as an image", async ({
  page,
  request,
}) => {
  await page.goto("/");

  const hrefs = await page
    .locator('link[rel="icon"], link[rel="apple-touch-icon"]')
    .evaluateAll((links) =>
      links.map((link) => (link as HTMLLinkElement).getAttribute("href") ?? ""),
    );

  expect(hrefs.length).toBeGreaterThan(0);
  for (const href of hrefs)
    expect(await served(request, href)).toMatchObject(servedAs(/^image\//));
});

test("the installed app's entry point is the app itself", async ({
  page,
  request,
}) => {
  const manifest = JSON.parse(
    await (await request.get("/manifest.webmanifest")).text(),
  );

  // start_url is what the launcher opens, and nothing else in the app exercises it.
  await page.goto(manifest.start_url);
  await expect(page.getByTestId("landing")).toBeVisible({ timeout: 15000 });
});

// iOS composites a transparent icon onto black rather than the home screen's background, so
// the apple-touch icon must be painted on an opaque ground. Only a pixel read shows that.
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
