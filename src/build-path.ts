// Generic dotted-path get/set into a Build, used by BuildParameterSlot's `path`
// (`context.role`, `context.forte.primary`, `context.toggles.combat`) so BuildSlot/QuickOptions
// can read and write any build_parameter slot without a per-field switch.
//
// `setPath` deletes the leaf key on an empty-string/undefined value rather than storing it --
// the same convention `stores/buildEditor.ts`'s old `setForte` used to "unset" a forte pick.

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
