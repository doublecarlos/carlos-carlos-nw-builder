// Detects the three ways a form "wraps" badly on a narrow screen: a button label broken over
// lines, anything scrolling sideways, and a FormGrid or SegmentedControl whose items on one
// visual row disagree on height or top. Each check returns readable offender descriptions, so
// a failure names what broke.
import type { Locator } from "@playwright/test";

/** Visible buttons under `scope` whose text takes more than one line. Heights alone cannot
 *  tell, since a coarse pointer gives every button a tap-target minimum height that a two-line
 *  label fits inside; so the text's own line boxes are counted instead, compared against the
 *  same text with wrapping turned off. Icon-only buttons have no text to wrap. */
export function wrappedButtons(
  scope: Locator,
  selector = "button",
): Promise<string[]> {
  return scope.evaluate((root, selector) => {
    /** The distinct line tops of an element's text. */
    const lineCount = (el: Element) => {
      const tops: number[] = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const range = document.createRange();
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue;
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) {
          if (!rect.width) continue;
          if (!tops.some((top) => Math.abs(top - rect.top) < rect.height / 2))
            tops.push(rect.top);
        }
      }
      return tops.length;
    };
    const style = document.createElement("style");
    style.textContent =
      "[data-wrap-probe], [data-wrap-probe] * { white-space: nowrap !important; }";
    document.head.append(style);
    const found: string[] = [];
    try {
      for (const button of root.querySelectorAll<HTMLElement>(selector)) {
        const text = button.textContent?.trim() ?? "";
        if (!text || !button.checkVisibility()) continue;
        const lines = lineCount(button);
        button.setAttribute("data-wrap-probe", "");
        const single = lineCount(button);
        button.removeAttribute("data-wrap-probe");
        if (lines > single)
          found.push(`button "${text}" (${lines} lines, ${single} unwrapped)`);
      }
    } finally {
      style.remove();
    }
    return found;
  }, selector);
}

/** The page, `scope`, or any scroll container inside it, scrolling sideways. */
export function sidewaysScroll(scope: Locator): Promise<string[]> {
  return scope.evaluate((root) => {
    const describe = (el: Element) =>
      el.getAttribute("data-testid") ??
      `${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 3).join(".")}`;
    const found: string[] = [];
    const page = document.documentElement;
    if (page.scrollWidth > page.clientWidth)
      found.push(`page (${page.scrollWidth} > ${page.clientWidth})`);
    for (const el of [root, ...root.querySelectorAll<HTMLElement>("*")]) {
      const overflowX = getComputedStyle(el).overflowX;
      if (overflowX === "visible" || overflowX === "clip") continue;
      if (el.scrollWidth > el.clientWidth + 1)
        found.push(`${describe(el)} (${el.scrollWidth} > ${el.clientWidth})`);
    }
    return found;
  });
}

/** FormGrid cells and SegmentedControl segments under `scope` that share a visual row but
 *  not its top and height, and any such group collapsed to zero width. */
export function raggedRows(scope: Locator): Promise<string[]> {
  return scope.evaluate((root) => {
    const groups = root.querySelectorAll<HTMLElement>(
      '[data-testid="form-grid"], [data-testid="segmented-group"]',
    );
    const found: string[] = [];
    for (const group of groups) {
      if (!group.checkVisibility()) continue;
      // A size container laid out as a content-sized flex item has no width at all.
      if (group.getBoundingClientRect().width < 1) {
        found.push(
          `${group.getAttribute("data-testid")} collapsed to zero width`,
        );
        continue;
      }
      const boxes = [...group.children]
        .filter((child) => child.checkVisibility())
        .map((child) => ({
          child,
          box: child.getBoundingClientRect(),
        }));
      // Items whose vertical extents overlap sit on one visual row.
      const rows: (typeof boxes)[] = [];
      for (const item of boxes) {
        const row = rows.find((candidate) =>
          candidate.some(
            ({ box }) =>
              item.box.top < box.bottom - 1 && box.top < item.box.bottom - 1,
          ),
        );
        if (row) row.push(item);
        else rows.push([item]);
      }
      for (const row of rows) {
        const [first] = row;
        const off = row.filter(
          ({ box }) =>
            Math.abs(box.top - first.box.top) > 1 ||
            Math.abs(box.height - first.box.height) > 1,
        );
        if (off.length)
          found.push(
            `${group.getAttribute("data-testid")} row "${row
              .map(({ child }) => child.textContent?.trim().slice(0, 20))
              .join(" | ")}"`,
          );
      }
    }
    return found;
  });
}

/** Ad-hoc `flex-wrap` rows under `scope` that broke unevenly: some of their items moved to a
 *  later line while others share one. A row stacked one item per line reads as intended. */
export function brokenFlexRows(scope: Locator): Promise<string[]> {
  return scope.evaluate((root) => {
    const found: string[] = [];
    for (const row of root.querySelectorAll<HTMLElement>("*")) {
      if (!row.checkVisibility()) continue;
      const style = getComputedStyle(row);
      if (!style.display.endsWith("flex") || style.flexWrap !== "wrap")
        continue;
      if (style.flexDirection.startsWith("column")) continue;
      const items = [...row.children].filter(
        (child) =>
          child.checkVisibility() &&
          getComputedStyle(child).position !== "absolute",
      );
      // A line starts where an item begins below everything on the line before it.
      const lines: Element[][] = [];
      let lineBottom = Number.NEGATIVE_INFINITY;
      for (const item of items) {
        const box = item.getBoundingClientRect();
        if (box.top >= lineBottom - 1) {
          lines.push([item]);
          lineBottom = box.bottom;
        } else {
          lines[lines.length - 1].push(item);
          lineBottom = Math.max(lineBottom, box.bottom);
        }
      }
      if (lines.length < 2 || lines.every((line) => line.length === 1))
        continue;
      const name =
        row.getAttribute("data-testid") ??
        `${row.tagName.toLowerCase()}.${[...row.classList].slice(0, 4).join(".")}`;
      found.push(
        `${name} wraps as ${lines
          .map((line) =>
            line
              .map((item) => (item.textContent?.trim() || "?").slice(0, 16))
              .join(" | "),
          )
          .join(" / ")}`,
      );
    }
    return found;
  });
}
