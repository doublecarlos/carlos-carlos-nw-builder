// Real touch input for the mobile specs.
import { type Locator, type Page } from "@playwright/test";
import { requireBox } from "./dragDrop";

/** Real touch input through CDP, so the browser sees a finger: pointer events arrive with
 *  `pointerType: "touch"` and an unclaimed move scrolls the page as a swipe would. */
export async function touchDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 12,
) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [from],
  });
  for (let i = 1; i <= steps; i++) {
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: from.x + ((to.x - from.x) * i) / steps,
          y: from.y + ((to.y - from.y) * i) / steps,
        },
      ],
    });
  }
  // Touch moves are delivered once per frame, so let the last one land before lifting.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await cdp.detach();
}

export async function center(target: Locator) {
  const box = await requireBox(target);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
