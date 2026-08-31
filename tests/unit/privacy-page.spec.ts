// public/privacy.html is standalone: no bundle, no access to the app's colour tokens or to the
// URLs vite substitutes into lib/app-info.ts. Everything on it is therefore a second copy of
// something, and nothing in the build would notice one going stale.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const page = read("public/privacy.html");
const baseCss = read("src/base.css");
const pkg = JSON.parse(read("package.json")) as { bugs: { url: string } };
const canonical = read("index.html").match(
  /<link rel="canonical" href="([^"]+)"/,
)?.[1];

/** Prose with its line wrapping collapsed, so assertions survive a reformat. */
const text = page.replace(/\s+/g, " ");

const href = (attr: string) =>
  page.match(new RegExp(`${attr}[\\s\\S]*?href="([^"]+)"`))?.[1];

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

const SHARED = ["--bg", "--text", "--muted", "--accent", "--line"];

describe("privacy page", () => {
  it("reuses the app's light colours", () => {
    const app = tokens(baseCss, ":root {");
    const here = tokens(page, ":root {");
    for (const name of SHARED) expect(here[name]).toBe(app[name]);
  });

  it("reuses the app's dark colours", () => {
    const app = tokens(baseCss, ".dark {");
    const here = tokens(page, "@media (prefers-color-scheme: dark)");
    for (const name of SHARED) expect(here[name]).toBe(app[name]);
  });

  it("sits at the origin the app calls canonical", () => {
    expect(href('rel="canonical"')).toBe(
      new URL("privacy.html", canonical).href,
    );
  });

  it("points at the issue tracker package.json names", () => {
    expect(page).toContain(`href="${pkg.bugs.url}"`);
  });

  it("leads back to the builder", () => {
    expect(page).toContain('href="/"');
  });
});

// The assertion that outlives its sentence is the one that should have been deleted with it --
// which is the point of pinning the claims rather than the prose around them.
describe("privacy page disclosures", () => {
  it("says where a build lives and that screenshots stay put", () => {
    expect(text).toContain("IndexedDB");
    expect(text).toMatch(/Nothing is uploaded/i);
    expect(text).toMatch(/Import from game/);
    expect(text).toMatch(/never uploaded/i);
  });

  it("names the host and what its logs hold", () => {
    expect(text).toContain("Cloudflare");
    expect(text).toMatch(/IP address/i);
    expect(text).toMatch(/user-agent/i);
  });

  it("is explicit about what is absent", () => {
    for (const claim of [
      /No cookies/i,
      /No analytics/i,
      /No third-party services/i,
      /Nothing sold or shared/i,
    ]) {
      expect(text).toMatch(claim);
    }
  });

  it("tells a reader how to delete everything", () => {
    expect(text).toMatch(/clear this site's data/i);
  });
});
