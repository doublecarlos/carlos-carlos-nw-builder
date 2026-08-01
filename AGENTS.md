# YANWB - Yet Another NW Builder

A client-only web app to plan Neverwinter builds.

## Technologies

1. **npm + Vite.** `npm run dev`/`build`/`preview`. Real ES modules throughout.
2. **Vue 3 SFCs**, Composition API, `<script setup lang="ts">` everywhere.
3. **TypeScript, `strict: true`, real types, not `any`.**
4. **Modern JS/TS is expected** — `const`/`let`, arrows, classes, `?.`, `??`.

## Required checks

These must pass before a change is considered done:

- `npm run fix` - to perform autoformatting and linting
- `npm run typecheck` - typecheck
- `npm run test` - unit tests
- `npm run test:ui` - UI tests

## Behavior

- Git:
  - Don't change `main` directly. Create a prefixed branch if you're not in one already.
  - Prefixes: `feature/`, `bugfix/`, `chore/`
- Follow best practices
- If anything is unclear, ask for clarification explicitly
- When a check fails, work out whether the code or the test is wrong before "fixing" anything
- When implementing a change:
  - Add automated tests
  - Test intent, not exact code behavior
  - For UI tests, use data-testid for reliable locators whenever possible. You are free to add this attribute to components if they don't already have it as needed.
- Code comments:
  - Should be concise, direct and describe the design intent of what the code is doing now.
  - They should not reference plan files (as plans are discarded after some time)
  - Should not compare the code with an old implementation that doesn't exist anymore.

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
  catalog.ts           layered catalogue: base + overlays
  router.ts            query-string <-> URL sync (build/layer/tab)
  storage.ts           builds, layers, import/export, share links, overlay persistence
  idb.ts               IndexedDB wrapper (per-record writes, no bulk ops)
  format.ts            number/percent formatting at the edge
  main.ts              createApp(App).mount('#app')
  App.vue              root component, routing, keyboard shortcuts
  stores/
    builds.ts          flat pool of builds (id->Build map, order, creation/deletion)
    layers.ts          named catalogue overlays (enabled/disabled, creation/deletion)
    selection.ts       which build or layer is selected (sessionStorage per tab)
    history.ts         per-item undo stack (persisted to IndexedDB)
    trash.ts           soft-delete for builds and layers (7-day expiry)
    engine.ts          resolved-build pipeline: fold overlays, run engine
    buildEditor.ts     every mutation that writes the active build's content
    meta.ts            shared order refs (buildOrder, layerOrder)
    notice.ts          single toast message
    compare.ts         compare-build picker
    details.ts         tab selection (stats vs bonuses)
  components/          Vue SFCs, <script setup lang="ts">
tests/
  unit/                Vitest unit + golden-fixture specs
  e2e/                  Playwright specs, run against a live `npm run dev` server
    support/            shared page helpers (selectors, common flows)
playwright.config.ts    testDir tests/e2e, starts the dev server, chromium only
```

## Architecture notes

- **`db` is `markRaw`'d.** 369 items plus Maps; deep-proxying costs more than the calculation.
- **Catalogue is layered**: base (shipped) ← enabled layers (top to bottom, later wins) ←
  `build.catalog` (per-build custom gear). An overlay is `{ items: { id: item|null },
bonusSets: { id: set|null } }`; `null` is a tombstone.
- **Items reference a bonus set by id, never by name.**
- **Percentages are decimals.** `0.09` is 9%. Format at the edge, never round in state.
- **`stats` vs `appliedStats`** on a resolved bonus: the former is per-stack (the _sum_ of
  every active grant's stats), the latter is what reaches the pipeline.
- **Empty slot is `undefined` / `''` / `'-'`** — all three handled by `db.get`.
- **Duration is a free number of seconds**, not a bucket. Presets are convenience only.
- **Routing is query-string, not path** (`?build=…&layer=…&tab=…`) — a static host serves
  `index.html` by path only, so `/builds/x` would 404 on refresh; `?x=y` always resolves.
  `App.vue` owns `build`/`layer`/`tab` via a plain `watch` + `router.apply`.
  Nothing needs a "did this change come from popstate" guard: `router.apply`'s own
  no-op-if-unchanged check makes re-applying state that came from a popstate event harmless.
- **Builds and layers are the only top-level items**; bundles are an import/export convenience
  with no representation in the app or engine.

## Storage engine

- **Items** (builds, layers), **undo history**, and **trash** live in IndexedDB. IndexedDB
  has no per-origin quota limit like localStorage, so several hundred builds with full undo
  stacks are safe. Each record is written individually — no bulk save — so different items
  can be dirtied concurrently without collisions.
- **Theme preference** and **UI state** (expanded sections) live in localStorage, because
  IndexedDB is async — reading it on page load would cause a flash of the wrong theme before
  the preference resolves. localStorage is synchronous, so the theme is correct on first paint.
- **Loading is not empty**: the app starts with a loading skeleton. On first visit (no data
  anywhere), a default build is created automatically so the UI is never blank.
- **No per-item save button**: auto-save is the model. Every edit triggers a debounced write
  (250 ms). Undo and the trash (7-day soft-delete) are the safety nets.
- **Multi-tab**: the same item in two tabs is unsupported (the second tab would overwrite
  the first's writes). Different items across tabs are safe because each record is written
  independently.
- **Id allocation** (`catalog.nextId`) spans the base catalogue, **all** layers (including
  disabled ones), and the selected build's per-build catalog. This prevents id collisions
  when a disabled layer is re-enabled — a new entry's slug could collide with one that
  already exists but is currently invisible.
- **The app is desktop-only by design.** Minimum width 1100 px, no mobile layout.

## Builds, layers and bundles

### File kinds

Three file kinds, distinguished by the `kind` field in the JSON envelope:

- **`build`**: a single build. When downloaded, it carries an embedded `catalog` overlay
  containing every catalogue entry the build depends on that the shipped base does not
  already provide — so it resolves identically on any other instance of the app.
  `compare` is stripped on download (it references a sibling build by id) and refilled
  with the default on import via `normalise`.
- **`layer`**: one named catalogue overlay. Imported layers land at the end of the layer
  list (highest priority) and keep their `enabled` flag from the file.
- **`bundle`**: one or more builds + one or more layers. Builds inside a bundle do **not**
  carry an embedded catalog (decision 22) — the required layers travel as real layers
  instead. On import, every build and layer gets a fresh id; name collisions are suffixed
  `(2)`. The import appends to both lists.

### Layer priority

Base (shipped) ← enabled layers, in list order (top to bottom, later wins) ← `build.catalog`.
A build's own catalog always wins over any layer, which is the right default for "this build
came with its own definitions".

### Embedded-closure rule

Only a single-build download embeds catalogue entries. A bundle's builds do not, because the
layers they depend on are included as real layers. This keeps single-build files self-contained
and bundle files free of duplication.

## Build context

Context fields (class, role, combatType, duration, toggles, forte, etc.) are stored in
`build.context` as a plain object. The shape is entirely defined by the `build_parameter`
slots' `default` values — no separate defaults object to keep in sync. Every path is set
and read via `build-path.ts`'s `getPath`/`setPath`, which operate on `build.context`
(not `build` itself), so a path cannot address a sibling like `choices` or `id`.

## Undo model

Every content edit snapshots the item's state **before** the mutation. Consecutive edits
with the same key within 700 ms collapse into one undo step. Undo/redo always operate on the
selected item's stack. Delete is not undoable — the trash covers it. Create/move/import are
not undoable either; they are one-way operations.

## Compare

A build can reference another build by id for side-by-side stat comparison. The `compare`
field (`{ id, highlight, onlyDiff }`) is saved with the build so reopening it remembers
what it was being compared against. The compare build is resolved against the **active**
build's db, not its own catalog — this is a quick "how does this other build stack up"
glance, not the editor's per-build custom-gear machinery.

## Condition system

Conditions evaluate against `EvalContext` (class, role, toggles, equipped items, set pieces,
params). Every unknown condition key fails closed — the bonus silently never applies.
`param` conditions reference a `build_parameter` slot by its context-relative path and are
the escape hatch for parameters with no dedicated leaf (e.g. `magnitude`). The linter warns
when a `param` condition duplicates a dedicated leaf that already exists.

## Bonus resolution

Each bonus set resolves independently. `stats` on a grant is the per-stack sum of every
active grant's stats; `appliedStats` is what reaches the pipeline (after stacking rules).
Grants with `tiers` are evaluated at the matching piece count; grants with `variants` pick
the first matching variant. Stacking defaults to `perSource` (one stack per source);
`maxStacks` caps the count. Sets can `exclude` other sets — exclusion is mutual and
checked transitively. The engine pipeline: sums → weapon mods → combined rating → rating
pct → ability scores → totals → caps → capped → overcap.
