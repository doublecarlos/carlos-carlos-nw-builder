// Rewrites the golden fixtures' expected values from the engine's current output.
//
// Run via `npm run fixture` (dry run) or `npm run fixture:update` (write), optionally with
// fixture paths and `--tolerance=1e-6`.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import prettier from "prettier";

import * as db from "../src/data/db";
import * as engine from "../src/engine/engine";
import type { Build, Db, ResolvedBuild } from "../src/types";
import { IGNORED_STATS, sheetOvercap } from "../tests/unit/harness";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_FIXTURES = ["tests/unit/fixture.json"];
/** Matches fixture.spec.ts so the script rewrites exactly the fields the test would reject. */
const DEFAULT_TOLERANCE = 1e-6;

type DerivedValue = number | { [key: string]: DerivedValue };

interface Fixture {
  name: string;
  note?: string;
  build: Build;
  expected: {
    stages: Record<string, Record<string, number>>;
    derived: DerivedValue;
  };
}

interface Change {
  field: string;
  from: number;
  to: number;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;

const close = (a: number, b: number, tolerance: number): boolean => {
  if (a === b) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return Math.abs(a - b) <= tolerance * Math.max(Math.abs(a), Math.abs(b), 1);
};

function percentDiff(from: number, to: number): string {
  if (from === 0) return to === 0 ? "0%" : "n/a";
  const pct = ((to - from) / Math.abs(from)) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(3)}%`;
}

/** Rewrites the fixture's stage leaves in place. */
function syncStages(
  result: ResolvedBuild,
  expected: Fixture["expected"],
  tolerance: number,
  changes: Change[],
  missing: string[],
): void {
  const engineStages = result.stages as unknown as Record<
    string,
    Record<string, number>
  >;
  for (const [stage, stats] of Object.entries(expected.stages)) {
    const engineStage = engineStages[stage];
    if (!engineStage) {
      missing.push(`stages.${stage} (stage absent from engine)`);
      continue;
    }
    for (const [stat, want] of Object.entries(stats)) {
      if (IGNORED_STATS.has(stat)) continue;
      const got =
        stage === "overcap"
          ? sheetOvercap(engineStages, stat)
          : engineStage[stat];
      if (typeof got !== "number") {
        missing.push(`stages.${stage}.${stat}`);
        continue;
      }
      if (!close(got, want, tolerance)) {
        changes.push({ field: `stages.${stage}.${stat}`, from: want, to: got });
        stats[stat] = got;
      }
    }
  }
}

/** Recursively rewrites the fixture's numeric derived leaves in place. */
function syncDerived(
  prefix: string,
  node: DerivedValue,
  got: Record<string, unknown> | undefined,
  tolerance: number,
  changes: Change[],
  missing: string[],
): void {
  if (typeof node === "number") return;
  for (const key of Object.keys(node)) {
    const want = node[key];
    const field = `${prefix}.${key}`;
    const gotValue = got?.[key];
    if (typeof want === "number") {
      if (typeof gotValue !== "number") {
        missing.push(field);
        continue;
      }
      if (!close(gotValue, want, tolerance)) {
        changes.push({ field, from: want, to: gotValue });
        node[key] = gotValue;
      }
      continue;
    }
    syncDerived(field, want, asRecord(gotValue), tolerance, changes, missing);
  }
}

async function processFile(
  filePath: string,
  built: Db,
  dryRun: boolean,
  tolerance: number,
): Promise<number> {
  const absolute = path.resolve(REPO_ROOT, filePath);
  const fixtures = JSON.parse(readFileSync(absolute, "utf8")) as Fixture[];
  const lines: string[] = [filePath];
  let changed = 0;

  for (const fixture of fixtures) {
    const result = engine.resolveBuild(built, fixture.build);
    const changes: Change[] = [];
    const missing: string[] = [];
    syncStages(result, fixture.expected, tolerance, changes, missing);
    syncDerived(
      "derived",
      fixture.expected.derived,
      asRecord(result.derived),
      tolerance,
      changes,
      missing,
    );

    changed += changes.length;
    lines.push(
      changes.length === 0
        ? `  OK   ${fixture.name}: already up to date`
        : `  FIX  ${fixture.name}: ${changes.length} field(s) updated`,
    );
    for (const change of changes) {
      lines.push(
        `         ${change.field}: ${change.from} -> ${change.to}` +
          `  (${percentDiff(change.from, change.to)})`,
      );
    }
    if (result.errors.length > 0) {
      const errors = result.errors.filter((e) => e.severity === "error");
      const warnings = result.errors.filter((e) => e.severity === "warning");
      lines.push(
        `         engine reported ${errors.length} error(s) and ${warnings.length} warning(s)`,
      );
      for (const item of result.errors) {
        const choice = item.choice ? ` (choice: ${item.choice})` : "";
        lines.push(
          `           ${item.severity}: ${item.slotId}: ${item.message}${choice}`,
        );
      }
    }
    for (const field of missing) {
      lines.push(`         missing from engine output: ${field}`);
    }
  }

  if (changed > 0 && !dryRun) {
    const formatted = await prettier.format(JSON.stringify(fixtures, null, 2), {
      filepath: absolute,
    });
    writeFileSync(absolute, formatted, "utf8");
  }

  process.stdout.write(`${lines.join("\n")}\n`);
  if (changed > 0) {
    process.stdout.write(
      dryRun
        ? `  (dry run, ${changed} field(s) left unchanged)\n`
        : `  wrote ${changed} field(s)\n`,
    );
  }
  return changed;
}

function parseArgs(argv: string[]): {
  files: string[];
  dryRun: boolean;
  tolerance: number;
} {
  const files: string[] = [];
  let dryRun = false;
  let tolerance = DEFAULT_TOLERANCE;
  for (const arg of argv) {
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg.startsWith("--tolerance=")) {
      const parsed = Number(arg.slice("--tolerance=".length));
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`Invalid --tolerance value: ${arg}`);
      }
      tolerance = parsed;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "Usage: npm run fixture [-- file...] [--tolerance=1e-6]\n" +
          "       npm run fixture:update [-- file...] [--tolerance=1e-6]\n",
      );
      process.exit(0);
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      files.push(arg);
    }
  }
  return {
    files: files.length > 0 ? files : DEFAULT_FIXTURES,
    dryRun,
    tolerance,
  };
}

async function main(): Promise<void> {
  const { files, dryRun, tolerance } = parseArgs(process.argv.slice(2));
  const built = db.fromData();
  let changed = 0;
  for (const file of files) {
    changed += await processFile(file, built, dryRun, tolerance);
  }
  if (changed === 0) process.stdout.write("All fixtures already up to date.\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
