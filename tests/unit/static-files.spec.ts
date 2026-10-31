// index.html, public/ and src/base.css repeat the same values (name, description, origin,
// theme colors, project URLs) with no build step checking they agree, and a browser or crawler
// that disagrees with them fails silently. These assertions re-read the committed files and pin
// those copies to each other rather than to literals.
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ISSUES_URL, REPO_URL } from "../../src/lib/app-info";

const root = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const html = read("index.html");
const head = html.slice(0, html.indexOf("<body"));
const privacy = read("public/privacy.html");
const robots = read("public/robots.txt");
const sitemap = read("public/sitemap.xml");
const baseCss = read("src/base.css");
const viteConfig = read("vite.config.ts");
const themeStore = read("src/stores/theme.ts");
const pkg = JSON.parse(read("package.json")) as {
  repository: { url: string };
  bugs: { url: string };
};

/** A tag's attributes as a map, so assertions do not care what order they were written in. */
function attrs(tag: string): Record<string, string> {
  return Object.fromEntries(
    [...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
  );
}

/** Every `<meta>` in index.html, keyed by whichever of `name`/`property` it carries. */
const metas = [...html.matchAll(/<meta\b[^>]*>/gs)].map((m) => attrs(m[0]));

const metaContent = (key: string) =>
  metas.find((m) => m.name === key || m.property === key)?.content;

const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
const description = metaContent("description") ?? "";

/** The deployed origin. Every other absolute URL is checked against this one. */
const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? "";

/** The manifest as index.html links it, so a rename has to update the link too. */
const manifestHref = html.match(/<link rel="manifest" href="([^"]+)"/)?.[1];
const manifest = JSON.parse(read(path.join("public", manifestHref ?? "")));

const jsonLd = html.match(
  /<script type="application\/ld\+json">(.*?)<\/script>/s,
)?.[1];
const graph: Record<string, unknown>[] = jsonLd
  ? (JSON.parse(jsonLd)["@graph"] ?? [])
  : [];

function node(type: string): Record<string, unknown> {
  const found = graph.find((entry) => entry["@type"] === type);
  expect(found, `no ${type} node`).toBeTruthy();
  return found!;
}

/** Custom properties declared in the first block matching `selector`. */
function tokens(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`no ${selector} block`);
  const block = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries(
    [...block.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [
      m[1],
      m[2].trim(),
    ]),
  );
}

const appLight = tokens(baseCss, ":root {");
const appDark = tokens(baseCss, ".dark {");

describe("app identity", () => {
  it("names the same app in the title and the manifest", () => {
    expect(title.startsWith(manifest.name)).toBe(true);
    expect(title).toContain(manifest.short_name);
  });

  it("says the same title to Open Graph and Twitter", () => {
    for (const key of ["og:title", "twitter:title"])
      expect(metaContent(key)).toBe(title);
  });

  it("describes itself in the same words everywhere", () => {
    for (const key of ["og:description", "twitter:description"])
      expect(metaContent(key)).toBe(description);
    expect(manifest.description).toBe(description);
    expect(node("WebApplication").description).toBe(description);
  });

  // A site name contradicted elsewhere on its own home page is weighed against.
  it("uses one site name across structured data, Open Graph, title and heading", () => {
    const name = node("WebSite").name as string;
    expect(name).toBe(metaContent("og:site_name"));
    expect(title).toContain(name);
    expect(html.match(/<h1[^>]*>\s*([^<]*?)\s*<\/h1>/)?.[1]).toContain(name);
  });

  it("declares the page's language in the manifest", () => {
    expect(manifest.lang).toBe(html.match(/<html lang="([^"]+)"/)?.[1]);
  });
});

// A canonical link that disagrees with og:url splits the page's identity, and a Sitemap line
// pointing at the wrong host is simply ignored.
describe("the deployed origin", () => {
  it("is declared canonically as the site root", () => {
    // Routing lives in the query string, so the root is the only address the site has.
    expect(canonical).toMatch(/^https:\/\/[^/]+\/$/);
  });

  it("is the URL link previews and structured data name", () => {
    expect(metaContent("og:url")).toBe(canonical);
    // A WebSite url off the home page is not read for a site name at all.
    for (const entry of graph) expect(entry.url).toBe(canonical);
  });

  it("hosts the preview image, which the repo ships", () => {
    for (const key of ["og:image", "twitter:image"]) {
      const src = metaContent(key);
      // Absolute, because an unfurler may not resolve a relative path.
      expect(src?.startsWith(canonical)).toBe(true);
      expect(
        existsSync(path.join(root, "public", src!.slice(canonical.length))),
      ).toBe(true);
    }
    expect(metaContent("og:image:alt")).toBeTruthy();
  });

  it("is the host the site name falls back to last", () => {
    const alternates = node("WebSite").alternateName as string[];
    const host = new URL(canonical).host;
    expect(alternates.at(-1)).toBe(host);
    // Only a lowercase host is read as a name preference.
    expect(host).toBe(host.toLowerCase());
  });

  it("is where robots.txt points for the sitemap", () => {
    expect(robots.match(/^Sitemap: (\S+)$/m)?.[1]).toBe(
      new URL("sitemap.xml", canonical).href,
    );
  });

  it("heads the sitemap, which lists it and the privacy notice and nothing else", () => {
    // Anything reachable by query string canonicalizes back to the root.
    expect(
      [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]),
    ).toEqual([canonical, new URL("privacy.html", canonical).href]);
  });

  it("is where the privacy page says it lives", () => {
    expect(privacy.match(/rel="canonical"[\s\S]*?href="([^"]+)"/)?.[1]).toBe(
      new URL("privacy.html", canonical).href,
    );
  });

  // An installed copy opens at the root and keeps every reachable link in its own window.
  it("is the manifest's start URL, scope and id", () => {
    const resolve = (key: string) => new URL(manifest[key], canonical).href;
    expect({
      start_url: resolve("start_url"),
      scope: resolve("scope"),
      id: resolve("id"),
    }).toEqual({ start_url: canonical, scope: canonical, id: canonical });
  });
});

// The manifest, the browser chrome, the boot screen and the standalone privacy page all paint
// before or without src/base.css, so each carries its own copy of the theme's colors.
describe("theme colors", () => {
  it("paints the manifest chrome and splash in the light background", () => {
    // The manifest has one slot per color and no way to express a scheme.
    expect(appLight["--bg"]).toBeTruthy();
    expect(manifest.theme_color).toBe(appLight["--bg"]);
    expect(manifest.background_color).toBe(appLight["--bg"]);
  });

  it("declares a browser chrome color per scheme", () => {
    expect(
      metas
        .filter((m) => m.name === "theme-color")
        .map((m) => [m.media, m.content]),
    ).toEqual([
      ["(prefers-color-scheme: light)", appLight["--bg"]],
      ["(prefers-color-scheme: dark)", appDark["--bg"]],
    ]);
  });

  it("paints the boot screen in both backgrounds", () => {
    const bootBg = (selector: string) =>
      head
        .match(
          new RegExp(`${selector}\\s*\\{[^}]*background:\\s*([^;]+);`),
        )?.[1]
        .trim();
    expect(bootBg("\\.boot")).toBe(appLight["--bg"]);
    expect(bootBg("\\.dark \\.boot")).toBe(appDark["--bg"]);
  });

  it("reuses the app's colors on the privacy page", () => {
    const shared = ["--bg", "--text", "--muted", "--accent", "--line"];
    const light = tokens(privacy, ":root {");
    const dark = tokens(privacy, "@media (prefers-color-scheme: dark)");
    const pick = (from: Record<string, string>) =>
      Object.fromEntries(shared.map((name) => [name, from[name]]));
    expect(pick(light)).toEqual(pick(appLight));
    expect(pick(dark)).toEqual(pick(appDark));
  });
});

// The inline script and styles that theme the boot screen cannot import src/stores/theme.ts
// (which owns the key) or src/base.css (which owns the class and root metrics).
describe("index.html's pre-paint theme", () => {
  it("pins the root font size src/base.css sets, so nothing resizes when it lands", () => {
    const rootSize = /html\s*\{[^}]*font-size:\s*([^;]+);/;
    const inApp = baseCss.match(rootSize)?.[1].trim();
    expect(inApp).toBeTruthy();
    expect(head.match(rootSize)?.[1].trim()).toBe(inApp);
  });

  it("pins a line height too, which Tailwind's preflight would otherwise change", () => {
    // The value comes from preflight, so only e2e can compare it; this guards its presence.
    expect(head).toMatch(/html\s*\{[^}]*line-height:\s*[^;]+;/);
  });

  it("reads the key the theme store writes", () => {
    const key = themeStore.match(/useStorage<[^>]*>\(\s*"([^"]+)"/)?.[1];
    expect(key).toBeTruthy();
    expect(head).toContain(`localStorage.getItem("${key}")`);
  });

  it("sets the class base.css themes on", () => {
    expect(baseCss).toMatch(/^\.dark\s*\{/m);
    expect(head).toContain('classList.add("dark")');
    expect(head).toMatch(/\.dark \.boot\s*\{/);
  });

  it("survives a browser that refuses localStorage", () => {
    // Blocked site data makes the getter itself throw, which would take the page with it.
    expect(head).toMatch(/try\s*\{[\s\S]*localStorage[\s\S]*\}\s*catch/);
  });
});

describe("project URLs", () => {
  it("links the repository and issue tracker package.json declares", () => {
    expect(ISSUES_URL).toBe(pkg.bugs.url);
    expect(REPO_URL).toBe(
      pkg.repository.url.replace(/^git\+/, "").replace(/\.git$/, ""),
    );
  });

  it("links pages a browser can open, not clone URLs", () => {
    for (const url of [REPO_URL, ISSUES_URL]) {
      expect(url).toMatch(/^https:\/\//);
      expect(url).not.toMatch(/^git\+|\.git$/);
    }
  });

  it("points the privacy page at the same issue tracker", () => {
    expect(privacy).toContain(`href="${pkg.bugs.url}"`);
  });
});

describe("crawler rules", () => {
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

  it("has one structured data block, since a second would compete with it", () => {
    expect(html.match(/application\/ld\+json/g)).toHaveLength(1);
    expect(JSON.parse(jsonLd!)["@context"]).toBe("https://schema.org");
  });

  it("tells a visitor without JavaScript why the page is empty", () => {
    expect(html.slice(html.indexOf("<body"))).toMatch(/<noscript>/);
  });
});

// Chrome silently declines to offer installation when these are missing.
describe("install requirements", () => {
  it("asks for its own window", () => {
    expect(["standalone", "fullscreen", "minimal-ui"]).toContain(
      manifest.display,
    );
  });

  it("offers a 192 launcher icon and a 512 splash icon", () => {
    const sizes = (manifest.icons as { sizes: string }[]).map((i) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  });

  it("has a short name that fits a home screen label", () => {
    // Launchers ellipsize after roughly twelve characters.
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
  });
});
