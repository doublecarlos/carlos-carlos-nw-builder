# YANWB - Yet Another NW Builder

A client-only web app to plan Neverwinter builds.

## Technologies

1. **npm + Vite.** `npm run dev`/`build`/`preview`. Real ES modules throughout.
2. **Vue 3 SFCs**, Composition API, `<script setup lang="ts">` everywhere
3. **TypeScript, `strict: true`, real types, not `any`.**
4. **Modern JS/TS is expected** — `const`/`let`, arrows, classes, `?.`, `??`.

## Run and verify

```sh
npm run dev               # http://localhost:5173, Vite dev server + HMR
npm run build             # production build to dist/
npm run preview           # serve the production build locally
npm run test              # Vitest: unit tests + golden-fixture comparison
npm run test:ui           # Playwright: end-to-end tests against a real browser
npm run typecheck         # vue-tsc --noEmit
npm run lint              # ESLint (auto-fix)
npm run lint:check        # ESLint (check-only)
npm run format            # Prettier (auto-fix)
npm run format:check      # Prettier (check-only)
npm run verify            # lint + format:check + typecheck + test + test:ui, in sequence
```

`npm run test` must stay green. `npm run verify` must stay green before considering a change done.

## Layout

```
index.html            single entry: <script type="module" src="/src/main.ts">
vite.config.ts         @vitejs/plugin-vue, build.outDir: dist
tsconfig.json           strict: true, allowJs: true, resolveJsonModule: true
eslint.config.js        flat config: eslint-plugin-vue + typescript-eslint, scoped vitest/
                       playwright rules for tests/, Prettier owns formatting (skip-formatting
                       last)
.prettierrc.json        empty -- Prettier's own defaults, deliberately not overridden
data/                  *.json data (schema.json authoritative; slots/db-items/db-bonuses
                       generated) — no loader files, imported statically by src/data.ts
src/
  base.css              design tokens, resets, and primitives shared by 2+ unrelated
                       components only -- everything else lives in its owning component's
                       own `<style scoped>` (see below)
  types.ts             the shared domain model (Item/BonusSet/Grant/Schema/Db/Build/...) --
                       add a shape here, not a local `any`, when it crosses a file boundary
  data.ts              static imports of data/*.json + schema derivation (byKey/statKeys/etc.)
  conditions.ts        the `when` evaluator
  db.ts                indexing and lookups
  bonus.ts             bonus resolution
  engine.ts            pipeline + derived
  catalog.ts           layered catalogue: base + overlays (see below)
  router.ts            query-string <-> URL sync (view/collection/build/tab; editor owns `item`)
  storage.ts           builds, collections, import/export, share links, catalogue overlay
  fs-store.ts          File System Access API + IndexedDB handle persistence (collection save-to-file)
  format.ts            number/percent formatting at the edge
  main.ts              createApp(App).mount('#app')
  App.vue              root component, all state mutation, undo
  components/          Vue SFCs, <script setup lang="ts">
tests/
  unit/                Vitest unit + golden-fixture specs
  e2e/                  Playwright specs, run against a live `npm run dev` server
    support/            shared page helpers (selectors, common flows)
playwright.config.ts    testDir tests/e2e, starts the dev server, chromium only
```

## Architecture notes

- **One reactive `build` + a `computed` calling `resolveBuild`.** It is pure and ~2 ms —
  recompute on every change; do not build incremental update machinery.
- **Every mutation goes through an `App.vue` method.** That is what keeps the undo stack small.
- **`db` is `markRaw`'d.** 369 items plus Maps; deep-proxying costs more than the calculation.
- **Catalogue is layered**: base (shipped) ← workspace overlay (editor) ← `build.catalog`
  (per-build custom gear — plumbed but not yet exposed). An overlay is
  `{ items: { name: item|null }, bonusSets: { id: set|null } }`; `null` is a tombstone.
- **Items reference a bonus set by id, never by name.**
- **Percentages are decimals.** `0.09` is 9%. Format at the edge, never round in state.
- **`stats` vs `appliedStats`** on a resolved bonus: the former is per-stack (now the _sum_ of
  every active grant's stats), the latter is what reaches the pipeline. Reading `stats` and
  wondering why stacking "doesn't work" has caught two sessions.
- **Empty slot is `undefined` / `''` / `'-'`** — all three handled by `db.get`.
- **Duration is a free number of seconds**, not a bucket. Presets are convenience only.
- **Routing is query-string, not path** (`?build=…&view=…`) — a static host serves `index.html`
  by path only, so `/builds/x` would 404 on refresh; `?x=y` always resolves. `App.vue` owns
  `view`/`collection`/`build`/`tab` via a plain `watch` + `router.apply`; `DataEditor.vue` owns
  `item`/`set`/`section`/`status` itself, calling `router.apply` at each mutation site instead of
  a generic watcher for the selection params, because arrow-key list browsing needs `push:false`
  (replace) while a click needs `push:true` — a generic watcher can't tell those apart (`status`,
  the changed/added/edited/removed filter, has no such nuance and does use a plain `watch`, same
  as `tab`). Nothing needs a "did this change come from popstate" guard: `router.apply`'s own
  no-op-if-unchanged check makes re-applying state that came from a popstate event harmless.
- **Collections are a grouping layer, not a nesting one.**
- **Collection file-save uses the File System Access API, Chromium-only.**

## Behavior

- Justify decisions.
- Surface data ambiguities as **explicit decisions**, not guesses.
- Verify claims by testing the claim, not a proxy.
- When a check fails, work out whether the code or the test is wrong before "fixing" anything
- Commit only when asked. Branch rather than committing to `main` directly.
- When implementing a feature or fix, also add automated tests for it. Test intent, not exact code behavior. This is both for UI testing (playwright) or unit testing (vitest).
- `playwright-cli` is available if you need to "control" a browser to analyse page behavior on the spot.
- When creating branches, use an appropriate prefix (feature/, fix/, etc).
- Don't try to design icons by hand. If we need a new icon, ask for it.
- Comments should be concise, direct and describe the design intent of what the code is doing now. They should not reference plan files (as plans are discarded after some time), should not compare the code with an old implementation that doesn't exist anymore.
