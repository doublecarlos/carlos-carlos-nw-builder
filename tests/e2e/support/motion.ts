// Reads an element's entrance animation, for the motion specs. They run with motion turned
// back on, while the rest of the suite runs with reduced motion.
import type { Locator } from "@playwright/test";

/** The entrance on `target` or its nearest animated ancestor, read from computed style rather
 *  than `getAnimations()`, which drops an animation as soon as it finishes. */
export function entrance(target: Locator) {
  return target.evaluate((el) => {
    for (let node: Element | null = el; node; node = node.parentElement) {
      // The animation is the behavior under test here.

      const style = getComputedStyle(node);
      if (style.animationName !== "none") {
        return {
          name: style.animationName,
          ms: parseFloat(style.animationDuration) * 1000,
        };
      }
    }
    return null;
  });
}

/** Whether `target` enters with an animation inside the 200ms budget. */
export async function entersWithinBudget(target: Locator) {
  const found = await entrance(target);
  return !!found && found.ms > 0 && found.ms <= 200;
}
