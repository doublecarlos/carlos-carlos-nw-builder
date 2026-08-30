// A web app manifest is JSON with no comments and no build step behind it, and a browser that
// dislikes it simply declines to offer "install" -- silently, with nothing failing. So the
// reasoning for what it contains lives here, next to the assertions that hold it in place:
// against index.html, which carries the same name and description; against src/base.css, whose
// --bg is the colour the launch splash has to match; and against public/, which has to actually
// ship the icons it names.
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
const baseCss = read("src/base.css");

/** The manifest as index.html itself names it -- so renaming the file without updating the
 *  link is a failure here rather than a missing install prompt in production. */
const href = html.match(/<link rel="manifest" href="([^"]+)"/)?.[1] ?? "";
const manifest = JSON.parse(read(path.join("public", href)));

const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? "";
const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1] ?? "";

const metaContent = (key: string) =>
  html
    .match(new RegExp(`<meta[^>]*name="${key}"[^>]*>`, "s"))?.[0]
    .match(/content="([^"]*)"/)?.[1];

/** The light theme's --bg, which is what a manifest colour has to agree with: the file has one
 *  slot per colour and no way to express a scheme, so it states the default one. */
const lightBg = baseCss.match(/:root\s*\{[^}]*--bg:\s*([^;]+);/)?.[1].trim();

describe("the manifest link", () => {
  it("names a file this repo ships from the deploy root", () => {
    expect(href).toBeTruthy();
    expect(href.startsWith("/")).toBe(true);
    expect(existsSync(path.join(root, "public", href))).toBe(true);
  });

  it("uses the .webmanifest extension browsers and hosts both recognise", () => {
    expect(href.endsWith(".webmanifest")).toBe(true);
  });
});

describe("identity", () => {
  it("is the same app the page's own title names", () => {
    expect(title.startsWith(manifest.name)).toBe(true);
  });

  it("has a short name that survives a home screen label", () => {
    // Launchers give roughly twelve characters before they ellipsize, so the long name is not
    // a usable label and the short one has to stay under that.
    expect(manifest.short_name.length).toBeLessThanOrEqual(12);
    expect(title).toContain(manifest.short_name);
  });

  it("describes itself in the same words as the page", () => {
    expect(manifest.description).toBe(metaContent("description"));
  });

  it("declares the page's own language", () => {
    expect(manifest.lang).toBe(html.match(/<html lang="([^"]+)"/)?.[1]);
  });
});

// Routing lives in the query string, so the app is one URL. An installed copy therefore opens
// at the root, and every link it can reach is inside its own scope -- which is what keeps a
// shared `?build=...` link opening in the installed window rather than bouncing to a browser
// tab.
describe("scope and entry point", () => {
  it("opens at the site root, the only address the app really has", () => {
    expect(new URL(manifest.start_url, canonical).href).toBe(canonical);
  });

  it("scopes the installed app to the whole origin", () => {
    expect(new URL(manifest.scope, canonical).href).toBe(canonical);
  });

  it("has an id, so a later start_url change does not read as a different app", () => {
    expect(new URL(manifest.id, canonical).href).toBe(canonical);
  });

  it("asks for its own window", () => {
    // Anything other than these three leaves the app in a browser tab, and Chrome declines to
    // offer installation at all.
    expect(["standalone", "fullscreen", "minimal-ui"]).toContain(
      manifest.display,
    );
  });
});

describe("colours", () => {
  it("paints the window chrome in the theme's own background", () => {
    expect(lightBg).toBeTruthy();
    expect(manifest.theme_color).toBe(lightBg);
  });

  it("paints the launch splash to match, so the first frame does not flash", () => {
    // index.html's boot screen sits on this same colour; a mismatch shows as a flicker between
    // the splash and the page it hands over to.
    expect(manifest.background_color).toBe(lightBg);
  });

  it("agrees with the chrome colour the page declares for the same scheme", () => {
    const light = html
      .match(/<meta[^>]*media="\(prefers-color-scheme: light\)"[^>]*>/s)?.[0]
      .match(/content="([^"]*)"/)?.[1];
    expect(manifest.theme_color).toBe(light);
  });
});

describe("icons", () => {
  const icons: { src: string; sizes: string; type: string }[] = manifest.icons;

  it("offers the launcher and splash sizes an install prompt requires", () => {
    // Chrome wants at least a 192 for the launcher and a 512 for the splash; without both it
    // never offers to install. Both are PNGs `npm run icons` generates at exactly the size
    // their filename states, so the declared size and the filename move together.
    expect(icons).toEqual([
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ]);
  });

  it("ships every icon it names", () => {
    expect(
      icons
        .map(({ src }) => src)
        .filter((src) => !existsSync(path.join(root, "public", src))),
    ).toEqual([]);
  });
});
