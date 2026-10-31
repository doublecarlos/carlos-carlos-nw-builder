// Per-key values built on first use and kept for the component's life, for per-row
// composables that a template reaches by key (a drop list per folder or per grant).
import { effectScope } from "vue";

/** Each value is built inside a scope owned by the calling component, so a composable that
 *  registers cleanup still runs it on unmount, even when its first use happens during render. */
export function useKeyedCache<K, V>(create: (key: K) => V): (key: K) => V {
  const scope = effectScope();
  const cache = new Map<K, V>();
  return (key) => {
    if (!cache.has(key)) {
      const value = scope.active ? scope.run(() => create(key)) : create(key);
      cache.set(key, value as V);
    }
    return cache.get(key) as V;
  };
}
