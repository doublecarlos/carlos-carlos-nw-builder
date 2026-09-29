// What a formula means for its bonus and catalog: telling `$` inputs from named formulas, the
// formulas a bonus uses, load-time checks and the editor's lint.

import { closest } from "../../lib/edit-distance";
import type {
  Bonus,
  BuildParameterSlot,
  ConditionWhen,
  FormulaRef,
  FormulaScope,
} from "../../types";
import { span, suggesting, type FormulaIssue, type FormulaReads } from "./ast";
import { FORMULA_VARIABLES, FUNCTIONS, lookupCalls } from "./functions";
import { parseFormula } from "./language";

// Named references

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
