// Draws a flat list of items as a tree: each item names the headings it sits under, outermost
// first, and a heading row appears wherever the path enters one the previous item was not
// under. Items must arrive in tree order (a build list in sidebar order is), so an item listed
// after a subfolder's contents falls back to its own level with no heading repeated, exactly
// as the sidebar draws it. Every surface listing builds outside the sidebar goes through this.
import type { CSSProperties } from "vue";

/** One heading on an item's path. `key` tells two same-labelled headings apart. */
export interface TreeStep {
  key: string;
  label: string;
}

export type TreeRow<T> =
  | { kind: "heading"; step: TreeStep; depth: number }
  | { kind: "item"; item: T; depth: number };

export function treeRows<T>(
  items: readonly T[],
  pathOf: (item: T) => readonly TreeStep[] | undefined,
): TreeRow<T>[] {
  const out: TreeRow<T>[] = [];
  let previous: readonly TreeStep[] = [];
  for (const item of items) {
    const path = pathOf(item) ?? [];
    let shared = 0;
    while (
      shared < path.length &&
      shared < previous.length &&
      path[shared].key === previous[shared].key
    )
      shared++;
    for (let depth = shared; depth < path.length; depth++)
      out.push({ kind: "heading", step: path[depth], depth });
    out.push({ kind: "item", item, depth: path.length });
    previous = path;
  }
  return out;
}

/** A path spelled out on one line, for a tooltip or a search haystack. */
export const pathLabel = (path: readonly TreeStep[] | undefined) =>
  (path ?? []).map((step) => step.label).join(" / ");

const INDENT_REM = 0.75;

/** How far a row at `depth` sits in from its list's edge. */
export const treeIndent = (depth: number): CSSProperties =>
  depth ? { marginInlineStart: `${depth * INDENT_REM}rem` } : {};

/** The same indent as padding, for a full-width row whose background must still reach the
 *  edge (a menu item). `baseRem` is the row's own start padding. */
export const treePadding = (depth: number, baseRem: number): CSSProperties =>
  depth ? { paddingInlineStart: `${baseRem + depth * INDENT_REM}rem` } : {};
