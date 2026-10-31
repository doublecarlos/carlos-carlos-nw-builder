// These constants are substituted by the bundler rather than written in the source, so what is
// worth asserting is that the substitution happened: unreplaced, they are a ReferenceError.
// The repository URLs are checked alongside the other copies in static-files.spec.ts.
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { APP_COMMIT, APP_VERSION } from "../../src/lib/app-info";

const pkg = createRequire(import.meta.url)("../../package.json") as {
  version: string;
};

describe("app info", () => {
  it("reports the published package version", () => {
    expect(APP_VERSION).toBe(pkg.version);
  });

  it("identifies the commit the bundle was built from", () => {
    expect(APP_COMMIT).toMatch(/^([0-9a-f]{7}|unknown)$/);
  });
});
