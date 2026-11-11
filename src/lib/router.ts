// The query-string API LayerEditor still writes through, over lib/navigation.ts.
import { navigation } from "./navigation";
import type { RoutePatch } from "./route-model";

export const parse = (): Record<string, string> => ({
  ...navigation.route.value,
});

export type RouterParams = RoutePatch;

/** `push: false` keeps the write off history, as `navigation.write`'s transient flag. */
export function apply(
  partial: RouterParams,
  { push = true }: { push?: boolean } = {},
) {
  navigation.write(partial, { transient: !push });
}
