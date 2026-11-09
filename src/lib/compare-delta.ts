// How far ahead or behind this build is of the compare build, as the stat panel prints it.
import { pct } from "./format";

export type Trend = "ahead" | "behind" | "even";

/** This build's lead over the compare build. */
export interface Delta {
  text: string;
  trend: Trend;
}

/** Green ahead, red behind, plain when even. */
export const TREND_TONE: Record<Trend, string> = {
  ahead: "text-ok",
  behind: "text-danger",
  even: "",
};

const EPSILON = 1e-9;

/** `value` relative to `base`, signed: positive means `value` is the bigger one. `null` with
 *  nothing to compare against or a zero `base`. */
export function relativeChange(
  base: number | null | undefined,
  value: number | null | undefined,
) {
  if (base == null || value == null || Math.abs(base) < EPSILON) return null;
  return (value - base) / Math.abs(base);
}

/** A signed percentage, or `-` when there is no difference to show. */
export function signedPct(value: number | null) {
  if (value == null || Math.abs(value) < EPSILON) return "-";
  return (value > 0 ? "+" : "") + pct(value);
}

/** `mine` against `other`, as a share of `other`. Even when not comparable. */
export function delta(mine: number, other: number | null | undefined): Delta {
  const change = relativeChange(other, mine);
  const trend: Trend =
    change == null || Math.abs(change) < EPSILON
      ? "even"
      : change > 0
        ? "ahead"
        : "behind";
  return { text: signedPct(change), trend };
}
