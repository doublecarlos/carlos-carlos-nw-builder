// build-info.ts
//
// Values derived from package.json and substituted into the bundle. Shared by vite.config.ts
// and vitest.config.ts -- code that reads them has to compile under the unit suite too, where
// there is no Vite build to supply them.
import { createRequire } from "node:module";

const pkg = createRequire(import.meta.url)("./package.json") as {
  version: string;
  repository: { url: string };
  bugs: { url: string };
};

/** package.json carries the clone URL (`git+….git`); a link in the UI needs the page a
 *  browser can open. */
const browsableRepoUrl = pkg.repository.url
  .replace(/^git\+/, "")
  .replace(/\.git$/, "");

export const APP_DEFINES = {
  __APP_VERSION__: JSON.stringify(pkg.version),
  __APP_REPO_URL__: JSON.stringify(browsableRepoUrl),
  __APP_ISSUES_URL__: JSON.stringify(pkg.bugs.url),
};
