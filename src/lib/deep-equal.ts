// Key-order-insensitive deep equality via sorted-key canonical JSON. Plain `JSON.stringify`
// comparison false-positives whenever an object's keys were added/removed and re-added in a
// different order (e.g. round-tripping through a form draft or an overlay); sorting keys
// before stringifying fixes that.

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort())
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonicalize(a)) === JSON.stringify(canonicalize(b));
}
