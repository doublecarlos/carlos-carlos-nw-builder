// Compiling and evaluating formulas.
//
// A formula is a string parsed once per distinct text into an AST, then compiled into closures
// that read an `EvalContext`. No `eval`. Formulas read the build only (like conditions.ts), so
// they are evaluated while a bonus resolves, before any stat is computed.

import { closest } from "../../lib/edit-distance";
import type {
  Bonus,
  EvalContext,
  FormulaResult,
  FormulaScope,
} from "../../types";
import {
  emptyReads,
  FormulaError,
  span,
  suggesting,
  type Evaluator,
  type FormulaIssue,
  type FormulaNode,
  type FormulaReads,
} from "./ast";
import {
  FORMULA_FUNCTIONS,
  FUNCTIONS,
  VARIABLES,
  type Arg,
  type Signature,
} from "./functions";
import { ParseError, parseTokens, tokenize } from "./parser";

export interface ParsedFormula {
  text: string;
  ast: FormulaNode | null;
  /** Syntax and function-call problems. Unknown names are in `reads.unknown`. */
  issues: FormulaIssue[];
  reads: FormulaReads;
  /** Throws `FormulaError` when the formula cannot produce a value. */
  evaluate: Evaluator;
}

// Compilation

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
export function compile(
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
