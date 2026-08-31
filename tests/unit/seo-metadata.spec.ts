// index.html carries the same three strings -- title, description, icon -- in up to four
// places each (plain meta, Open Graph, Twitter, JSON-LD), and nothing in the build checks that
// they still agree. Neither does anything notice when a colour, an icon path or a crawler rule
// drifts away from the file it was copied from. These assertions re-read the committed files
// and pin those relationships.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const html = read("index.html");
const robots = read("public/robots.txt");
const sitemap = read("public/sitemap.xml");
const baseCss = read("src/base.css");
const viteConfig = read("vite.config.ts");

/** A tag's attributes as a map, so assertions do not care what order they were written in. */
function attrs(tag: string): Record<string, string> {
  return Object.fromEntries(
    [...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
  );
}

/** Every `<meta>` in the document, keyed by whichever of `name`/`property` it carries. */
const metas = [...html.matchAll(/<meta\b[^>]*>/gs)].map((m) => attrs(m[0]));

function metaContent(key: string): string | undefined {
  return metas.find((m) => m.name === key || m.property === key)?.content;
}

const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
const description = metaContent("description") ?? "";

/** The deployed origin, taken from the canonical link. Every other absolute URL in the repo is
 *  checked against this rather than against a literal repeated here, so moving the site means
 *  changing index.html and watching the rest of these assertions say what else has to follow. */
const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? "";

const jsonLd = html.match(
  /<script type="application\/ld\+json">(.*?)<\/script>/s,
)?.[1];

/** The `--bg` token each theme declares in src/base.css. */
const themeBg = {
  light: baseCss.match(/:root\s*\{[^}]*--bg:\s*([^;]+);/)?.[1].trim(),
  dark: baseCss.match(/\.dark\s*\{[^}]*--bg:\s*([^;]+);/)?.[1].trim(),
};

describe("index.html head", () => {
  it("has a title naming the app and the game", () => {
    expect(title).toContain("NW Builder");
    expect(title).toContain("Neverwinter");
  });

  it("has a description that fits in a search result", () => {
    expect(description.length).toBeGreaterThan(50);
    // Google clips around 160 characters; a description that survives whole reads as a
    // sentence rather than a truncation.
    expect(description.length).toBeLessThanOrEqual(160);
  });

  it("says the same thing to search engines, Open Graph and Twitter", () => {
    for (const key of ["og:title", "twitter:title"])
      expect(metaContent(key)).toBe(title);
    for (const key of ["og:description", "twitter:description"])
      expect(metaContent(key)).toBe(description);
  });

  it("previews with an image that is actually shipped", () => {
    for (const key of ["og:image", "twitter:image"]) {
      const src = metaContent(key);
      expect(src).toBeTruthy();
      // Absolute, because an unfurler reads these tags out of context and may not resolve a
      // relative path -- but it still has to name a file this repo actually ships.
      expect(src!.startsWith(canonical)).toBe(true);
      expect(
        existsSync(path.join(root, "public", src!.slice(canonical.length))),
      ).toBe(true);
    }
    // A card built from an image needs the alt text as much as the page does.
    expect(metaContent("og:image:alt")).toBeTruthy();
  });

  it("declares a browser chrome colour per scheme, matching the theme", () => {
    expect(themeBg.light).toBeTruthy();
    expect(themeBg.dark).toBeTruthy();
    expect(
      metas
        .filter((m) => m.name === "theme-color")
        .map((m) => [m.media, m.content]),
    ).toEqual([
      ["(prefers-color-scheme: light)", themeBg.light],
      ["(prefers-color-scheme: dark)", themeBg.dark],
    ]);
  });
});

describe("index.html structured data", () => {
  const raw = jsonLd;

  it("is present and is valid JSON", () => {
    expect(raw).toBeTruthy();
    expect(() => JSON.parse(raw!)).not.toThrow();
  });

  it("describes a free web app about Neverwinter, in the page's own words", () => {
    const data = JSON.parse(raw!);
    expect(data["@context"]).toBe("https://schema.org");
    expect(data["@type"]).toBe("WebApplication");
    expect(data.description).toBe(description);
    expect(data.isAccessibleForFree).toBe(true);
    expect(data.about).toMatchObject({
      "@type": "VideoGame",
      name: "Neverwinter",
    });
  });
});

// The site's absolute URL is written out in four files, and nothing but agreement between them
// makes it right: a canonical link that disagrees with `og:url` splits the page's identity, and
// a Sitemap line pointing at the wrong host is simply ignored.
describe("the deployed origin", () => {
  it("is declared once, canonically, as the site root", () => {
    // Routing lives in the query string, so the root is the only address the site really has.
    expect(canonical).toMatch(/^https:\/\/[^/]+\/$/);
  });

  it("is the URL link previews and structured data both name", () => {
    expect(metaContent("og:url")).toBe(canonical);
    expect(JSON.parse(jsonLd!).url).toBe(canonical);
  });

  it("is where robots.txt sends a crawler for the sitemap", () => {
    expect(robots.match(/^Sitemap: (\S+)$/m)?.[1]).toBe(
      new URL("sitemap.xml", canonical).href,
    );
  });

  it("heads the sitemap, which lists it and the privacy notice and nothing else", () => {
    // A second entry only because privacy.html is its own file rather than a view of the app;
    // anything reachable by query string still canonicalises back to the root above.
    expect(
      [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]),
    ).toEqual([canonical, new URL("privacy.html", canonical).href]);
  });
});

describe("index.html boot screen", () => {
  const body = html.slice(html.indexOf("<body"));

  it("gives a crawler that never runs the bundle the app's name and purpose", () => {
    // The boot h1 can carry a status suffix while the bundle loads; the app name has to
    // survive it, so this pins the name rather than the whole heading.
    expect(body.match(/<h1[^>]*>\s*([^<]*?)\s*<\/h1>/)?.[1]).toContain(
      "Carlos Carlos' NW Builder",
    );
    expect(body).toContain("Neverwinter");
  });

  it("has exactly one h1, so the app's own header does not make a second", () => {
    expect(body.match(/<h1\b/g)).toHaveLength(1);
  });

  it("tells a visitor without JavaScript why the page is empty", () => {
    expect(body).toMatch(/<noscript>/);
  });
});

describe("public/robots.txt", () => {
  it("lets crawlers have the app itself", () => {
    expect(robots).toMatch(/^User-agent: \*$/m);
    expect(robots).toMatch(/^Allow: \/$/m);
  });

  it("keeps them out of every OCR asset vite.config.ts serves", () => {
    const block = viteConfig.match(/TESSERACT_ASSETS[^{]*\{(.*?)\n\};/s)?.[1];
    const served = [...(block ?? "").matchAll(/"(\/[^"]+)":/g)].map(
      (m) => m[1],
    );
    expect(served.length).toBeGreaterThan(0);

    const disallowed = [...robots.matchAll(/^Disallow: (\S+)$/gm)].map(
      (m) => m[1],
    );
    for (const url of served)
      expect(disallowed.some((prefix) => url.startsWith(prefix))).toBe(true);
  });
});
