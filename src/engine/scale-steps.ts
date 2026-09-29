// A scale's step ladder: the grant's multiplier, and whether the grant applies, at each value
// of the build value its `steps` hint varies, with the rest of the build as it is. Built on
// demand for display, never during a resolve.
import * as conditions from "./conditions";
import { bonusContext } from "./bonus";
import { scalerMultiplier } from "./scaling";
import {
  axisRead,
  describeRead,
  evaluateFormula,
  readKey,
  stepAxis,
  stepValues,
  stepsProblem,
  type StepAxis,
} from "./formula";
import type { Bonus, EvalContext, Grant } from "../types";

/** A run of values giving the same multiplier and gate. */
export interface ScaleStep {
  from: number;
  to: number;
  value: number;
  /** Whether the grant applies here: its `when` holds and the multiplier is above 0. */
  granted: boolean;
}

export interface ScaleLadder {
  /** How the varied value reads, e.g. "Stacks" or "duration". */
  label: string;
  /** One of its values as the player reads it, e.g. "25s". */
  format: (value: number) => string;
  /** Its value in the build, NaN when it cannot be read. */
  current: number;
  /** The read the ladder varies, so a note listing the formula's reads can leave it out. */
  readKey: string;
  steps: ScaleStep[];
}

/** `ctx` as `bonus` reads it, with `axis` at `value`. */
function contextAt(
  bonus: Bonus,
  ctx: EvalContext,
  inputValues: Record<string, number | boolean>,
  axis: StepAxis,
  value: number,
): EvalContext {
  if (axis.kind === "input")
    return bonusContext(bonus, ctx, { ...inputValues, [axis.name]: value });
  if (axis.kind === "variable")
    return bonusContext(bonus, { ...ctx, [axis.name]: value }, inputValues);
  const params = new Map(ctx.params).set(axis.path, value);
  // A scaler's multiplier is resolved from its param once per build, so it moves with it here.
  const scaler = ctx.scalers.get(axis.path);
  const scalers = scaler
    ? new Map(ctx.scalers).set(axis.path, {
        ...scaler,
        value,
        multiplier: scalerMultiplier(scaler.mode, value),
      })
    : ctx.scalers;
  return bonusContext(bonus, { ...ctx, params, scalers }, inputValues);
}

/** The ladder `grant.scale.steps` asks for, or null without a usable hint. A tiered, variant
 *  or problem grant has no single payload to lay out, so it gets none. */
export function scaleLadder(
  bonus: Bonus,
  grant: Grant,
  ctx: EvalContext,
  inputValues: Record<string, number | boolean> = {},
): ScaleLadder | null {
  const scale = grant.scale;
  const steps = scale?.steps;
  if (!scale || !steps || grant.tiers || grant.variants || grant.problem)
    return null;
  if (stepsProblem(steps, scale.formula, bonus)) return null;
  const axis = stepAxis(steps.over)!;

  const runs: ScaleStep[] = [];
  for (const at of stepValues(steps)) {
    const moved = contextAt(bonus, ctx, inputValues, axis, at);
    const result = evaluateFormula(scale.formula, moved);
    const value = result.ok ? Math.round(result.value * 1e9) / 1e9 : 0;
    const granted = value > 0 && conditions.evaluate(grant.when, moved);
    const last = runs.at(-1);
    if (last && last.value === value && last.granted === granted) last.to = at;
    else runs.push({ from: at, to: at, value, granted });
  }

  const own = bonusContext(bonus, ctx, inputValues);
  const read = axisRead(axis);
  const current = evaluateFormula(steps.over, own);
  return {
    label: describeRead(read, 0, own)?.label ?? steps.over,
    format: (value) => describeRead(read, value, own)?.text ?? String(value),
    current: current.ok ? current.value : NaN,
    readKey: readKey(read),
    steps: runs,
  };
}
