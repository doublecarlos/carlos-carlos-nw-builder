# Neverwinter build planner

A client-only web app that replaces a Google Sheets character planner. The **engine is
finished and verified**; current work is UI.

Deeper detail lives in `llm/plans/0002-ui-handoff.md` (architecture, decisions, verification
results). `llm/docs/pending.md` is the user's running wishlist — read it before proposing work.

## Hard constraints

1. **npm + Vite.** `npm run dev`/`build`/`preview`. Real ES modules throughout.
2. **Vue 3 SFCs**, Composition API, `<script setup lang="ts">` everywhere — including the root
   (`App.vue`) and the five largest components. No Options API, no template-literal components.
   Vue comes from `node_modules` (no vendored/global build).
3. **TypeScript, incrementally typed.** `tsconfig.json` is `strict: false`/`allowJs: true` on
   purpose — a full-strict pass is a separate, not-yet-made decision. `npm run typecheck`
   (`vue-tsc --noEmit`) must stay clean regardless.
4. **Modern JS/TS is expected** — `const`/`let`, arrows, classes, `?.`, `??`.
5. Python: **stdlib only**. Permanent scripts in `tools/`, throwaway in `workspace/`.

This reverses what used to be the project's hard constraints (no npm/no build/no ES modules/
classic `window.NW.*` global-build Vue) — a deliberate, user-requested full migration, not
drift. `llm/plans/` has the historical no-build plans (`0001`, `0002`) and the migration plan
that reversed them; they document real decisions made at the time and are not rewritten to
match current reality.

**Data is JSON, loaded statically.** `data/*.json` are plain data (no comments, no
`window.NW_*` wrapper). `src/data.ts` statically `import`s all four files and derives
`byKey`/`statKeys`/etc. (see its header comment for the FIX-note provenance that used to live
inline in the data), exporting `NW_SCHEMA`/`NW_SLOTS`/`NW_ITEMS`/`NW_BONUSES` as real consts.
No fetch, no loader files, no `dataReady` promise to await — a static import resolves at
module-evaluation time, before anything that imports `./data` can run. Editing a regenerated
`data/*.json` hot-reloads under `vite dev`; a production build needs a rebuild.

## Do not touch to make the UI easier

`src/{conditions,db,bonus,engine}.ts`, `data/*.json`, `tools/*.py` are pinned by three
independent test suites. If you think the engine is wrong, **prove it with a failing test
first**.

`data/schema.json` is hand-written and authoritative. `data/{slots,db-items,db-bonuses}.json`
are GENERATED — regenerate via `tools/`, never hand-edit.

## Run and verify

```sh
npm run dev              # http://localhost:5173, Vite dev server + HMR
npm run build             # production build to dist/
npm run preview           # serve the production build locally
npm run test              # Vitest: unit tests + golden-fixture comparison
npm run test:differ       # differential-oracle scan (tsx, not a Vitest test — see below)
npm run typecheck         # vue-tsc --noEmit
```

`npm run test` must stay green. `npm run test:differ` reports divergences between the engine
and `tools/legacy_engine.py`'s oracle across ~500 generated cases — it is a diagnostic scan,
not a pass/fail gate: the repo has a known, pre-existing baseline of **206 unexplained
regressions on `main`**, unrelated to any UI or migration work (see
`llm/memory` if available, or ask — this has been verified against a clean-tree baseline
before). The bar is "still ~206, not more," not zero. A new divergence beyond that baseline
means you changed the engine — prove it's intentional with a failing/updated test first.

## Layout

```
index.html            single entry: <script type="module" src="/src/main.ts">
vite.config.ts         @vitejs/plugin-vue, build.outDir: dist
tsconfig.json           strict: false, allowJs: true, resolveJsonModule: true
data/                  *.json data (schema.json authoritative; slots/db-items/db-bonuses
                       generated) — no loader files, imported statically by src/data.ts
src/
  data.ts              static imports of data/*.json + schema derivation (byKey/statKeys/etc.)
  conditions.ts        the `when` evaluator      ─┐
  db.ts                indexing and lookups       │ engine — verified, hands off
  bonus.ts             bonus resolution           │
  engine.ts            pipeline + derived        ─┘
  catalog.ts           layered catalogue: base + overlays (see below)
  router.ts            query-string <-> URL sync (view/collection/build/tab; editor owns `item`)
  storage.ts           builds, collections, import/export, share links, catalogue overlay
  fs-store.ts          File System Access API + IndexedDB handle persistence (collection save-to-file)
  format.ts            number/percent formatting at the edge
  main.ts              createApp(App).mount('#app')
  App.vue              root component, all state mutation, undo
  components/          Vue SFCs, <script setup lang="ts">
tests/                 Vitest unit + fixture specs, run-differ.mts (tsx script, not Vitest)
tools/                 Python pipeline
llm/plans/             numbered plans (0001/0002 predate this migration; not updated to match)
```

## Architecture notes that will bite you

- **Icons come from lucide, hand-copied.** `src/icons.ts`'s `icons` export is a registry of
  inline `<path>`/`<circle>` markup, one entry per glyph, used by `IconButton` and a few
  components that inline an svg directly. There is no icon package vendored — if a new icon is
  needed, ask the user for the lucide glyph name (e.g. "wand-2") and they'll paste in the
  markup; don't invent SVG paths from memory.
- **One reactive `build` + a `computed` calling `resolveBuild`.** It is pure and ~2 ms —
  recompute on every change; do not build incremental update machinery.
- **Every mutation goes through an `App.vue` method.** That is what keeps the undo stack small.
- **`db` is `markRaw`'d.** 369 items plus Maps; deep-proxying costs more than the calculation.
- **Catalogue is layered**: base (shipped) ← workspace overlay (editor) ← `build.catalog`
  (per-build custom gear — plumbed but not yet exposed). An overlay is
  `{ items: { name: item|null }, bonusSets: { id: set|null } }`; `null` is a tombstone.
- **Items reference a bonus set by id, never by name.** `item.bonuses` is an array of set ids;
  the set's `name` is display-only. Renaming a set's *id* (from either the item-form's bonus
  editor or the data editor's own "Bonus sets" section) therefore has to rewrite `bonuses` on
  every item that references the old id, or those items silently stop granting it —
  `DataEditor.vue`'s `cascadeSetRename` does this as part of the same overlay update as the
  rename, not as a separate step.
- **Percentages are decimals.** `0.09` is 9%. Format at the edge, never round in state.
  Percent fields convert with rounding — `3.6 / 100` is `0.036000000000000004`.
- **A bonus set resolves as one unit.** `data/db-bonuses.json`'s `{id, name, grants: [...]}` —
  `effects[]` was retired 2026-07-27 (`tools/migrate_grants.py`, one-shot). A grant is anonymous
  (`{when?, stats}` / `{when?, variants}` / `{when?, tiers}`, no `id`/`name`) since only the
  *set* needs to be addressable now; `src/bonus.ts`'s `evaluateBonus` sums every currently-active
  grant into one resolved entry (`result.bonuses` is one row per set, not per grant). Wanting two
  separately-visible bonuses on one item is still just two set ids in that item's `bonuses`
  array (unchanged) — not a reason to keep a set's grants apart. `excludes`/`stacking`/
  `maxStacks` live on the set now, not on a grant. A resolved entry's `chose` is only populated
  when exactly one grant is active (two active grants have no single tier/variant to report);
  `previewStats` (not `bonus.stats`) is what an *inactive* entry shows as a preview, taken from
  whichever grant has the fewest unmet conditions.
- **`stats` vs `appliedStats`** on a resolved bonus: the former is per-stack (now the *sum* of
  every active grant's stats), the latter is what reaches the pipeline. Reading `stats` and
  wondering why stacking "doesn't work" has caught two sessions.
- **Empty slot is `undefined` / `''` / `'-'`** — all three handled by `db.get`.
- **Duration is a free number of seconds**, not a bucket. Presets are convenience only.
- **Options are context, not slots.** Class/Role/Forte live in `build.context`.
- **Routing is query-string, not path** (`?build=…&view=…`) — a static host serves `index.html`
  by path only, so `/builds/x` would 404 on refresh; `?x=y` always resolves. `App.vue` owns
  `view`/`collection`/`build`/`tab` via a plain `watch` + `router.apply`; `DataEditor.vue` owns
  `item`/`set`/`section`/`status` itself, calling `router.apply` at each mutation site instead of
  a generic watcher for the selection params, because arrow-key list browsing needs `push:false`
  (replace) while a click needs `push:true` — a generic watcher can't tell those apart (`status`,
  the changed/added/edited/removed filter, has no such nuance and does use a plain `watch`, same
  as `tab`). Nothing needs a "did this change come from popstate" guard: `router.apply`'s own
  no-op-if-unchanged check makes re-applying state that came from a popstate event harmless.
- **Collections are a grouping layer, not a nesting one.** A collection (`storage.ts`) is
  `{ id, name, updated, buildIds, activeBuildId }` — it references build ids into the same flat
  `App.vue` `builds` array/`savedById` map that always existed; a build's content still lives in
  exactly one place. `App.vue`'s `savedCollections[id]` is that grouping's own last-saved
  snapshot (name + buildIds), separate from each build's own `savedById[id]` — a collection's
  unsaved-dot (`BuildNav`'s `collectionDirty`) is true if its own metadata differs *or* any
  build it contains is itself dirty. Any method that pushes/removes a build id from an
  *existing* collection's `buildIds` (`createBuild`, `duplicateBuild`, `removeBuild`,
  `importBuilds`) must call `syncSavedCollection` right after — forgetting it leaves
  `savedCollections[id]` stale and the collection shows a false-dirty dot forever; this was a
  real bug caught by clicking "+ New build" and watching the dot, not by re-reading the diff.
  Draft/saved split, and the "structural changes save themselves immediately" rule, both mirror
  the build-level pattern the collections layer sits on top of. Same `nw:collections` /
  `nw:collections-draft` localStorage split as `nw:builds`/`nw:builds-draft`; a fresh load with
  no `nw:collections` wraps whatever's in the (already-migrated) flat build pool into one
  catch-all collection, so an existing user's prior builds show up as a single collection with
  no separate migration step. `storage.coverBuilds` is the safety net for a build id no
  collection mentions (normally only reachable via that same kind of staleness) — it dumps
  orphans into the first collection rather than losing them, so don't be surprised if a build
  shows up in an unexpected collection after hand-edited or corrupted `nw:collections` JSON.
- **Collection file-save uses the File System Access API, Chromium-only.** `fs-store.ts` gates
  everything behind `supported` (`typeof window.showSaveFilePicker === 'function'`); Firefox/
  Safari simply don't get the "File on this PC…" Save As option (BuildNav disables it). The
  picked `FileSystemFileHandle` is kept in `App.vue`'s `fileLinks[collectionId]` (session-only)
  and mirrored into a one-table IndexedDB (`fs-store.ts`) so the link *could* survive a reload —
  but nothing eagerly reopens it on load, since using a handle needs a fresh user gesture anyway
  (Chromium re-checks permission per session via `verifyPermission`/`requestPermission`).

## Working with this user

- They read the code and push back on sloppy reasoning. Justify decisions.
- Surface data ambiguities as **explicit decisions**, not guesses.
- Verify claims by testing the claim, not a proxy. Aggregate counts hide compensating changes;
  assert the specific property.
- When a check fails, work out whether the code or the test is wrong before "fixing" anything —
  several apparent bugs here were bad assertions (capped stats not moving damage, `innerText`
  needing layout).
- Commit only when asked. Branch rather than committing to `master` directly.
- Update CLAUDE.md as needed when doing changes.