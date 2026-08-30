// These constants are substituted by the bundler rather than written in the source, so what is
// worth asserting is that the substitution happened: unreplaced, they are a ReferenceError.
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import {
  APP_VERSION,
  DISCLAIMER,
  ISSUES_URL,
  REPO_URL,
} from "../../src/lib/app-info";

const pkg = createRequire(import.meta.url)("../../package.json") as {
  version: string;
  repository: { url: string };
  bugs: { url: string };
};

describe("app info", () => {
  it("reports the published package version", () => {
    expect(APP_VERSION).toBe(pkg.version);
  });

  it("links to pages a browser can open, not clone URLs", () => {
    for (const url of [REPO_URL, ISSUES_URL]) {
      expect(url).toMatch(/^https:\/\//);
      expect(url).not.toMatch(/^git\+/);
      expect(url).not.toMatch(/\.git$/);
    }
  });

  it("points at the repository package.json declares", () => {
    expect(ISSUES_URL).toBe(pkg.bugs.url);
    expect(REPO_URL).toBe(
      pkg.repository.url.replace(/^git\+/, "").replace(/\.git$/, ""),
    );
  });

  it("states that the project is unofficial", () => {
    expect(DISCLAIMER).toMatch(/unofficial/i);
    expect(DISCLAIMER).toMatch(/not affiliated/i);
  });
});
