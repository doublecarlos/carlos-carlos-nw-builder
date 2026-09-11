// Vitest runs with `environment: "node"`, so the primitive is checked through its server
// rendered markup rather than a mounted DOM.
import { describe, it, expect } from "vitest";
import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import LinkList from "../../src/components/ui/LinkList.vue";
import type { LinkListItem } from "../../src/components/ui/LinkList.vue";

const render = (items: LinkListItem[], props: Record<string, unknown> = {}) =>
  renderToString(
    createSSRApp({
      render: () => h("p", [h(LinkList, { items, ...props })]),
    }),
  );

const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("LinkList", () => {
  it("separates links with the separator and nothing else", async () => {
    const html = await render([
      { key: "a", label: "Ring" },
      { key: "b", label: "Belt" },
    ]);
    expect(text(html)).toBe("Ring, Belt");
    expect(html.match(/<button /g)).toHaveLength(2);
  });

  it("writes a plain entry as text, keeping its place in the list", async () => {
    const html = await render(
      [
        { key: "a", label: "Ring" },
        { key: "b", label: "Belt", plain: true },
        { key: "c", label: "Boots" },
      ],
      { separator: " / " },
    );
    expect(text(html)).toBe("Ring / Belt / Boots");
    expect(html.match(/<button /g)).toHaveLength(2);
    expect(html).toContain("<span>Belt</span>");
  });

  it("stamps the caller's test id on every link", async () => {
    const html = await render(
      [
        { key: "a", label: "Ring" },
        { key: "b", label: "Belt" },
      ],
      { linkTestid: "member-link" },
    );
    expect(html.match(/data-testid="member-link"/g)).toHaveLength(2);
  });
});
