// Formula expressions on bonuses.
//
// A formula is a string parsed once per distinct text into an AST, then compiled into closures
// that read an `EvalContext`. No `eval`. Formulas read the build only (like conditions.ts), so
// they are evaluated while a bonus resolves, before any stat is computed.
//
// Grammar: numbers, `+ - * /`, unary minus, parentheses, the variables `duration` and
// `enemies`, `$name` references to the bonus's named formulas and number inputs, and calls to
// FUNCTIONS. String literals are only valid as an id or path argument, since ids contain `-`.

import { equippedCount, occurrenceCount, taggedCount } from "./lookups";
import type {
  Bonus,
  BuildParameterSlot,
  ConditionWhen,
  EvalContext,
  FormulaRef,
  FormulaResult,
  FormulaScope,
} from "../types";

// AST

interface Span {
  start: number;
  end: number;
}

export type BinaryOperator = "+" | "-" | "*" | "/";

export type FormulaNode = Span &
  (
    | { kind: "number"; value: number }
    | { kind: "string"; value: string }
    | { kind: "variable"; name: string }
    | { kind: "named"; name: string }
    | { kind: "negate"; operand: FormulaNode }
    | {
        kind: "binary";
        op: BinaryOperator;
        left: FormulaNode;
        right: FormulaNode;
      }
    | { kind: "call"; name: string; args: FormulaNode[] }
  );

/** A problem with a formula's text, spanning `start` to `end` (character offsets). */
export interface FormulaIssue extends Span {
  message: string;
  /** A likely correction: `text` in place of `start` to `end`. `message` names it too. */
  fix?: FormulaFix;
  /** `message` without the correction, for a caller offering `fix` on its own. */
  brief?: string;
}

export interface FormulaFix extends Span {
  text: string;
}

/** An issue whose `message` suggests `fix`, when there is one. */
const suggesting = (
  brief: string,
  at: Span,
  fix: FormulaFix | null,
): FormulaIssue => ({
  message: fix ? `${brief}; did you mean "${fix.text}"?` : brief,
  ...span(at),
  ...(fix && { fix, brief }),
});

/** Everything a formula looks up, for load validation and relevance. */
export interface FormulaReads {
  /** `param("path")` paths. */
  params: string[];
  /** `scaler("path")` paths. */
  scalers: string[];
  /** `$name` references, without the sigil. `splitNamed` tells inputs from named formulas. */
  named: (Span & { name: string })[];
  /** `occurrences("id")` ids. */
  bonuses: string[];
  /** Whether `occurrences()` counts the bonus being evaluated. */
  ownOccurrences: boolean;
  /** `equipped("id")` ids. */
  items: string[];
  /** `tagged("tag")` tags. */
  tags: string[];
  /** Bare identifiers that are not variables. Reported by `checkFormula`, which knows the
   *  bonus's `$` names and can suggest the missing sigil. */
  unknown: (Span & { name: string })[];
}

type Evaluator = (ctx: EvalContext) => number;

export interface ParsedFormula {
  text: string;
  ast: FormulaNode | null;
  /** Syntax and function-call problems. Unknown names are in `reads.unknown`. */
  issues: FormulaIssue[];
  reads: FormulaReads;
  /** Throws `FormulaError` when the formula cannot produce a value. */
  evaluate: Evaluator;
}

/** A formula that cannot produce a value against this build. */
export class FormulaError extends Error {}

// Vocabulary

const VARIABLES: Record<string, (ctx: EvalContext) => number> = {
  duration: (ctx) => ctx.duration ?? 0,
  enemies: (ctx) => ctx.enemies ?? 0,
};

type ParamKind = "string" | "number";

/** A compiled argument: a string literal's value, or a number expression. */
type Arg = string | Evaluator;

interface Signature {
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
const FUNCTIONS: Record<string, FormulaFunction> = {
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

// Tokenizer

type Token = Span &
  (
    | { type: "number"; value: number }
    | { type: "string"; value: string }
    | { type: "identifier"; value: string }
    | { type: "named"; value: string }
    | { type: "punct"; value: string }
    | { type: "end" }
  );

class ParseError extends Error {
  constructor(
    message: string,
    readonly span: Span,
  ) {
    super(message);
  }
}

const IDENTIFIER = /[a-zA-Z_]\w*/y;

/** Whether `name` can be declared as a named formula and referenced as `$name`. */
export const isFormulaName = (name: string) => /^[a-zA-Z_]\w*$/.test(name);
const NUMBER = /(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/y;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const match = (pattern: RegExp) => {
    pattern.lastIndex = i;
    return pattern.exec(text)?.[0] ?? null;
  };
  while (i < text.length) {
    const char = text[i];
    if (/\s/.test(char)) {
      i++;
      continue;
    }
    const start = i;
    if (/[\d.]/.test(char)) {
      const raw = match(NUMBER);
      if (!raw)
        throw new ParseError(`unexpected "${char}"`, { start, end: i + 1 });
      i += raw.length;
      tokens.push({ type: "number", value: Number(raw), start, end: i });
    } else if (/[a-zA-Z_]/.test(char)) {
      const raw = match(IDENTIFIER)!;
      i += raw.length;
      tokens.push({ type: "identifier", value: raw, start, end: i });
    } else if (char === "$") {
      i++;
      const raw = match(IDENTIFIER);
      if (!raw)
        throw new ParseError(
          '"$" must be followed by a formula or input name',
          {
            start,
            end: i,
          },
        );
      i += raw.length;
      tokens.push({ type: "named", value: raw, start, end: i });
    } else if (char === '"' || char === "'") {
      const close = text.indexOf(char, i + 1);
      if (close === -1)
        throw new ParseError("unterminated string", {
          start,
          end: text.length,
        });
      i = close + 1;
      tokens.push({
        type: "string",
        value: text.slice(start + 1, close),
        start,
        end: i,
      });
    } else if ("+-*/(),".includes(char)) {
      i++;
      tokens.push({ type: "punct", value: char, start, end: i });
    } else {
      throw new ParseError(`unexpected "${char}"`, { start, end: i + 1 });
    }
  }
  tokens.push({ type: "end", start: text.length, end: text.length });
  return tokens;
}

// Pratt parser

const BINDING: Record<string, number> = { "+": 10, "-": 10, "*": 20, "/": 20 };
const PREFIX_BINDING = 30;

const describeToken = (token: Token) =>
  token.type === "end"
    ? "end of formula"
    : `"${"value" in token ? token.value : ""}"`;

function parseTokens(tokens: Token[]): FormulaNode {
  let position = 0;
  const peek = () => tokens[position];
  const next = () => tokens[position++];
  const isPunct = (token: Token, value: string) =>
    token.type === "punct" && token.value === value;
  const expect = (value: string) => {
    const token = next();
    if (!isPunct(token, value))
      throw new ParseError(
        `expected "${value}", found ${describeToken(token)}`,
        token,
      );
    return token;
  };

  const prefix = (): FormulaNode => {
    const token = next();
    switch (token.type) {
      case "number":
        return { kind: "number", value: token.value, ...span(token) };
      case "string":
        return { kind: "string", value: token.value, ...span(token) };
      case "named":
        return { kind: "named", name: token.value, ...span(token) };
      case "identifier": {
        if (!isPunct(peek(), "("))
          return { kind: "variable", name: token.value, ...span(token) };
        next();
        const args: FormulaNode[] = [];
        if (!isPunct(peek(), ")")) {
          args.push(expression(0));
          while (isPunct(peek(), ",")) {
            next();
            args.push(expression(0));
          }
        }
        const close = expect(")");
        return {
          kind: "call",
          name: token.value,
          args,
          start: token.start,
          end: close.end,
        };
      }
      case "punct":
        if (token.value === "-") {
          const operand = expression(PREFIX_BINDING);
          return {
            kind: "negate",
            operand,
            start: token.start,
            end: operand.end,
          };
        }
        if (token.value === "(") {
          const inner = expression(0);
          const close = expect(")");
          return { ...inner, start: token.start, end: close.end };
        }
        break;
    }
    throw new ParseError(
      token.type === "end"
        ? "formula ends early"
        : `unexpected ${describeToken(token)}`,
      token,
    );
  };

  const expression = (minBinding: number): FormulaNode => {
    let left = prefix();
    for (;;) {
      const token = peek();
      if (token.type !== "punct") break;
      const binding = BINDING[token.value];
      if (binding === undefined || binding <= minBinding) break;
      next();
      const right = expression(binding);
      left = {
        kind: "binary",
        op: token.value as BinaryOperator,
        left,
        right,
        start: left.start,
        end: right.end,
      };
    }
    return left;
  };

  const tree = expression(0);
  const rest = peek();
  if (rest.type !== "end")
    throw new ParseError(`unexpected ${describeToken(rest)}`, rest);
  return tree;
}

const span = ({ start, end }: Span): Span => ({ start, end });

// Analysis and compilation

const emptyReads = (): FormulaReads => ({
  params: [],
  scalers: [],
  named: [],
  bonuses: [],
  ownOccurrences: false,
  items: [],
  tags: [],
  unknown: [],
});

const plural = (count: number, noun: string) =>
  `${count} ${count === 1 ? noun : `${noun}s`}`;

function arityText(signatures: Signature[]): string {
  const counts = signatures.map((s) => s.params.length);
  if (signatures.some((s) => s.variadic))
    return `at least ${plural(Math.min(...counts), "argument")}`;
  return counts.length === 1
    ? plural(counts[0], "argument")
    : `${counts.slice(0, -1).join(", ")} or ${counts.at(-1)} arguments`;
}

const signatureFor = (signatures: Signature[], count: number) =>
  signatures.find((s) =>
    s.variadic ? count >= s.params.length : count === s.params.length,
  );

/** Validates `node` while compiling it. Problems go to `issues` and compile to a closure that
 *  throws, so a partly broken formula still reports every problem at once. */
function compile(
  node: FormulaNode,
  text: string,
  issues: FormulaIssue[],
  reads: FormulaReads,
): Evaluator {
  const source = text.slice(node.start, node.end);
  const fail = (message: string): Evaluator => {
    issues.push({ message, ...span(node) });
    return () => {
      throw new FormulaError(message);
    };
  };

  switch (node.kind) {
    case "number": {
      const { value } = node;
      return () => value;
    }
    case "string":
      return fail(
        `${source} is text; quoted ids and paths only go inside a function call`,
      );
    case "variable": {
      const read = VARIABLES[node.name];
      if (read) return read;
      reads.unknown.push({ name: node.name, ...span(node) });
      const message = `unknown name "${node.name}"`;
      return () => {
        throw new FormulaError(message);
      };
    }
    case "named": {
      reads.named.push({ name: node.name, ...span(node) });
      const { name } = node;
      return (ctx) => evaluateNamed(name, ctx);
    }
    case "negate": {
      const operand = compile(node.operand, text, issues, reads);
      return (ctx) => -operand(ctx);
    }
    case "binary": {
      const left = compile(node.left, text, issues, reads);
      const right = compile(node.right, text, issues, reads);
      if (node.op === "+") return (ctx) => left(ctx) + right(ctx);
      if (node.op === "-") return (ctx) => left(ctx) - right(ctx);
      if (node.op === "*") return (ctx) => left(ctx) * right(ctx);
      return (ctx) => {
        const divisor = right(ctx);
        if (divisor === 0)
          throw new FormulaError(`division by zero in ${source}`);
        return left(ctx) / divisor;
      };
    }
    case "call": {
      const signatures = Object.hasOwn(FUNCTIONS, node.name)
        ? FUNCTIONS[node.name].signatures
        : undefined;
      if (!signatures) {
        const suggestion = closest(node.name, FORMULA_FUNCTIONS);
        const fix = suggestion
          ? {
              start: node.start,
              end: node.start + node.name.length,
              text: suggestion,
            }
          : null;
        const issue = suggesting(`unknown function "${node.name}"`, node, fix);
        issues.push(issue);
        return () => {
          throw new FormulaError(issue.message);
        };
      }
      const signature = signatureFor(signatures, node.args.length);
      if (!signature)
        return fail(`${node.name}() takes ${arityText(signatures)}`);
      const args: Arg[] = [];
      const strings: string[] = [];
      let valid = true;
      node.args.forEach((arg, index) => {
        const kind =
          signature.params[Math.min(index, signature.params.length - 1)];
        if (kind === "string") {
          if (arg.kind === "string") {
            args.push(arg.value);
            strings.push(arg.value);
          } else {
            valid = false;
            issues.push({
              message: `${node.name}() takes a quoted id or path, like ${node.name}("...")`,
              ...span(arg),
            });
          }
        } else args.push(compile(arg, text, issues, reads));
      });
      if (!valid)
        return () => {
          throw new FormulaError(`invalid ${source}`);
        };
      signature.reads?.(strings, reads);
      return signature.compile(args, source);
    }
  }
}

/** Parse results by text. Bounded, since an editor may parse every keystroke. */
const cache = new Map<string, ParsedFormula>();
const CACHE_LIMIT = 2000;

/** Parses and compiles `text`, once per distinct text. */
export function parseFormula(text: string): ParsedFormula {
  // A layer loads even when validation fails, so its formula may not be text.
  if (typeof text !== "string") return parseUncached(text);
  const cached = cache.get(text);
  if (cached) return cached;
  const parsed = parseUncached(text);
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(text, parsed);
  return parsed;
}

function parseUncached(text: string): ParsedFormula {
  const issues: FormulaIssue[] = [];
  const reads = emptyReads();
  let ast: FormulaNode | null = null;
  let evaluate: Evaluator;
  try {
    if (typeof text !== "string")
      throw new ParseError("a formula of this bonus is not a string", {
        start: 0,
        end: 0,
      });
    if (!text.trim())
      throw new ParseError("formula is empty", { start: 0, end: 0 });
    ast = parseTokens(tokenize(text));
    evaluate = compile(ast, text, issues, reads);
  } catch (error) {
    if (!(error instanceof ParseError)) throw error;
    issues.push({ message: error.message, ...error.span });
    evaluate = () => {
      throw new FormulaError(error.message);
    };
  }
  if (issues.length) {
    const message = issues[0].message;
    evaluate = () => {
      throw new FormulaError(message);
    };
  }
  return { text, ast, issues, reads, evaluate };
}

// Evaluation

/** Evaluates `$name`: a named formula of the bonus in `ctx.formulas`, at most once per scope,
 *  else a number input of the bonus. */
function evaluateNamed(name: string, ctx: EvalContext): number {
  const scope = ctx.formulas;
  const ref =
    scope && Object.hasOwn(scope.named, name) ? scope.named[name] : null;
  if (!scope || !ref) {
    const input = ctx.inputs?.get(name);
    if (!input)
      throw new FormulaError(
        `$${name} is not a formula or input of this bonus`,
      );
    if (typeof input.value !== "number")
      throw new FormulaError(`$${name} is a boolean input, not a number`);
    return input.value;
  }
  let result = scope.results.get(name);
  if (result === null) throw new FormulaError(`$${name} refers to itself`);
  if (result === undefined) {
    scope.results.set(name, null);
    result = evaluateFormula(ref.formula, ctx);
    scope.results.set(name, result);
  }
  if (!result.ok) throw new FormulaError(result.error);
  return result.value;
}

/** A formula's value against `ctx`. The caller decides whether a failure is reported. */
export function evaluateFormula(
  formula: string,
  ctx: EvalContext,
): FormulaResult {
  try {
    const value = parseFormula(formula).evaluate(ctx);
    if (!Number.isFinite(value))
      return { ok: false, error: `${formula} is not a finite number` };
    return { ok: true, value };
  } catch (error) {
    if (!(error instanceof FormulaError)) throw error;
    return { ok: false, error: error.message };
  }
}

/** A fresh scope for one evaluation of `bonus`. */
export const formulaScope = (
  bonus: Pick<Bonus, "id" | "formulas">,
): FormulaScope => ({
  named: bonus.formulas ?? {},
  results: new Map(),
  errors: new Set(),
});

// Labels

/** `ref`'s formula as shown to the player, or the malformed value itself. */
export const formulaText = (ref: FormulaRef): string =>
  typeof ref?.formula === "string" ? ref.formula : JSON.stringify(ref);

/** The formula reading one scaler's multiplier. */
export const scalerFormula = (path: string) => `scaler("${path}")`;

/** What a formula consisting of one lookup reads, which is what its label comes from. A
 *  `$name` is a named formula or an input, which `namedKind` tells apart. */
export function singleRead(
  formula: string,
): { kind: "scaler"; path: string } | { kind: "named"; name: string } | null {
  const { ast } = parseFormula(formula);
  if (ast?.kind === "named") return { kind: "named", name: ast.name };
  if (
    ast?.kind === "call" &&
    ast.name === "scaler" &&
    ast.args.length === 1 &&
    ast.args[0].kind === "string"
  )
    return { kind: "scaler", path: ast.args[0].value };
  return null;
}

/** The bonus declarations a `$name` resolves against. */
export interface NamedScope {
  inputs?: { has(name: string): boolean };
  formulas?: Pick<FormulaScope, "named">;
}

/** What `$name` reads in `scope`: a named formula, else an input. A name declared as both
 *  reads the formula and fails validation. */
export function namedKind(
  name: string,
  scope: NamedScope,
): "formula" | "input" | null {
  const named = scope.formulas?.named;
  if (named && Object.hasOwn(named, name)) return "formula";
  return scope.inputs?.has(name) ? "input" : null;
}

/** `owner`'s declarations as `namedKind` reads them. */
export const ownerScope = (
  owner: Pick<Bonus, "inputs" | "formulas">,
): NamedScope => ({
  inputs: new Set(Object.keys(owner.inputs ?? {})),
  formulas: { named: owner.formulas ?? {} },
});

/** `reads.named` split against the bonus: inputs read and named formulas referenced. Names
 *  the bonus does not declare are in neither. */
export function splitNamed(
  reads: FormulaReads,
  scope: NamedScope,
): { inputs: string[]; formulas: string[] } {
  const inputs: string[] = [];
  const formulas: string[] = [];
  for (const { name } of reads.named) {
    const kind = namedKind(name, scope);
    if (kind === "input") inputs.push(name);
    else if (kind === "formula") formulas.push(name);
  }
  return { inputs, formulas };
}

/** Names `owner` declares both as a named formula and as an input. */
export const inputFormulaClashes = (
  owner: Pick<Bonus, "inputs" | "formulas">,
): string[] =>
  Object.keys(owner.formulas ?? {}).filter((name) =>
    Object.hasOwn(owner.inputs ?? {}, name),
  );

/** What a derived label reads. An `EvalContext` is one; the editor builds one from its draft
 *  and catalog, so labels need no build. */
export interface LabelContext {
  inputs?: ReadonlyMap<string, { label: string }>;
  scalers: ReadonlyMap<string, { label: string }>;
  formulas?: Pick<FormulaScope, "named">;
}

/** The label shown for `ref`: its own, else the one its single lookup derives (a scaler's
 *  label, or a `$name`'s: the named formula's or the input's). Undefined when there is none,
 *  and the caller shows the formula itself. */
export function formulaLabel(
  ref: FormulaRef,
  ctx: LabelContext,
  depth = 0,
): string | undefined {
  if (ref.label) return ref.label;
  const read = singleRead(ref.formula);
  if (!read) return undefined;
  if (read.kind === "scaler") return ctx.scalers.get(read.path)?.label;
  const kind = namedKind(read.name, ctx);
  if (kind === "input") return ctx.inputs?.get(read.name)?.label;
  if (kind !== "formula" || depth > 8) return read.name;
  const target = ctx.formulas!.named[read.name];
  return formulaLabel(target, ctx, depth + 1) ?? read.name;
}

/** Formats a value in the units of the input a formula reads alone, else as a plain number. */
export function formulaFormat(
  ref: FormulaRef,
  ctx: EvalContext,
): (value: number) => string {
  const read = singleRead(ref.formula);
  const input =
    read?.kind === "named" && namedKind(read.name, ctx) === "input"
      ? ctx.inputs?.get(read.name)
      : null;
  return input?.format ?? formatNumber;
}

/** Up to four decimals, trailing zeros dropped. */
export const formatNumber = (value: number) =>
  String(Math.round(value * 10000) / 10000);

// Load-time checks

/** Every formula `bonus` declares or uses, with where it sits, for validation. */
export interface FormulaSite {
  ref: FormulaRef;
  /** e.g. `grant 2 scale`, `formula "$stacks"`. */
  where: string;
  kind: "named" | "scale" | "tierBy" | "condition";
}

function conditionFormulas(
  when: ConditionWhen | undefined,
  where: string,
  out: FormulaSite[],
) {
  if (!when || typeof when !== "object") return;
  if (when.formula) out.push({ ref: when.formula, where, kind: "condition" });
  for (const sub of [...(when.all ?? []), ...(when.any ?? [])])
    conditionFormulas(sub, where, out);
  conditionFormulas(when.not, where, out);
}

export function formulaSites(bonus: Bonus): FormulaSite[] {
  const out: FormulaSite[] = [];
  for (const [name, ref] of Object.entries(bonus.formulas ?? {}))
    out.push({ ref, where: `formula "$${name}"`, kind: "named" });
  bonus.grants?.forEach((grant, index) => {
    const label = `grant ${index + 1}`;
    if (grant.scale)
      out.push({ ref: grant.scale, where: `${label} scale`, kind: "scale" });
    if (grant.tierBy)
      out.push({ ref: grant.tierBy, where: `${label} tierBy`, kind: "tierBy" });
    conditionFormulas(grant.when, label, out);
    for (const variant of grant.variants ?? [])
      conditionFormulas(variant.when, `${label} variant`, out);
  });
  return out;
}

/** Problems with `formula` given the `$` names its bonus declares (named formulas and
 *  inputs): parse problems, unknown names (suggesting a missing `$`) and unknown `$names`. */
export function checkFormula(
  formula: string,
  named: readonly string[],
): FormulaIssue[] {
  const parsed = parseFormula(formula);
  const issues = [...parsed.issues];
  for (const unknown of parsed.reads.unknown) {
    const hint = named.includes(unknown.name)
      ? `$${unknown.name}`
      : closest(unknown.name, [
          ...FORMULA_VARIABLES,
          ...named.map((n) => `$${n}`),
        ]);
    issues.push(
      suggesting(
        `unknown name "${unknown.name}"`,
        unknown,
        hint ? { ...span(unknown), text: hint } : null,
      ),
    );
  }
  for (const reference of parsed.reads.named) {
    if (named.includes(reference.name)) continue;
    const hint = closest(reference.name, named);
    issues.push(
      suggesting(
        `"$${reference.name}" is not a formula or input of this bonus`,
        reference,
        hint ? { ...span(reference), text: `$${hint}` } : null,
      ),
    );
  }
  return issues.sort((a, b) => a.start - b.start);
}

/** Every reference cycle among `named`, each as the names along it, first repeated last
 *  (`["a", "b", "a"]`). */
export function namedCycles(named: Record<string, FormulaRef>): string[][] {
  const edges = new Map<string, string[]>();
  for (const [name, ref] of Object.entries(named)) {
    edges.set(
      name,
      typeof ref?.formula === "string"
        ? parseFormula(ref.formula).reads.named.map((r) => r.name)
        : [],
    );
  }
  const cycles: string[][] = [];
  const done = new Set<string>();
  const visit = (name: string, path: string[]) => {
    const at = path.indexOf(name);
    if (at !== -1) {
      cycles.push([...path.slice(at), name]);
      return;
    }
    if (done.has(name) || !edges.has(name)) return;
    for (const next of edges.get(name)!) visit(next, [...path, name]);
    done.add(name);
  };
  for (const name of edges.keys()) visit(name, []);
  return cycles;
}

/** Everything `formula` reads, following `$name` references through `named`. A `$name` that
 *  is not in `named` reads an input, which `splitNamed` finds in the returned reads. */
export function transitiveReads(
  formula: string,
  named: Record<string, FormulaRef>,
): FormulaReads[] {
  const out: FormulaReads[] = [];
  const seen = new Set<string>();
  const walk = (text: string) => {
    const { reads } = parseFormula(text);
    out.push(reads);
    for (const { name } of reads.named) {
      if (seen.has(name) || !Object.hasOwn(named, name)) continue;
      seen.add(name);
      const ref = named[name];
      if (typeof ref?.formula === "string") walk(ref.formula);
    }
  };
  walk(formula);
  return out;
}

/** Why a grant `scale` of `bonus` squares its source count: it counts the bonus's own
 *  occurrences, which `perSource` stacking already multiplies by. Null when it does not. */
export function perSourceScaleWarning(
  formula: string,
  bonus: Pick<Bonus, "id" | "formulas" | "stacking">,
): string | null {
  if (bonus.stacking !== "perSource" || typeof formula !== "string")
    return null;
  const counts = transitiveReads(formula, bonus.formulas ?? {}).some(
    (reads) => reads.ownOccurrences || reads.bonuses.includes(bonus.id),
  );
  return counts
    ? "scale counts this bonus's own occurrences, which perSource stacking already multiplies by"
    : null;
}

/** Every node of `node`'s tree, parents before children. */
function* nodes(node: FormulaNode): Generator<FormulaNode> {
  yield node;
  if (node.kind === "negate") yield* nodes(node.operand);
  else if (node.kind === "binary") {
    yield* nodes(node.left);
    yield* nodes(node.right);
  } else if (node.kind === "call") {
    for (const arg of node.args) yield* nodes(arg);
  }
}

/** A lookup call whose arguments are well formed, with its quoted argument. */
interface LookupCall extends Span {
  name: string;
  arg: string | null;
  node: FormulaNode;
}

function lookupCalls(ast: FormulaNode | null): LookupCall[] {
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

// Linting

/** What a formula may look up, resolved against a catalog. */
export interface FormulaVocabulary {
  /** Every build parameter, by path. */
  params: Map<string, BuildParameterSlot>;
  bonusIds: Set<string>;
  itemIds: Set<string>;
  tags: Set<string>;
}

/** A formula problem worth showing its author. `syntax` marks one from the text itself, as
 *  opposed to a lookup the catalog cannot satisfy. */
export interface FormulaLint extends FormulaIssue {
  level: "error" | "warn";
  syntax: boolean;
}

/** Every problem with `formula` as a formula of `owner`: its text and `$` references
 *  (`checkFormula`), then each boolean input read as a number and each lookup the catalog
 *  cannot satisfy, in text order. Shared by load validation and the editor, so both say the
 *  same thing. */
export function lintFormula(
  formula: string,
  owner: Pick<Bonus, "id" | "inputs" | "formulas">,
  vocabulary: FormulaVocabulary,
): FormulaLint[] {
  const inputs = owner.inputs ?? {};
  const out: FormulaLint[] = checkFormula(formula, [
    ...Object.keys(owner.formulas ?? {}),
    ...Object.keys(inputs),
  ]).map((issue) => ({ ...issue, level: "error", syntax: true }));
  const parsed = parseFormula(formula);
  const scope = ownerScope(owner);
  const problems: FormulaLint[] = [];
  for (const reference of parsed.reads.named) {
    if (namedKind(reference.name, scope) !== "input") continue;
    if (inputs[reference.name].type !== "boolean") continue;
    problems.push({
      level: "error",
      message: `$${reference.name} is a boolean input; formulas read numbers, so test it in "when"`,
      ...span(reference),
      syntax: false,
    });
  }
  for (const call of lookupCalls(parsed.ast)) {
    if (call.arg === null) continue;
    const problem = FUNCTIONS[call.name].check!(call.arg, owner, vocabulary);
    if (problem) problems.push({ ...problem, ...span(call), syntax: false });
  }
  return [...out, ...problems.sort((a, b) => a.start - b.start)];
}

// Explaining

/** One run of a formula's text. A lookup, variable or `$name` carries what it read. */
export interface FormulaPart {
  text: string;
  /** Set on a lookup, variable or `$name`. `arg` is a lookup's quoted argument or the name
   *  after `$`, read as `named` for a named formula and `input` for an input. */
  read?: { kind: string; arg?: string };
  /** What the read resolved to, absent when it failed. */
  value?: number;
}

/** A formula with each read resolved against a build: the text split at every read, the
 *  formula with those values in place, and the result. */
export interface FormulaExplain {
  parts: FormulaPart[];
  substituted: string;
  result: FormulaResult;
}

/** The node `node` alone, evaluated, or undefined when it fails. */
function nodeValue(
  node: FormulaNode,
  text: string,
  ctx: EvalContext,
): number | undefined {
  const issues: FormulaIssue[] = [];
  const evaluate = compile(node, text, issues, emptyReads());
  if (issues.length) return undefined;
  try {
    return evaluate(ctx);
  } catch (error) {
    if (error instanceof FormulaError) return undefined;
    throw error;
  }
}

export function explainFormula(
  formula: string,
  ctx: EvalContext,
): FormulaExplain {
  const result = evaluateFormula(formula, ctx);
  const { ast } = parseFormula(formula);
  if (!ast) return { parts: [{ text: formula }], substituted: formula, result };

  // A lookup's argument is a string, never a read, so reads never nest.
  const reads: { node: FormulaNode; read: FormulaPart["read"] }[] = [];
  for (const node of nodes(ast)) {
    if (node.kind === "named")
      reads.push({
        node,
        read: {
          kind: namedKind(node.name, ctx) === "input" ? "input" : "named",
          arg: node.name,
        },
      });
    else if (node.kind === "variable" && Object.hasOwn(VARIABLES, node.name))
      reads.push({ node, read: { kind: node.name } });
  }
  for (const call of lookupCalls(ast))
    reads.push({
      node: call.node,
      read: { kind: call.name, ...(call.arg !== null && { arg: call.arg }) },
    });
  reads.sort((a, b) => a.node.start - b.node.start);

  const parts: FormulaPart[] = [];
  let at = 0;
  for (const { node, read } of reads) {
    if (node.start > at) parts.push({ text: formula.slice(at, node.start) });
    const value = nodeValue(node, formula, ctx);
    parts.push({
      text: formula.slice(node.start, node.end),
      read,
      ...(value !== undefined && { value }),
    });
    at = node.end;
  }
  if (at < formula.length) parts.push({ text: formula.slice(at) });
  const substituted = parts
    .map((part) =>
      part.value === undefined ? part.text : formatNumber(part.value),
    )
    .join("");
  return { parts, substituted, result };
}

/** Edits between two names, a swap of neighbors counting as one. */
function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) =>
      i === 0 ? j : j === 0 ? i : 0,
    ),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** The candidate closest to `name`, if close enough to be a typo. */
function closest(name: string, candidates: readonly string[]): string | null {
  let best: string | null = null;
  let bestDistance = Math.max(1, Math.floor(name.length / 3)) + 1;
  for (const candidate of candidates) {
    const distance = editDistance(
      name.toLowerCase(),
      candidate.replace(/^\$/, "").toLowerCase(),
    );
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}
