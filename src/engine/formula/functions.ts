// The formula vocabulary: variables and functions, with how each compiles, what it reads and
// what the catalog may find wrong with a lookup's argument.

import { equippedCount, occurrenceCount, taggedCount } from "../lookups";
import type { Bonus, EvalContext } from "../../types";
import type { FormulaLint, FormulaVocabulary } from "./analysis";
import {
  FormulaError,
  nodes,
  span,
  type Evaluator,
  type FormulaNode,
  type FormulaReads,
  type Span,
} from "./ast";

export const VARIABLES: Record<string, (ctx: EvalContext) => number> = {
  duration: (ctx) => ctx.duration ?? 0,
  enemies: (ctx) => ctx.enemies ?? 0,
};

type ParamKind = "string" | "number";

/** A compiled argument: a string literal's value, or a number expression. */
export type Arg = string | Evaluator;

export interface Signature {
  params: ParamKind[];
  /** The last param repeats. */
  variadic?: boolean;
  compile(args: Arg[], source: string): Evaluator;
  /** Records what a call reads, from its string arguments. */
  reads?(strings: string[], reads: FormulaReads): void;
}

const num = (arg: Arg) => arg as Evaluator;
const str = (arg: Arg) => arg as string;

const unary = (fn: (x: number) => number): Signature[] => [
  {
    params: ["number"],
    compile: ([x]) => {
      const a = num(x);
      return (ctx) => fn(a(ctx));
    },
  },
];

const extremum = (fn: (...values: number[]) => number): Signature[] => [
  {
    params: ["number", "number"],
    variadic: true,
    compile: (args) => {
      const all = args.map(num);
      if (all.length === 2) {
        const [a, b] = all;
        return (ctx) => fn(a(ctx), b(ctx));
      }
      return (ctx) => fn(...all.map((a) => a(ctx)));
    },
  },
];

/** `1 + ratio + ratio² + ...` over `n` terms: a stack worth `ratio` times the one before. */
export const geometric = (n: number, ratio: number): number =>
  ratio === 1 ? n : (1 - ratio ** n) / (1 - ratio);

/** How many full `every`-long intervals fit in `x`, at most `max`: a stack gained every
 *  `every`, capped at `max` stacks. */
export const intervals = (x: number, every: number, max: number): number =>
  Math.min(Math.floor(x / every), max);

/** A function a formula can call. */
interface FormulaFunction {
  /** How it is called, for the editor's reference list. */
  usage: string;
  /** One per accepted argument count. */
  signatures: Signature[];
  /** Set on a lookup, a function reading the build by one quoted argument (or none): what the
   *  catalog finds wrong with that argument, if anything. */
  check?: LookupCheck;
}

type LookupCheck = (
  arg: string,
  owner: Pick<Bonus, "id">,
  vocabulary: FormulaVocabulary,
) => Omit<FormulaLint, keyof Span | "syntax"> | null;

/** Every function, by name. */
export const FUNCTIONS: Record<string, FormulaFunction> = {
  min: { usage: "min(a, b, ...)", signatures: extremum(Math.min) },
  max: { usage: "max(a, b, ...)", signatures: extremum(Math.max) },
  floor: { usage: "floor(x)", signatures: unary(Math.floor) },
  ceil: { usage: "ceil(x)", signatures: unary(Math.ceil) },
  clamp: {
    usage: "clamp(x, low, high)",
    signatures: [
      {
        params: ["number", "number", "number"],
        compile: (args) => {
          const [x, lo, hi] = args.map(num);
          return (ctx) => Math.min(Math.max(x(ctx), lo(ctx)), hi(ctx));
        },
      },
    ],
  },
  pow: {
    usage: "pow(base, exponent)",
    signatures: [
      {
        params: ["number", "number"],
        compile: (args) => {
          const [base, exponent] = args.map(num);
          return (ctx) => base(ctx) ** exponent(ctx);
        },
      },
    ],
  },
  geometric: {
    usage: "geometric(n, ratio)",
    signatures: [
      {
        params: ["number", "number"],
        compile: (args) => {
          const [n, ratio] = args.map(num);
          return (ctx) => geometric(n(ctx), ratio(ctx));
        },
      },
    ],
  },
  intervals: {
    usage: "intervals(x, every, max)",
    signatures: [
      {
        params: ["number", "number", "number"],
        compile: (args) => {
          const [x, every, max] = args.map(num);
          return (ctx) => intervals(x(ctx), every(ctx), max(ctx));
        },
      },
    ],
  },
  occurrences: {
    usage: 'occurrences() or occurrences("bonus-id")',
    signatures: [
      {
        params: [],
        compile: () => (ctx) => occurrenceCount(ctx),
        reads: (_, reads) => {
          reads.ownOccurrences = true;
        },
      },
      {
        params: ["string"],
        compile:
          ([id]) =>
          (ctx) =>
            occurrenceCount(ctx, str(id)),
        reads: ([id], reads) => void reads.bonuses.push(id),
      },
    ],
    check(id, owner, { bonusIds }) {
      if (id === owner.id)
        return {
          level: "warn",
          message: `occurrences("${id}") names this bonus itself; use occurrences()`,
        };
      return bonusIds.has(id)
        ? null
        : { level: "error", message: `occurrences("${id}") names no bonus` };
    },
  },
  equipped: {
    usage: 'equipped("item-id")',
    signatures: [
      {
        params: ["string"],
        compile:
          ([id]) =>
          (ctx) =>
            equippedCount(ctx, str(id)),
        reads: ([id], reads) => void reads.items.push(id),
      },
    ],
    check: (id, _, { itemIds }) =>
      itemIds.has(id)
        ? null
        : { level: "error", message: `equipped("${id}") names no item` },
  },
  tagged: {
    usage: 'tagged("tag")',
    signatures: [
      {
        params: ["string"],
        compile:
          ([tag]) =>
          (ctx) =>
            taggedCount(ctx, str(tag)),
        reads: ([tag], reads) => void reads.tags.push(tag),
      },
    ],
    check: (tag, _, { tags }) =>
      tags.has(tag)
        ? null
        : { level: "warn", message: `tagged("${tag}") matches no item` },
  },
  param: {
    usage: 'param("path")',
    signatures: [
      {
        params: ["string"],
        compile:
          ([path], source) =>
          (ctx) => {
            const value = ctx.params.get(str(path));
            if (typeof value !== "number")
              throw new FormulaError(`${source} has no number value`);
            return value;
          },
        reads: ([path], reads) => void reads.params.push(path),
      },
    ],
    check(path, _, { params }) {
      const slot = params.get(path);
      if (!slot)
        return {
          level: "error",
          message: `param("${path}") is not a build_parameter's path`,
        };
      if (slot.paramType !== "number" && slot.paramType !== "percent")
        return {
          level: "error",
          message: `param("${path}") is a ${slot.paramType}; formulas read numbers, so test it in "when"`,
        };
      return null;
    },
  },
  scaler: {
    usage: 'scaler("path")',
    signatures: [
      {
        params: ["string"],
        compile:
          ([path], source) =>
          (ctx) => {
            const scaler = ctx.scalers.get(str(path));
            if (!scaler) throw new FormulaError(`${source} is not a scaler`);
            return scaler.multiplier;
          },
        reads: ([path], reads) => void reads.scalers.push(path),
      },
    ],
    check: (path, _, { params }) =>
      params.get(path)?.scaler
        ? null
        : {
            level: "error",
            message: `scaler("${path}") is not a parameter declaring a scaler`,
          },
  },
};

export const FORMULA_FUNCTIONS = Object.keys(FUNCTIONS);
export const FORMULA_VARIABLES = Object.keys(VARIABLES);

/** How `name`, one of `FORMULA_FUNCTIONS`, is called. */
export const formulaUsage = (name: string) => FUNCTIONS[name].usage;

/** A lookup call whose arguments are well formed, with its quoted argument. */
interface LookupCall extends Span {
  name: string;
  arg: string | null;
  node: FormulaNode;
}

export function lookupCalls(ast: FormulaNode | null): LookupCall[] {
  if (!ast) return [];
  const out: LookupCall[] = [];
  for (const node of nodes(ast)) {
    if (node.kind !== "call" || !FUNCTIONS[node.name]?.check) continue;
    const [first] = node.args;
    if (node.args.length > 1 || (first && first.kind !== "string")) continue;
    const arg = first?.kind === "string" ? first.value : null;
    out.push({ name: node.name, arg, node, ...span(node) });
  }
  return out;
}
