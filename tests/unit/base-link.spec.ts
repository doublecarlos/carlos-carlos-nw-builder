// Vitest runs with `environment: "node"`, so the primitive is checked through its server
// rendered markup rather than a mounted DOM.
import { describe, it, expect } from "vitest";
import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import BaseLink from "../../src/components/ui/BaseLink.vue";

const render = (props: Record<string, unknown> = {}) =>
  renderToString(
    createSSRApp({
      render: () => h(BaseLink, props, () => "apply"),
    }),
  );

describe("BaseLink", () => {
  it("renders an action button sitting on the text baseline", async () => {
    const html = await render();
    expect(html).toMatch(/^<button [^>]*type="button"/);
    expect(html).toMatch(/apply<!--\]--><\/button>$/);
    expect(html).not.toMatch(/<button [^>]*\sdisabled/);
    for (const cls of [
      "inline-block",
      "align-baseline",
      "text-accent",
      "hover:underline",
      "focus-visible:underline",
    ]) {
      expect(html).toContain(cls);
    }
  });

  it("passes the disabled prop through to the element", async () => {
    const html = await render({ disabled: true });
    expect(html).toMatch(/<button [^>]*\bdisabled\b/);
  });

  it("forwards attributes to the button", async () => {
    const html = await render({ "data-testid": "notice-action" });
    expect(html).toContain('data-testid="notice-action"');
  });

  it("renders plain text in a span when there is nowhere to go", async () => {
    const html = await render({ plain: true, "data-testid": "excluder" });
    expect(html).toMatch(/^<span [^>]*data-testid="excluder"/);
    expect(html).not.toContain("<button");
    expect(html).not.toContain("text-accent");
    expect(html).toContain("apply");
  });
});
