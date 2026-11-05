// Measures interaction latency in a real Chromium against a served build of the app.
//
// Serve a production build on this worktree's port first:
//
//   npm run build && npm run preview -- --port $(npm run port --silent)
//
// then, in another shell:
//
//   npm run perf -- <url> [--heavy] [--cpu 4] [--reduced] [--rounds 5] [--scripts]
//   npm run perf -- <url> --listeners
//   npm run perf -- <url> --profile <scenario> [--top 40]
//
// The default run prints, per scenario, the median and max of each round's slowest
// interaction (Event Timing, as INP counts it), the median of each round's longest frame and
// the long animation frames over all rounds. For `switch`, read the frame column: its click
// returns before the editor repaints.
// `--heavy` imports the golden fixture build (tests/unit/fixture.json) instead of a fresh one.
// `--cpu` sets the CPU throttling rate (default 4), `--reduced` emulates reduced motion and
// `--scripts` adds the LoAF script attributions. Window and document listener counts print
// with every run; `--listeners` prints only those.
//
// `--profile` records a CPU profile of one scenario and prints self and total time per
// function. Build with `npm run build -- --minify false` so the names are readable.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium, type CDPSession, type Page } from "@playwright/test";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = path.join(REPO_ROOT, "tests/unit/fixture.json");
/** Lets animations finish and the observers flush before a round is read. */
const SETTLE_MS = 700;

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    heavy: { type: "boolean", default: false },
    cpu: { type: "string", default: "4" },
    reduced: { type: "boolean", default: false },
    rounds: { type: "string", default: "5" },
    scripts: { type: "boolean", default: false },
    listeners: { type: "boolean", default: false },
    profile: { type: "string" },
    top: { type: "string", default: "40" },
  },
});
const url = positionals[0];
if (!url) {
  console.error(
    "usage: npm run perf -- <url> [--heavy] [--cpu 4] [--reduced] [--rounds 5] [--scripts] [--listeners] [--profile <scenario>]",
  );
  process.exit(1);
}
const cpuRate = Number(opts.cpu);
const rounds = Number(opts.rounds);

interface EventRow {
  id: number;
  duration: number;
}
interface LoafScriptRow {
  fn: string;
  invoker: string;
  duration: number;
  layout: number;
}
interface LoafRow {
  duration: number;
  scripts: LoafScriptRow[];
}
interface PerfLog {
  events: EventRow[];
  loaf: LoafRow[];
  /** The longest gap between two animation frames since the last drain. */
  frame: number;
}
// The Event Timing and LoAF fields read here, which lib.dom does not type yet.
interface EventEntry extends PerformanceEntry {
  interactionId: number;
}
interface LoafEntry extends PerformanceEntry {
  scripts: {
    sourceFunctionName: string;
    invoker: string;
    duration: number;
    forcedStyleAndLayoutDuration: number;
  }[];
}

/** Collects Event Timing and LoAF entries in the page until the runner drains them. */
function installObservers() {
  const log: PerfLog = { events: [], loaf: [], frame: 0 };
  Object.assign(window, { __perf: log });
  // A method, not a named arrow: tsx wraps those in a `__name` helper the page lacks.
  const frames = {
    last: 0,
    tick(now: number) {
      if (frames.last) log.frame = Math.max(log.frame, now - frames.last);
      frames.last = now;
      requestAnimationFrame(frames.tick);
    },
  };
  requestAnimationFrame(frames.tick);
  const eventInit: PerformanceObserverInit & { durationThreshold: number } = {
    type: "event",
    durationThreshold: 16,
    buffered: true,
  };
  new PerformanceObserver((list) => {
    for (const e of list.getEntries() as EventEntry[])
      log.events.push({ id: e.interactionId, duration: e.duration });
  }).observe(eventInit);
  new PerformanceObserver((list) => {
    for (const e of list.getEntries() as LoafEntry[])
      log.loaf.push({
        duration: e.duration,
        scripts: e.scripts.map((s) => ({
          fn: s.sourceFunctionName,
          invoker: s.invoker,
          duration: s.duration,
          layout: s.forcedStyleAndLayoutDuration,
        })),
      });
  }).observe({ type: "long-animation-frame", buffered: true });
}

const drain = (page: Page): Promise<PerfLog> =>
  page.evaluate(() => {
    const log = (window as unknown as { __perf: PerfLog }).__perf;
    const out = { events: log.events, loaf: log.loaf, frame: log.frame };
    log.events = [];
    log.loaf = [];
    log.frame = 0;
    return out;
  });

const settle = (page: Page) => page.waitForTimeout(SETTLE_MS);

interface FixtureBuild {
  choices: Record<string, string>;
  assignments: Record<string, Record<string, number>>;
  [key: string]: unknown;
}

const fixtureBuild = (): FixtureBuild =>
  (JSON.parse(readFileSync(FIXTURE, "utf8")) as { build: FixtureBuild }[])[0]
    .build;

const jsonFile = (name: string, value: unknown) => ({
  name,
  mimeType: "application/json",
  buffer: Buffer.from(JSON.stringify(value)),
});

/** The golden fixture's build, shaped like a build export file. */
const heavyBuildFile = () =>
  jsonFile("heavy.json", { name: "Heavy", ...fixtureBuild() });

/** Names of the builds the `switch` scenario clicks between, in order. */
const SWITCH_BUILDS = ["Switch full", "Switch half", "Switch sparse"];

/** Golden fixture variants keeping every pick, every second pick and every third pick. */
function switchBundleFile() {
  const base = fixtureBuild();
  const variant = (index: number) => {
    const kept = Object.keys(base.choices).filter(
      (_, i) => i % (index + 1) === 0,
    );
    const disabled = kept.filter((_, i) => index > 0 && i % 4 === 1);
    const assignments = Object.fromEntries(
      Object.entries(base.assignments).map(([slot, counts]) => [
        slot,
        Object.fromEntries(
          Object.entries(counts).map(([id, n]) => [id, Math.max(0, n - index)]),
        ),
      ]),
    );
    return {
      ...base,
      id: `b_perf_switch_${index}`,
      name: SWITCH_BUILDS[index],
      choices: Object.fromEntries(kept.map((id) => [id, base.choices[id]])),
      disabledSlots: Object.fromEntries(disabled.map((id) => [id, true])),
      assignments,
    };
  };
  return jsonFile("switch.json", {
    builds: SWITCH_BUILDS.map((_, index) => variant(index)),
    layers: [],
  });
}

async function importFile(page: Page, file: ReturnType<typeof jsonFile>) {
  await page
    .getByTestId("app-header")
    .locator('input[type="file"]')
    .setInputFiles(file);
  await page.getByTestId("import-confirm").click();
  await page.getByTestId("import-confirm").waitFor({ state: "detached" });
}

const navBuild = (page: Page, name: string) =>
  page
    .locator(".nav-row--build")
    .filter({ hasText: name })
    .locator(".nav-name");

async function expandAll(page: Page) {
  const button = page.getByTestId("editor-expand-all");
  if (await button.isEnabled()) await button.click();
}

/** Opens a build with every section expanded and the pointer parked out of the way. */
async function setUp(page: Page) {
  await page.goto(url);
  const newBuild = page.getByTestId("landing-new-build");
  const gear = page.locator('[data-cursor-key="header:gear"]');
  await newBuild.or(gear).first().waitFor({ timeout: 30_000 });
  if (await newBuild.isVisible()) await newBuild.click();
  await gear.waitFor();
  if (opts.heavy) await importFile(page, heavyBuildFile());
  await page.mouse.move(0, 0);
  await expandAll(page);
  await page.waitForTimeout(1500);
}

interface Scenario {
  label: string;
  /** Runs once before the rounds, unmeasured. */
  prepare?: (page: Page) => Promise<unknown>;
  run: (page: Page, round: number) => Promise<unknown>;
}

const firstGearInput = (page: Page) =>
  page
    .locator('[data-cursor-key^="slot:gear."] [data-testid="picker-input"]')
    .first();

const SCENARIOS: Record<string, Scenario> = {
  "fold-gear": {
    label: "fold gear section",
    run: (page) => page.locator('[data-cursor-key="header:gear"]').click(),
  },
  "fold-buffs": {
    label: "fold buffs section",
    run: (page) => page.locator('[data-cursor-key="header:buffs"]').click(),
  },
  all: {
    label: "collapse/expand all",
    run: (page, round) =>
      page
        .getByTestId(round % 2 ? "editor-expand-all" : "editor-collapse-all")
        .click(),
  },
  "rail-left": {
    label: "rail toggle left",
    run: (page) => page.getByTestId("rail-toggle-left").first().click(),
  },
  "rail-right": {
    label: "rail toggle right",
    run: (page) => page.getByTestId("rail-toggle-right").first().click(),
  },
  "picker-open": {
    label: "open item picker",
    run: async (page) => {
      await firstGearInput(page).click();
      await page.waitForTimeout(400);
      await page.keyboard.press("Escape");
    },
  },
  "picker-type": {
    label: "type in item picker",
    run: async (page) => {
      await firstGearInput(page).click();
      await page.keyboard.type("ar", { delay: 80 });
      await page.waitForTimeout(300);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
    },
  },
  pick: {
    label: "pick an item",
    run: async (page) => {
      await firstGearInput(page).click();
      await page.waitForTimeout(300);
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await page.mouse.move(0, 0);
    },
  },
  filter: {
    label: "type in slot filter",
    run: async (page) => {
      const filter = page.getByTestId("slot-filter-text");
      await filter.click();
      await page.keyboard.type("ring", { delay: 80 });
      await page.waitForTimeout(300);
      await filter.fill("");
    },
  },
  switch: {
    label: "switch build",
    prepare: async (page) => {
      // The rail scenarios can leave the builds rail collapsed.
      const rail = page.getByTestId("rail-toggle-left").first();
      if ((await rail.getAttribute("aria-expanded")) === "false")
        await rail.click();
      await importFile(page, switchBundleFile());
      // Folds are per build, so expand each one once.
      for (const name of SWITCH_BUILDS) {
        await navBuild(page, name).click();
        await expandAll(page);
        await settle(page);
      }
      await page.mouse.move(0, 0);
    },
    run: async (page, round) => {
      await navBuild(page, SWITCH_BUILDS[round % SWITCH_BUILDS.length]).click();
      await page.mouse.move(0, 0);
    },
  },
};

/** Re-expands everything so a scenario never starts from another one's leftovers. */
async function reset(page: Page) {
  const expandAll = page.getByTestId("editor-expand-all");
  if (await expandAll.isEnabled()) await expandAll.click();
  await settle(page);
  await drain(page);
}

async function printListeners(page: Page, cdp: CDPSession) {
  for (const expression of ["window", "document"]) {
    const { result } = await cdp.send("Runtime.evaluate", { expression });
    if (!result.objectId) continue;
    const { listeners } = await cdp.send("DOMDebugger.getEventListeners", {
      objectId: result.objectId,
    });
    const counts = new Map<string, number>();
    for (const l of listeners)
      counts.set(l.type, (counts.get(l.type) ?? 0) + 1);
    const list = [...counts]
      .sort((a, b) => b[1] - a[1])
      .map(([type, n]) => `${type} ${n}`)
      .join(", ");
    console.log(`${expression} listeners: ${list}`);
  }
  const rows = await page.locator('[data-cursor-key^="slot:"]').count();
  const nodes = await page.evaluate(
    () => document.getElementsByTagName("*").length,
  );
  console.log(`slot rows: ${rows}, DOM elements: ${nodes}`);
}

interface ScenarioResult {
  label: string;
  median: number;
  max: number;
  frame: number;
  loafCount: number;
  loafMs: number;
}

async function measure(
  page: Page,
  scenario: Scenario,
  scriptTotals: Map<string, { duration: number; layout: number; n: number }>,
): Promise<ScenarioResult> {
  const worst: number[] = [];
  const frames: number[] = [];
  let loafCount = 0;
  let loafMs = 0;
  for (let round = 0; round < rounds; round++) {
    await scenario.run(page, round);
    await settle(page);
    const { events, loaf, frame } = await drain(page);
    frames.push(frame);
    // The round's slowest interaction, each interaction taking its slowest event.
    const byId = new Map<number, number>();
    for (const e of events)
      if (e.id) byId.set(e.id, Math.max(byId.get(e.id) ?? 0, e.duration));
    worst.push(Math.max(0, ...byId.values()));
    loafCount += loaf.length;
    for (const frame of loaf) {
      loafMs += frame.duration;
      for (const s of frame.scripts) {
        const key = `${scenario.label} | ${s.invoker} | ${s.fn}`;
        const total = scriptTotals.get(key) ?? { duration: 0, layout: 0, n: 0 };
        total.duration += s.duration;
        total.layout += s.layout;
        total.n++;
        scriptTotals.set(key, total);
      }
    }
  }
  worst.sort((a, b) => a - b);
  frames.sort((a, b) => a - b);
  return {
    label: scenario.label,
    median: worst[Math.floor(rounds / 2)],
    max: worst[worst.length - 1],
    frame: frames[Math.floor(rounds / 2)],
    loafCount,
    loafMs,
  };
}

function printTable(results: ScenarioResult[]) {
  const width = Math.max(...results.map((r) => r.label.length));
  const cell = (value: number | string, size = 8) =>
    String(value).padStart(size);
  console.log(
    `${"scenario".padEnd(width)}${cell("median")}${cell("max")}${cell("frame")}${cell("LoAF")}${cell("LoAF ms", 10)}`,
  );
  for (const r of results)
    console.log(
      `${r.label.padEnd(width)}${cell(r.median.toFixed(0))}${cell(r.max.toFixed(0))}${cell(r.frame.toFixed(0))}${cell(r.loafCount)}${cell(r.loafMs.toFixed(0), 10)}`,
    );
}

interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
  children?: number[];
}

/** Sums self and total sampled time per function, counting recursion once. */
function printProfile(
  profile: { nodes: ProfileNode[]; samples?: number[]; timeDeltas?: number[] },
  label: string,
) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map<number, number>();
  for (const n of profile.nodes)
    for (const c of n.children ?? []) parent.set(c, n.id);
  const name = (n: ProfileNode) =>
    `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber + 1}`;
  const self = new Map<string, number>();
  const total = new Map<string, number>();
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  samples.forEach((id, i) => {
    const ms = (deltas[i + 1] ?? 0) / 1000;
    const leaf = byId.get(id);
    if (!leaf) return;
    self.set(name(leaf), (self.get(name(leaf)) ?? 0) + ms);
    const seen = new Set<string>();
    for (let cur: number | undefined = id; cur; cur = parent.get(cur)) {
      const node = byId.get(cur);
      if (!node) break;
      const key = name(node);
      if (seen.has(key)) continue;
      seen.add(key);
      total.set(key, (total.get(key) ?? 0) + ms);
    }
  });
  const top = Number(opts.top);
  for (const [map, kind] of [
    [self, "self"],
    [total, "total"],
  ] as const) {
    console.log(`--- ${label} ${kind} ms`);
    for (const [key, ms] of [...map].sort((a, b) => b[1] - a[1]).slice(0, top))
      console.log(`${ms.toFixed(1).padStart(8)} ${key}`);
  }
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    reducedMotion: opts.reduced ? "reduce" : "no-preference",
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await page.addInitScript(installObservers);
  await setUp(page);
  console.log(
    `${url} ${opts.heavy ? "heavy" : "fresh"} build, cpu ${cpuRate}x, ${opts.reduced ? "reduced" : "full"} motion, ${rounds} rounds`,
  );
  await printListeners(page, cdp);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpuRate });

  if (opts.listeners) {
    // Nothing more to do: the counts above are the output.
  } else if (opts.profile) {
    const scenario = SCENARIOS[opts.profile];
    if (!scenario)
      throw new Error(
        `unknown scenario "${opts.profile}", expected one of: ${Object.keys(SCENARIOS).join(", ")}`,
      );
    await scenario.prepare?.(page);
    await reset(page);
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
    await cdp.send("Profiler.start");
    for (let round = 0; round < rounds; round++) {
      await scenario.run(page, round);
      await settle(page);
    }
    const { profile } = await cdp.send("Profiler.stop");
    printProfile(profile, scenario.label);
  } else {
    const results: ScenarioResult[] = [];
    const scriptTotals = new Map<
      string,
      { duration: number; layout: number; n: number }
    >();
    for (const scenario of Object.values(SCENARIOS)) {
      await scenario.prepare?.(page);
      await reset(page);
      results.push(await measure(page, scenario, scriptTotals));
    }
    printTable(results);
    if (opts.scripts) {
      console.log("--- top LoAF scripts");
      for (const [key, t] of [...scriptTotals]
        .sort((a, b) => b[1].duration - a[1].duration)
        .slice(0, 25))
        console.log(
          `${t.duration.toFixed(0).padStart(6)}ms layout ${t.layout.toFixed(0).padStart(5)}ms n=${t.n}  ${key}`,
        );
    }
  }
} finally {
  await browser.close();
}
