// A scroll animation that takes the same short time however far it travels.
//
// Native smooth scrolling is duration-by-distance: on a list several screens tall, end to end
// takes a couple of seconds, which is latency for a destination reached by typing its name. A
// constant duration keeps the cost at one fixed beat while still showing which way the list
// moved, so a jump reads as travel rather than a teleport.
//
// The animated distance is capped as well. The eye reads direction from the last screen or so
// of travel, and animating thousands of pixels in the same beat only blurs rows past, so a long
// jump snaps to within the cap first and glides the rest of the way.

/** How long a jump scroll takes, whatever the distance. */
export const JUMP_SCROLL_MS = 250;

/** Anything with a writable `scrollTop` and the extents that bound it; the DOM element in the
 *  app, a plain object in tests. */
export interface ScrollTarget {
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

/** Stops a running animation. Idempotent, and a no-op once the animation has finished. */
export type CancelScroll = () => void;

const NOOP: CancelScroll = () => {};

/** Fast start, gentle landing: the eye reads the direction in the first frames and the target
 *  settles into place instead of arriving at full speed. */
export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

export interface ScrollAnimationOptions {
  /** Milliseconds from start to landing. */
  duration?: number;
  /** The most that is animated; anything beyond it is snapped over first. */
  maxDistance?: number;
}

export function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Eases `el.scrollTop` from where it is to `target` over `duration` ms, landing on `target`
 * exactly, or on the nearest reachable scroll position when `target` lies outside the range.
 * A jump longer than `maxDistance` first snaps to `maxDistance` short of the target,
 * on the side it is coming from, and animates that last stretch. Jumps straight there under
 * `prefers-reduced-motion: reduce`, and whenever there is no time or distance to animate across.
 *
 * Returns a cancel function. The caller cancels a still-running animation before starting the
 * next one, and on teardown, so no frame ever writes to a stale element.
 */
export function animateScrollTop(
  el: ScrollTarget,
  target: number,
  {
    duration = JUMP_SCROLL_MS,
    maxDistance = Infinity,
  }: ScrollAnimationOptions = {},
): CancelScroll {
  // A row in the last screen cannot reach the top edge, and easing toward a value the browser
  // refuses to write cuts the curve short, so aim at what is reachable from the start.
  target = Math.min(Math.max(target, 0), el.scrollHeight - el.clientHeight);
  if (el.scrollTop === target || duration <= 0 || prefersReducedMotion()) {
    el.scrollTop = target;
    return NOOP;
  }
  const distance = target - el.scrollTop;
  if (Math.abs(distance) > maxDistance) {
    el.scrollTop = target - Math.sign(distance) * maxDistance;
  }
  const from = el.scrollTop;
  const start = performance.now();
  let frame = 0;
  const step = () => {
    const t = Math.min((performance.now() - start) / duration, 1);
    el.scrollTop = t < 1 ? from + (target - from) * easeOutCubic(t) : target;
    frame = t < 1 ? requestAnimationFrame(step) : 0;
  };
  frame = requestAnimationFrame(step);
  return () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };
}
