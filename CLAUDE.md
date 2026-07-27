# Neverwinter build planner

A client-only web app that replaces a Google Sheets character planner. The **engine is
finished and verified**; current work is UI.

Deeper detail lives in `llm/plans/0002-ui-handoff.md` (architecture, decisions, verification
results). `llm/docs/pending.md` is the user's running wishlist — read it before proposing work.

## Hard constraints

1. **No npm, no build step, no bundler.** Classic `<script>` tags, `window.NW.*` namespace.
2. **No ES modules.** `fetch` is allowed, but *only* for the `data/*.json` files — see below.
   Everything else (builds, share links, overlays) stays in `localStorage`/URL, no XHR.
3. **Vue 3 global build**, vendored at `vendor/vue.global.prod.js` (3.5.40). Components are
   plain objects with template-literal templates. No SFCs.
4. **Modern JS is expected** — `const`/`let`, arrows, classes, `?.`, `??`.
5. Python: **stdlib only**. Permanent scripts in `tools/`, throwaway in `workspace/`.

`file://` support was **retired** — dev through `tools/serve.py`, production via static
hosting. The no-build/no-modules rules still stand; they are project rules, not `file://`
fallout.

**Data is JSON, loaded async.** `data/*.json` are plain data (no comments, no `window.NW_*`
wrapper). Each has a same-named `data/*.js` loader that `fetch`s it and assigns the global
(`data/schema.js` also derives `byKey`/`statKeys`/etc. — see its header comment for the
FIX-note provenance that used to live inline in the data). Every loader appends its promise to
`window.NW.dataReady` (`Promise.all([window.NW.dataReady, fetch(...)...])`, order-independent).
`app.js` (and `tests.html`/`tests/differ.html`) `await window.NW.dataReady` before doing
anything with `NW_SCHEMA`/`NW_SLOTS`/`NW_ITEMS`/`NW_BONUSES` — nothing else in `src/` reads
those globals outside a function body, so this is the only place that has to wait. Each loader
resolves its fetch URL against `document.currentScript.src`, not a bare relative path — pages
that include the loader from a different directory (`tests/differ.html` via `../data/x.js`)
would otherwise fetch the wrong path.

## Do not touch to make the UI easier

`src/{conditions,db,bonus,engine}.js`, `data/*.json`, `tools/*.py` are pinned by three
independent test suites. If you think the engine is wrong, **prove it with a failing test
first**.

`data/schema.json` is hand-written and authoritative. `data/{slots,db-items,db-bonuses}.json`
are GENERATED — regenerate via `tools/`, never hand-edit. The `data/*.js` loader files are
hand-written behavior (fetch + assign), not generated, and are fair game to edit.

## Run and verify

```sh
./venv/Scripts/python.exe tools/serve.py        # http://localhost:8000, no-cache
```

| Page | Expect |
|---|---|
| `/tests.html` | `✓ fixtures reproduced, 13 unit tests passed` |
| `/index.html` | the app |

**The UI must never make `tests.html` go red.** If it does, you changed the engine.

No Node in this environment. To check tests without a browser session:

```sh
msedge --headless=old --disable-gpu --dump-dom --virtual-time-budget=20000 \
  http://localhost:8000/tests.html    # then grep for id="banner"
```

`--headless=new` silently emits nothing with `--dump-dom`; use `old`.

## Layout

```
index.html            app shell — script order matters
data/                 *.json data (schema.json authoritative; slots/db-items/db-bonuses
                      generated) + *.js loaders (fetch the json, assign the window.NW_* global)
src/
  conditions.js       the `when` evaluator      ─┐
  db.js               indexing and lookups       │ engine — verified, hands off
  bonus.js            bonus resolution           │
  engine.js           pipeline + derived        ─┘
  catalog.js          layered catalogue: base + overlays (see below)
  router.js           query-string <-> URL sync (view/build/tab; editor owns `item` itself)
  storage.js          builds, import/export, share links, catalogue overlay
  format.js           number/percent formatting at the edge
  app.js              root component, all state mutation, undo
  components/         Vue components
tests.html, tests/    golden fixture + 13 unit tests + differ
tools/                Python pipeline
llm/plans/            numbered plans
```

## Architecture notes that will bite you

- **Icons come from lucide, hand-copied.** `window.NW.icons` in `components/icon-button.js` is a
  registry of inline `<path>`/`<circle>` markup, one entry per glyph, used by `IconButton` and a
  few components that inline an svg directly. There is no icon package vendored — if a new icon
  is needed, ask the user for the lucide glyph name (e.g. "wand-2") and they'll paste in the
  markup; don't invent SVG paths from memory.
- **One reactive `build` + a `computed` calling `resolveBuild`.** It is pure and ~2 ms —
  recompute on every change; do not build incremental update machinery.
- **Every mutation goes through an `app.js` method.** That is what keeps the undo stack small.
- **`db` is `markRaw`'d.** 369 items plus Maps; deep-proxying costs more than the calculation.
- **Catalogue is layered**: base (shipped) ← workspace overlay (editor) ← `build.catalog`
  (per-build custom gear — plumbed but not yet exposed). An overlay is
  `{ items: { name: item|null }, bonusSets: { id: set|null } }`; `null` is a tombstone.
- **Items reference a bonus set by id, never by name.** `item.bonuses` is an array of set ids;
  the set's `name` is display-only. Renaming a set's *id* (from either the item-form's bonus
  editor or the data editor's own "Bonus sets" section) therefore has to rewrite `bonuses` on
  every item that references the old id, or those items silently stop granting it —
  `data-editor.js`'s `cascadeSetRename` does this as part of the same overlay update as the
  rename, not as a separate step.
- **Percentages are decimals.** `0.09` is 9%. Format at the edge, never round in state.
  Percent fields convert with rounding — `3.6 / 100` is `0.036000000000000004`.
- **`stats` vs `appliedStats`** on a resolved bonus: the former is per-stack, the latter is what
  reaches the pipeline. Reading `stats` and wondering why stacking "doesn't work" has caught
  two sessions.
- **Empty slot is `undefined` / `''` / `'-'`** — all three handled by `db.get`.
- **Duration is a free number of seconds**, not a bucket. Presets are convenience only.
- **Options are context, not slots.** Class/Role/Forte live in `build.context`.
- **Routing is query-string, not path** (`?build=…&view=…`) — a static host serves `index.html`
  by path only, so `/builds/x` would 404 on refresh; `?x=y` always resolves. `app.js` owns
  `view`/`build`/`tab` via a plain `watch` + `router.apply`; `data-editor.js` owns
  `item`/`set`/`section`/`status` itself, calling `router.apply` at each mutation site instead of
  a generic watcher for the selection params, because arrow-key list browsing needs `push:false`
  (replace) while a click needs `push:true` — a generic watcher can't tell those apart (`status`,
  the changed/added/edited/removed filter, has no such nuance and does use a plain `watch`, same
  as `tab`). Nothing needs a "did this change come from popstate" guard: `router.apply`'s own
  no-op-if-unchanged check makes re-applying state that came from a popstate event harmless.

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