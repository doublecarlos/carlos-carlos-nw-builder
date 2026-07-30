// Generic dotted-path get/set into a Build's `context`, used by BuildParameterSlot's `path`
// (`role`, `forte.primary`, `toggles.combat`) so BuildSlot/QuickOptions can read and write any
// build_parameter slot without a per-field switch. Callers pass `build.context` as `root`, not
// `build` itself, so a path structurally cannot address a sibling of `context` (`choices`,
// `id`, `catalog`, ...).
//
// `setPath` deletes the leaf key on an empty-string/undefined value rather than storing it.

import type { BuildParameterSlot, Slot } from './types';

export function getPath(root: unknown, path: string): unknown {
  let node: unknown = root;
  for (const key of path.split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

export function setPath(root: unknown, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop()!;
  let node = root as Record<string, unknown>;
  for (const key of keys) {
    let next = node[key];
    if (next == null || typeof next !== 'object') {
      next = {};
      node[key] = next;
    }
    node = next as Record<string, unknown>;
  }
  if (value === '' || value == null) delete node[last];
  else node[last] = value;
}

/** The `build_parameter` slot whose `path` is exactly `path` (relative to `context`) -- e.g.
 * `findParamSlot(NW_SLOTS.slots, 'class')`. Shared lookup for the two call sites (catalog.ts's
 * validator, ItemForm.vue's class checkboxes) that both need "the class slot" specifically. */
export function findParamSlot(slots: Slot[], path: string): BuildParameterSlot | undefined {
  return slots.find((slot): slot is BuildParameterSlot => (
    slot.type === 'build_parameter' && slot.path === path
  ));
}
