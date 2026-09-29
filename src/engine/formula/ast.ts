// The formula AST and the shapes every formula module shares: issues, reads and errors.

import type { EvalContext } from "../../types";

// AST

export interface Span {
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
export const suggesting = (
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

export type Evaluator = (ctx: EvalContext) => number;

/** A formula that cannot produce a value against this build. */
export class FormulaError extends Error {}

export const span = ({ start, end }: Span): Span => ({ start, end });

/** Reads with nothing recorded, filled in while a formula compiles. */
export const emptyReads = (): FormulaReads => ({
  params: [],
  scalers: [],
  named: [],
  bonuses: [],
  ownOccurrences: false,
  items: [],
  tags: [],
  unknown: [],
});

/** Every node of `node`'s tree, parents before children. */
export function* nodes(node: FormulaNode): Generator<FormulaNode> {
  yield node;
  if (node.kind === "negate") yield* nodes(node.operand);
  else if (node.kind === "binary") {
    yield* nodes(node.left);
    yield* nodes(node.right);
  } else if (node.kind === "call") {
    for (const arg of node.args) yield* nodes(arg);
  }
}
