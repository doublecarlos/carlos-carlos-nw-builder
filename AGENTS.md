## Technologies used

1. **npm + Vite.** `npm run dev`/`build`/`preview`. Real ES modules throughout.
2. **Vue 3 SFCs**, Composition API, `<script setup lang="ts">` everywhere.
3. **TypeScript, `strict: true`, real types, not `any`.**
4. **Modern JS/TS is expected** - `const`/`let`, arrows, classes, `?.`, `??`.
5. **Vitest + Playwright** - test stack

# Requirements

You are **required** to:

- Follow Vue JS best practices, checking vue-related skills if available
- Implement tests as needed, both UI and unit tests
- Run `npm run fix` to perform formatting and linting
- Run `npm run typecheck` to perform typechecking
- Run `npm run test` and `npm run test:ui` to run the tests
- Check if code comments follow the practices outlined below

# Do not

You **MUST NOT**:

- Workaround Git commit hooks with flags to disable them
- Write a raw `<input>`/`<textarea>` outside `src/components/ui` (enforced by lint) - use `BaseInput`/`BaseTextarea`, or a dedicated `ui/` primitive for a genuinely novel control
- Use a bare `z-<number>` utility class (enforced by lint) - use the `--z-index-*` scale in `src/base.css`
- Call a composable from inside a template expression - construct it once (in `<script setup>`, or cached by key for a per-row case) and read the result in the template

# Good practices

- Use these prefixes when creating new branches: `feature/`, `bugfix/`, `chore/`
- Use data-testid for reliable test locators whenever possible. You are free to add this attribute to components if they don't already have it as needed.
- Code comments should be concise, direct and describe the design intent of what the code is doing now instead of comparing the code with an old implementation or refering to a github issue ID.
- An editor form's draft shape, its entity conversion and its change labels live in `src/lib/*-draft.ts`, not in the SFC - the SFC owns markup and reactive wiring only. See `src/lib/item-draft.ts` for the worked example.

# Code layout

- `src/assets` - Icons, images, etc
- `src/components/` - Main UI components
- `src/components/ui` - Basic "universal" UI components, not related to the game domain. Reach for an existing primitive before hand-rolling markup for a control; the index is `src/components/ui/README.md`.
- `src/components/game` - UI components that know about the game/build/etc, in other words connected to the domain
- `src/composables` - Vue composables
- `src/data` - Data-related code
- `src/engine` - Build calculation engine, calculates the final stats, decides what bonuses are active, etc. Does not contain UI code or Vue.
- `src/lib` - General helper libraries
- `src/storage` - Deals with storage necessities
- `src/stores` - Data stores for shared state between components
- `tests/e2e` - UI tests using playwright
- `tests/unit` - Unit tests using Vitest

# Dev server port

Each worktree gets its own dev/Playwright port, derived from `ports.ts` (see there for details). To find the port for the current worktree - e.g. to open the dev server in a browser or curl it - run:

```sh
npm run port --silent
```

The `--silent` flag is required to suppress npm's own script-header output, leaving only the port number on stdout.
