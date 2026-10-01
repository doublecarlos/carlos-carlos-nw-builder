// Formulas as the player sees them: labels, number formatting and a formula's reads resolved
// against a build.

import { pctInput } from "../../lib/format";
import type {
  EvalContext,
  FormulaRead,
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
import { formatNumber, FUNCTIONS, lookupCalls, VARIABLES } from "./functions";
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

/** The label a formula that is only a function call derives from that function. */
function callLabel(formula: string): string | undefined {
  const { ast } = parseFormula(formula);
  return ast?.kind === "call"
    ? FUNCTIONS[ast.name]?.label?.(ast.args)
    : undefined;
}

/** The label shown for `ref`: its own, else the one its single lookup derives (a scaler's
 *  label, or a `$name`'s: the named formula's or the input's), else a function call's.
 *  Undefined when there is none, and the caller shows the formula itself. */
export function formulaLabel(
  ref: FormulaRef,
  ctx: LabelContext,
  depth = 0,
): string | undefined {
  if (ref.label) return ref.label;
  const read = singleRead(ref.formula);
  if (!read) return callLabel(ref.formula);
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

// Explaining

/** One run of a formula's text. A lookup, variable or `$name` carries what it read. */
export interface FormulaPart {
  text: string;
  /** Set on a lookup, variable or `$name`. `arg` is a lookup's quoted argument or the name
   *  after `$`, read as `named` for a named formula and `input` for an input. */
  read?: { kind: string; arg?: string };
  /** What the read resolved to, absent when it failed. */
  value?: number;
  /** A scaler's or param's label, which reads better than the lookup call. */
  label?: string;
  /** `value` in the read's own units, as the substituted text shows it. */
  valueText?: string;
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

/** The reads whose substituted value keeps its own units. */
const FORMATTED_KINDS = new Set(["scaler", "input"]);

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
    const described =
      read && value !== undefined ? describeRead(read, value, ctx) : null;
    parts.push({
      text: formula.slice(node.start, node.end),
      read,
      ...(value !== undefined && { value }),
      ...(described?.path && { label: described.label }),
      // Percents and input units read well inside arithmetic; a duration's "s" does not.
      ...(described &&
        FORMATTED_KINDS.has(described.kind) && {
          valueText: described.text,
        }),
    });
    at = node.end;
  }
  if (at < formula.length) parts.push({ text: formula.slice(at) });
  const substituted = parts
    .map((part) =>
      part.value === undefined
        ? part.text
        : (part.valueText ?? formatNumber(part.value)),
    )
    .join("");
  return { parts, substituted, result };
}

/** What tells one read apart from another: its kind and argument. */
export const readKey = (read: NonNullable<FormulaPart["read"]>) =>
  `${read.kind}:${read.arg ?? ""}`;

/** How one read is named and formatted: a scaler as a percent, an input in its own units, a
 *  lookup by the bonus, item or tag it counts. */
export function describeRead(
  read: NonNullable<FormulaPart["read"]>,
  value: number,
  ctx: EvalContext,
): FormulaRead | null {
  const described = describeReadAs(read, value, ctx);
  return described && { key: readKey(read), ...described };
}

function describeReadAs(
  read: NonNullable<FormulaPart["read"]>,
  value: number,
  ctx: EvalContext,
): Omit<FormulaRead, "key"> | null {
  const arg = read.arg ?? "";
  switch (read.kind) {
    case "scaler":
      return {
        kind: read.kind,
        label: ctx.scalers.get(arg)?.label ?? arg,
        text: pctInput(value),
        path: arg,
      };
    case "param":
      return {
        kind: read.kind,
        label: ctx.paramLabels?.get(arg) ?? arg,
        text: formatNumber(value),
        path: arg,
      };
    case "input": {
      const input = ctx.inputs?.get(arg);
      return {
        kind: read.kind,
        label: input?.label ?? arg,
        text: (input?.format ?? formatNumber)(value),
      };
    }
    case "named": {
      const ref = ctx.formulas?.named[arg];
      return {
        kind: read.kind,
        label: (ref && formulaLabel(ref, ctx)) ?? arg,
        text: formatNumber(value),
      };
    }
    case "duration":
      return { kind: read.kind, label: "duration", text: `${value}s` };
    case "enemies":
      return { kind: read.kind, label: "enemies", text: formatNumber(value) };
    case "occurrences":
      return {
        kind: read.kind,
        label: read.arg
          ? `${ctx.bonusNames?.get(arg) ?? arg} occurrences`
          : "occurrences",
        text: formatNumber(value),
      };
    case "equipped":
      return {
        kind: read.kind,
        label: `${ctx.itemNames?.get(arg) ?? arg} equipped`,
        text: formatNumber(value),
      };
    case "tagged":
      return {
        kind: read.kind,
        label: `tagged "${arg}"`,
        text: formatNumber(value),
      };
    default:
      return null;
  }
}

/** Every value `formula` reads directly, once each, in text order. A read that failed is
 *  left out, as the formula's own error already explains it. */
export function formulaReads(formula: string, ctx: EvalContext): FormulaRead[] {
  const seen = new Set<string>();
  const out: FormulaRead[] = [];
  for (const { read, value } of explainFormula(formula, ctx).parts) {
    if (!read || value === undefined) continue;
    const key = readKey(read);
    if (seen.has(key)) continue;
    seen.add(key);
    const described = describeRead(read, value, ctx);
    if (described) out.push(described);
  }
  return out;
}
