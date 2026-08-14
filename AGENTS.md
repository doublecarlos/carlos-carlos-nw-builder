## Technologies used

1. **npm + Vite.** `npm run dev`/`build`/`preview`. Real ES modules throughout.
2. **Vue 3 SFCs**, Composition API, `<script setup lang="ts">` everywhere.
3. **TypeScript, `strict: true`, real types, not `any`.**
4. **Modern JS/TS is expected** — `const`/`let`, arrows, classes, `?.`, `??`.
5. **Vitest + Playwright** - test stack

# Requirements

You are **required** to:

- Follow Vue JS best practices, checking all vue-related skills if available
- Make good use of Vue JS builtins, as well as functionality provided by VueUse
- Implement tests as needed, both UI and unit tests
- Run `npm run fix` to perform formatting and linting
- Run `npm run typecheck` to perform typechecking
- Run `npm run test` and `npm run test:ui` to run the tests
- Check if code comments follow the practices outlined below

# Do not

You **MUST NOT**:

- Workaround Git commit hooks with flags to disable them
- Use the `npx` command. Use only already globally installed packages directly by their simple name, or `npm run` targets.

# Good practices

- Use these prefixes when creating new branches: `feature/`, `bugfix/`, `chore/`
- Use data-testid for reliable test locators whenever possible. You are free to add this attribute to components if they don't already have it as needed.
- Code comments:
  - Should be concise, direct and describe the design intent of what the code is doing now.
  - They should not reference plan files (as plans are discarded after some time)
  - Should not compare the code with an old implementation that doesn't exist anymore.

# Code layout

- `src/assets` - Icons, images, etc
- `src/components/` - Main UI components
- `src/components/ui` - Basic "universal" UI components, not related to the game domain
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

Each worktree gets its own dev/Playwright port, derived from `ports.ts` (see there for details). To find the port for the current worktree — e.g. to open the dev server in a browser or curl it — run:

```sh
npm run port --silent
```

The `--silent` flag is required to suppress npm's own script-header output, leaving only the port number on stdout.

# Other

When running git commands that may invoke an editor, remember to set GIT_EDITOR to avoid getting stuck waiting for an interactive editor.
Specially useful for rebase operations.
