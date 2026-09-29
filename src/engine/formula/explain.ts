// Formulas as the player sees them: labels, number formatting and a formula's reads resolved
// against a build.

import type {
  EvalContext,
  FormulaRef,
  FormulaResult,
  FormulaScope,
} from "../../types";
import { namedKind } from "./analysis";
import {
  emptyReads,
  FormulaError,
  nodes,
  type FormulaIssue,
  type FormulaNode,
} from "./ast";
import { lookupCalls, VARIABLES } from "./functions";
import { compile, evaluateFormula, parseFormula } from "./language";

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
