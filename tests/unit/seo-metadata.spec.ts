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

/** The nodes of that block's graph, and a node of a given type from it. */
const graph: Record<string, unknown>[] = jsonLd
  ? (JSON.parse(jsonLd)["@graph"] ?? [])
  : [];

function node(type: string): Record<string, unknown> {
  const found = graph.find((entry) => entry["@type"] === type);
  expect(found, `no ${type} node`).toBeTruthy();
  return found!;
}

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

  it("is a single graph, since a second block would compete with this one", () => {
    expect(html.match(/application\/ld\+json/g)).toHaveLength(1);
    expect(JSON.parse(raw!)["@context"]).toBe("https://schema.org");
    expect(graph.length).toBeGreaterThan(0);
  });

  it("describes a free web app about Neverwinter, in the page's own words", () => {
    const app = node("WebApplication");
    expect(app.description).toBe(description);
    expect(app.isAccessibleForFree).toBe(true);
    expect(app.about).toMatchObject({
      "@type": "VideoGame",
      name: "Neverwinter",
    });
  });

  // A site name contradicted elsewhere on its own home page is weighed against.
  it("names the site, in the same words every other name on the page uses", () => {
    const name = node("WebSite").name as string;
    expect(name).toBe(metaContent("og:site_name"));
    expect(title).toContain(name);
    expect(html.match(/<h1[^>]*>\s*([^<]*?)\s*<\/h1>/)?.[1]).toContain(name);
  });

  it("falls back through shorter names to the host, never past it", () => {
    const alternates = node("WebSite").alternateName as string[];
    const host = new URL(canonical).host;

    expect(alternates.at(-1)).toBe(host);
    // Only a lowercase host is read as a name preference.
    expect(host).toBe(host.toLowerCase());
    expect(alternates.length).toBeGreaterThan(1);
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
    // A WebSite url off the home page is not read for a site name at all.
    for (const entry of graph) expect(entry.url).toBe(canonical);
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

// The inline script that themes the boot screen is a third party to an agreement between
// src/stores/theme.ts (which owns the key) and src/base.css (which owns the class). It cannot
// import either, so nothing but these assertions would notice it being left behind.
describe("index.html's pre-paint theme script", () => {
  const head = html.slice(0, html.indexOf("<body"));
  const themeStore = read("src/stores/theme.ts");

  it("pins the root font size src/base.css sets, so nothing resizes when it lands", () => {
    // The boot screen is sized in rem and paints before that stylesheet exists. Left to the
    // browser default of 16px it renders 14% too big and then snaps down mid-load.
    const rootSize = /html\s*\{[^}]*font-size:\s*([^;]+);/;
    const inApp = baseCss.match(rootSize)?.[1].trim();
    expect(inApp).toBeTruthy();
    expect(head.match(rootSize)?.[1].trim()).toBe(inApp);
  });

  it("pins a line height too, which Tailwind's preflight would otherwise change", () => {
    // Its value comes from preflight rather than any file here, so only the e2e run can check
    // the two agree -- but a missing declaration is the whole failure, and that is visible.
    expect(head).toMatch(/html\s*\{[^}]*line-height:\s*[^;]+;/);
  });

  it("reads the key the theme store writes", () => {
    const key = themeStore.match(/useStorage<[^>]*>\(\s*"([^"]+)"/)?.[1];
    expect(key).toBeTruthy();
    expect(head).toContain(`localStorage.getItem("${key}")`);
  });

  it("sets the class base.css themes on, and boots dark from it", () => {
    expect(baseCss).toMatch(/^\.dark\s*\{/m);
    expect(head).toContain('classList.add("dark")');
    expect(head).toMatch(/\.dark \.boot\s*\{/);
  });

  it("paints the boot screen in the app's own two backgrounds", () => {
    const bootBg = (selector: string) =>
      head
        .match(
          new RegExp(`${selector}\\s*\\{[^}]*background:\\s*([^;]+);`),
        )?.[1]
        .trim();

    expect(bootBg("\\.boot")).toBe(themeBg.light);
    expect(bootBg("\\.dark \\.boot")).toBe(themeBg.dark);
  });

  it("survives a browser that refuses localStorage", () => {
    // Site data blocked makes the getter itself throw, which would take the page with it.
    expect(head).toMatch(/try\s*\{[\s\S]*localStorage[\s\S]*\}\s*catch/);
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
