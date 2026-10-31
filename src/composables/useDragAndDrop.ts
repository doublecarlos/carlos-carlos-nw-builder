// Generic drag-and-drop helpers for the app's list/tree reorder UIs (builds, layers, grants,
// tiers, variants, condition rows/branches). Pointer events plus list-level hit testing:
// `elementFromPoint` finds the innermost `[data-drop-list]` that accepts the source, which
// resolves to one gap or row. Outside any list, an enclosing `[data-drop-tail]` stands in for
// the list it names, so the space around a list still drops at its start or end. No per-row
// dragover handlers. Native DnD is only for file drops.
//
// Each drop zone gets an `onDrop` callback and the call site mutates the array. Drag state is
// a module-scope singleton so cross-component drops work without a common ancestor, with a
// registry of lists replacing native DnD's event bubbling. Every list instance has its own
// owner token, which its list, tail and row attributes carry, so the DOM always resolves to
// the instance that rendered it. A nested ConditionRows branch supplies its own useDropList,
// even while empty, so "drop into" needs no primitive.
//
// Vitest has no DOM, so only the pure helpers below are unit tested; DOM access is deferred to
// the pointerdown handler and its listeners. Playwright covers the rest.

import { computed, getCurrentScope, onScopeDispose, reactive } from "vue";

export interface DragSource {
  /** Distinguishes payload shapes so a drop zone can reject sources it doesn't understand
   *  (e.g. a condition row dropped where a build row is expected). */
  kind: string;
  /** Opaque id of the list/branch the item currently lives in. */
  containerId: string;
  /** Stable id within that container (e.g. a build's id, a row's uid). */
  key: string;
  /** Position within `containerId` before the drag started (see `reorderIndex`). */
  index: number;
  /** Arbitrary extra data a call site needs at drop time (e.g. a condition row's tree id and
   *  path, for a cross-container transfer). */
  data?: unknown;
}

/** Where a drop lands: between rows ("before"/"after" are the same insertion index) or inside
 *  a row that opted in via `rowProps(i, { into: true })`. */
export type DropZone = "before" | "after" | "into";

export interface DragHandleProps {
  onPointerdown(event: PointerEvent): void;
}

const DRAG_THRESHOLD = 4;
const AUTOSCROLL_ZONE = 24;
const AUTOSCROLL_MAX_SPEED = 12;

interface RowRect {
  top: number;
  /** Gap boundary and separator line. Extends over block children that follow the row but
   *  aren't rows themselves, such as a build folder's expanded children list. */
  bottom: number;
  /** The row's own bottom for the "into" band. Unlike `bottom`, never extended over block
   *  children. Defaults to `bottom`. */
  intoBottom?: number;
  into: boolean;
}

type Resolved = { zone: "gap"; gap: number } | { zone: "into"; index: number };

interface ListEntry {
  owner: string;
  accepts: (source: DragSource) => boolean;
  onDrop: (source: DragSource, index: number, zone: DropZone) => void;
}

interface DragTarget {
  /** Owner token of the list the pointer resolved to. */
  owner: string;
  /** Real (unfiltered) row indices, resolved against this list's own DOM rows. */
  resolved: Resolved;
  /** Separator position in the target list's own coordinate space, valid only when
   *  `resolved.zone === "gap"`. */
  separatorTop: number;
}

interface DragBusState {
  source: DragSource | null;
  target: DragTarget | null;
}

const state = reactive<DragBusState>({ source: null, target: null });
/** Lists by owner token, registered for the life of the scope that built them. */
const registry = new Map<string, ListEntry>();
let nextOwner = 0;

/** What is currently in flight, for call sites whose affordances depend on it. */
export const dragSource = computed<DragSource | null>(() => state.source);

/** Pure. The final index after the item is spliced out of `fromIndex`, given a target index
 *  computed before that removal. Only used for same-list moves. */
export function reorderIndex(fromIndex: number, toIndex: number): number {
  return toIndex > fromIndex ? toIndex - 1 : toIndex;
}

/** Pure. Resolves a pointer's `y` against row rects into an insertion gap (0..rows.length) or
 *  an "into" band over the middle half of a row that accepts drops. The 25/75 split keeps the
 *  reorder gesture reachable beside a folder. Positions index the given `rows` array. */
export function resolveTarget(rows: RowRect[], y: number): Resolved {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.into) continue;
    const bottom = row.intoBottom ?? row.bottom;
    const ratio = (y - row.top) / (bottom - row.top || 1);
    if (ratio >= 0.25 && ratio < 0.75) return { zone: "into", index: i };
  }
  const gap = rows.filter((r) => (r.top + r.bottom) / 2 < y).length;
  return { zone: "gap", gap };
}

/** Pure. Where the separator line sits for a resolved `gap`, relative to `listTop`, so it can
 *  be used directly as a `top` style inside a `position: relative` list root. Sits at the gap
 *  midpoint, or at `listContentBottom` when `gap === rows.length`. */
export function separatorTop(
  rows: RowRect[],
  gap: number,
  listContentBottom: number,
  listTop: number,
): number {
  if (gap >= rows.length) return listContentBottom - listTop;
  const above = gap > 0 ? rows[gap - 1].bottom : rows[gap].top;
  const below = rows[gap].top;
  return (above + below) / 2 - listTop;
}

/** Pure. Whether a press may arm a drag. A mouse drags from anywhere the handle props are
 *  bound, which for a nav row is the whole row. A finger or pen drags only from a grip
 *  (`[data-drag-handle]`, which is `touch-none`): anywhere else the browser owns the
 *  gesture, and the move threshold would otherwise arm a drag on the first few px of a swipe
 *  before the browser claimed it for scrolling. */
export function armsDrag(pointerType: string, onGrip: boolean): boolean {
  return pointerType === "mouse" || onGrip;
}

/** Pure. Autoscroll speed for the pointer's signed distance from a scrollable edge: negative
 *  near the top, positive near the bottom, 0 at `zone` px away, capped at `maxSpeed`. */
export function autoscrollDelta(
  distanceFromEdge: number,
  zone = AUTOSCROLL_ZONE,
  maxSpeed = AUTOSCROLL_MAX_SPEED,
): number {
  const abs = Math.abs(distanceFromEdge);
  if (abs >= zone) return 0;
  const speed = Math.round(((zone - abs) / zone) * maxSpeed);
  return distanceFromEdge < 0 ? -speed : speed;
}

function findScrollableAncestor(el: HTMLElement | null): HTMLElement | null {
  let node = el;
  while (node && node !== document.documentElement) {
    const style = getComputedStyle(node);
    if (
      (style.overflowY === "auto" || style.overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return null;
}

/** Reads the rows of `entry`'s list element `listEl` from the DOM and resolves the pointer
 *  against them. Rects are read per move, since autoscroll changes them. */
function resolveInList(
  entry: ListEntry,
  listEl: HTMLElement,
  x: number,
  y: number,
): DragTarget {
  const rowEls = Array.from(
    listEl.querySelectorAll<HTMLElement>(`[data-drop-of="${entry.owner}"]`),
  );
  // A row's element can sit inside a wrapper that is the root's direct child. Walk up to that
  // wrapper to compare it with the root's other direct children below.
  function ownDirectChild(el: HTMLElement): HTMLElement {
    let node = el;
    while (node.parentElement && node.parentElement !== listEl)
      node = node.parentElement;
    return node;
  }
  const directChildren = Array.from(listEl.children);
  const rects: RowRect[] = rowEls.map((el, i) => {
    const rect = el.getBoundingClientRect();
    // A folder renders its children list as a further direct child after its row. Extend
    // `bottom` over those children, up to the next row's wrapper, so the gap falls past the
    // whole block.
    const startIdx = directChildren.indexOf(ownDirectChild(el));
    const nextRowEl = rowEls[i + 1];
    const nextStartIdx = nextRowEl
      ? directChildren.indexOf(ownDirectChild(nextRowEl))
      : directChildren.length;
    const blockEnd = directChildren[Math.max(startIdx, nextStartIdx - 1)];
    const blockBottom = blockEnd
      ? blockEnd.getBoundingClientRect().bottom
      : rect.bottom;
    return {
      top: rect.top,
      bottom: Math.max(rect.bottom, blockBottom),
      intoBottom: rect.bottom,
      into: el.hasAttribute("data-drop-into"),
    };
  });
  const indices = rowEls.map((el) => Number(el.dataset.dropRow));
  const resolved = resolveTarget(rects, y);

  if (resolved.zone === "into") {
    return {
      owner: entry.owner,
      resolved: { zone: "into", index: indices[resolved.index] },
      separatorTop: 0,
    };
  }

  const realGap =
    resolved.gap < indices.length
      ? indices[resolved.gap]
      : indices.length
        ? indices[indices.length - 1] + 1
        : 0;
  const listRect = listEl.getBoundingClientRect();
  const lastChild = listEl.lastElementChild;
  const listContentBottom = lastChild
    ? lastChild.getBoundingClientRect().bottom
    : listRect.bottom;
  return {
    owner: entry.owner,
    resolved: { zone: "gap", gap: realGap },
    // Round to a whole pixel, or a 2px line at a fractional `top` anti-aliases across rows.
    separatorTop: Math.round(
      separatorTop(rects, resolved.gap, listContentBottom, listRect.top),
    ),
  };
}

/** Walks up through enclosing `[data-drop-list]`s until one accepts the source. A build over
 *  a folder's build-only list falls through to the root list around it. Past the outermost
 *  list, an enclosing `[data-drop-tail]` resolves against the list it names. */
function hitTest(x: number, y: number) {
  if (!state.source) {
    state.target = null;
    return;
  }
  const source = state.source;
  const hit = document.elementFromPoint(x, y) as HTMLElement | null;
  let node = hit;
  let resolved: DragTarget | null = null;
  while (node) {
    const listEl: HTMLElement | null = node.closest("[data-drop-list]");
    if (!listEl) break;
    const entry = registry.get(listEl.dataset.dropList!);
    if (entry && entry.accepts(source)) {
      resolved = resolveInList(entry, listEl, x, y);
      break;
    }
    node = listEl.parentElement;
  }
  if (!resolved) {
    const tailEl: HTMLElement | null = hit?.closest("[data-drop-tail]") ?? null;
    const entry = tailEl && registry.get(tailEl.dataset.dropTail!);
    const listEl =
      entry &&
      document.querySelector<HTMLElement>(`[data-drop-list="${entry.owner}"]`);
    if (entry && listEl && entry.accepts(source))
      resolved = resolveInList(entry, listEl, x, y);
  }
  state.target = resolved;
}

let scrollRaf: number | null = null;
let lastPointer = { x: 0, y: 0 };
// True for one frame after a pointermove. Autoscroll waits for a still tick, so a frame
// between the pointer settling and release can't scroll under an already-resolved drop.
let pointerMovedSinceLastTick = false;

function autoscrollTick() {
  if (!state.source) {
    scrollRaf = null;
    return;
  }
  if (pointerMovedSinceLastTick) {
    pointerMovedSinceLastTick = false;
    scrollRaf = requestAnimationFrame(autoscrollTick);
    return;
  }
  const el = document.elementFromPoint(
    lastPointer.x,
    lastPointer.y,
  ) as HTMLElement | null;
  const scrollEl = findScrollableAncestor(el);
  if (scrollEl) {
    const rect = scrollEl.getBoundingClientRect();
    const topDist = lastPointer.y - rect.top;
    const bottomDist = rect.bottom - lastPointer.y;
    let delta = 0;
    if (topDist < AUTOSCROLL_ZONE) delta = autoscrollDelta(-topDist);
    else if (bottomDist < AUTOSCROLL_ZONE) delta = autoscrollDelta(bottomDist);
    if (delta !== 0) {
      scrollEl.scrollTop += delta;
      hitTest(lastPointer.x, lastPointer.y);
    }
  }
  scrollRaf = requestAnimationFrame(autoscrollTick);
}

function moveDrag(x: number, y: number) {
  lastPointer = { x, y };
  pointerMovedSinceLastTick = true;
  hitTest(x, y);
}

function onEscape(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    cancelDrag();
  }
}
function onWindowBlur() {
  cancelDrag();
}
function swallowClick(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
}

function startDrag(
  source: DragSource,
  handleEl: HTMLElement,
  pointerId: number,
) {
  state.source = source;
  state.target = null;
  pointerMovedSinceLastTick = true;
  try {
    handleEl.setPointerCapture(pointerId);
  } catch {
    // Not critical: window listeners still drive the drag.
  }
  document.documentElement.classList.add("is-dragging");
  // Clears any selection made while the pointer traveled here. Without `draggable="true"`, a
  // mousedown-move starts native text selection, which `is-dragging`'s `user-select: none`
  // only stops from spreading. Handles and whole-row targets therefore keep a permanent
  // `select-none` (DragHandle.vue, NavRow.vue) so selection never starts.
  window.getSelection?.()?.removeAllRanges();
  window.addEventListener("keydown", onEscape, true);
  window.addEventListener("blur", onWindowBlur);
  // One-shot, capture phase: swallows the click the browser fires on the common ancestor of
  // the down/up targets after a drag. `teardown` removes it on cancel.
  window.addEventListener("click", swallowClick, { capture: true, once: true });
  scrollRaf = requestAnimationFrame(autoscrollTick);
}

function teardown() {
  if (scrollRaf !== null) {
    cancelAnimationFrame(scrollRaf);
    scrollRaf = null;
  }
  document.documentElement.classList.remove("is-dragging");
  window.removeEventListener("keydown", onEscape, true);
  window.removeEventListener("blur", onWindowBlur);
  window.removeEventListener("click", swallowClick, true);
}

function endDrag() {
  const { source, target } = state;
  teardown();
  state.source = null;
  state.target = null;
  if (!source || !target) return;
  const entry = registry.get(target.owner);
  if (!entry) return;
  if (target.resolved.zone === "into") {
    entry.onDrop(source, target.resolved.index, "into");
  } else {
    entry.onDrop(source, target.resolved.gap, "before");
  }
}

function cancelDrag() {
  teardown();
  state.source = null;
  state.target = null;
}

/** Binds the element that starts a drag: a grip icon in the editor's rows (so inputs keep text
 *  selection) and the whole row in the sidebar nav. Rename mode turns dragging off. A touch
 *  press arms only from a grip inside the bound element (see `armsDrag`).
 *
 *  `pointerdown` only arms a drag; it starts after `DRAG_THRESHOLD` px, so a click or small
 *  wiggle still selects the row. Presses in an editable descendant or a `data-no-drag` element
 *  never arm. */
function createDragHandle(getSource: () => DragSource): DragHandleProps {
  return {
    onPointerdown(event: PointerEvent) {
      if (event.button !== 0) return;
      const startedOn = event.target as HTMLElement;
      if (
        startedOn.closest("input, textarea, [contenteditable], [data-no-drag]")
      )
        return;

      const handleEl = event.currentTarget as HTMLElement;
      const grip = startedOn.closest("[data-drag-handle]");
      if (!armsDrag(event.pointerType, !!grip && handleEl.contains(grip)))
        return;
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      let dragging = false;
      let finished = false;

      function finish(canceled: boolean) {
        if (finished) return;
        finished = true;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onPointerCancel);
        window.removeEventListener("lostpointercapture", onLostCapture);
        if (!dragging) return;
        if (canceled) cancelDrag();
        else endDrag();
      }

      function onMove(moveEvent: PointerEvent) {
        if (moveEvent.pointerId !== pointerId) return;
        if (!dragging) {
          const dx = moveEvent.clientX - startX;
          const dy = moveEvent.clientY - startY;
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
          dragging = true;
          startDrag(getSource(), handleEl, pointerId);
        }
        moveDrag(moveEvent.clientX, moveEvent.clientY);
      }
      function onUp(upEvent: PointerEvent) {
        if (upEvent.pointerId !== pointerId) return;
        finish(false);
      }
      function onPointerCancel(cancelEvent: PointerEvent) {
        if (cancelEvent.pointerId !== pointerId) return;
        finish(true);
      }
      // A capture loss ahead of the matching pointerup would strand the drag open; defer a
      // frame so a same-frame pointerup finishes first and this no-ops via `finished`. Only
      // the handle's own capture counts: a touch starts implicitly captured to the element
      // under the finger, and `startDrag` taking it over fires a loss there.
      function onLostCapture(lostEvent: PointerEvent) {
        if (lostEvent.pointerId !== pointerId || lostEvent.target !== handleEl)
          return;
        requestAnimationFrame(() => finish(true));
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onPointerCancel);
      window.addEventListener("lostpointercapture", onLostCapture);
    },
  };
}

/** Drag handles for a component's rows, built once in setup. A row passes its current source on
 *  each render and gets the same handle object back while that source is unchanged, so a
 *  re-render does not hand the row a new listener. */
export function useDragHandles(): (source: DragSource) => DragHandleProps {
  const handles = new Map<string, DragHandleProps>();
  return (source) => {
    const key = JSON.stringify(source);
    let handle = handles.get(key);
    if (!handle) {
      handle = createDragHandle(() => source);
      handles.set(key, handle);
    }
    return handle;
  };
}

/** One reorderable list. `accepts` usually checks `source.kind` and, for lists scoped to a
 *  parent (tiers/variants per grant), the source's `containerId`.
 *
 *  Registered until the calling scope is disposed, so build it in setup, or for a per-row list
 *  inside the component's scope (`useKeyedCache`). */
export function useDropList(options: {
  accepts: (source: DragSource) => boolean;
  /** `zone` is `"into"` only for rows registered with `rowProps(i, { into: true })`; then
   *  `index` is that row's own index, not a gap. */
  onDrop: (source: DragSource, index: number, zone: DropZone) => void;
}) {
  const owner = `drop-${nextOwner++}`;
  registry.set(owner, {
    owner,
    accepts: options.accepts,
    onDrop: options.onDrop,
  });
  if (getCurrentScope()) onScopeDispose(() => registry.delete(owner));
  else if (import.meta.env.DEV)
    console.warn("useDropList outside an effect scope is never unregistered");

  /** Bind on the list's root. Sets `data-drop-list`, so a hit inside it resolves back to this
   *  list. */
  function listProps() {
    return { "data-drop-list": owner };
  }

  /** Bind on an element around the list whose empty space should drop into it: above the
   *  rows lands first, below them lands last. */
  function tailProps() {
    return { "data-drop-tail": owner };
  }

  /** Bind on each row: `data-drop-row`, `data-drop-of`, and `data-drop-into` for an "into"
   *  row. The controller reads these via `elementFromPoint`, so there are no per-row
   *  listeners. */
  function rowProps(
    index: number,
    opts?: { into?: boolean },
  ): Record<string, string | undefined> {
    return {
      "data-drop-row": String(index),
      "data-drop-of": owner,
      "data-drop-into": opts?.into ? "" : undefined,
    };
  }

  /** True while this list is the resolved drop target. */
  const isActiveContainer = computed(
    () => state.source !== null && state.target?.owner === owner,
  );

  /** Resolved insertion gap (a real index in `0..size`) when the zone isn't `"into"`, else
   *  null. */
  const dropGap = computed<number | null>(() => {
    if (!isActiveContainer.value || state.target?.resolved.zone !== "gap")
      return null;
    return state.target.resolved.gap;
  });

  /** Real row index when the zone is `"into"`, else null. */
  const intoIndex = computed<number | null>(() => {
    if (!isActiveContainer.value || state.target?.resolved.zone !== "into")
      return null;
    return state.target.resolved.index;
  });

  /** Style for `DropIndicator`, in the list's own coordinate space; null hides it. */
  const separatorStyle = computed<{ top: string } | null>(() => {
    if (dropGap.value === null || !state.target) return null;
    return { top: `${state.target.separatorTop}px` };
  });

  return {
    listProps,
    tailProps,
    rowProps,
    intoIndex,
    separatorStyle,
  };
}
