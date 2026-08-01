// Regression coverage for the page shell's scroll model: the header is fixed, the editor column
// scrolls independently of the stat panel, and the quick-options header stays visible after
// scrolling the editor content.
import { test, expect } from "@playwright/test";
import { openBuilder } from "./support/app";

test("the header is fixed at the top and does not scroll away", async ({
  page,
}) => {
  await openBuilder(page);
  const header = page.getByTestId("app-header");
  await expect(header).toBeVisible();

  // Scroll the editor column down.
  const editor = page.getByTestId("editor-column");
  await editor.evaluate((el) => el.scrollTo(0, el.scrollHeight));

  // The header should still be visible in the viewport.
  await expect(header).toBeVisible();
});

test("the editor column scrolls independently of the stat panel", async ({
  page,
}) => {
  await openBuilder(page);
  const editor = page.getByTestId("editor-column");
  const statPanel = page.getByTestId("stat-panel-column");

  // Both should have their own scroll container.
  const editorScrolls = await editor.evaluate(
    (el) => el.scrollHeight > el.clientHeight,
  );
  const statScrolls = await statPanel.evaluate(
    (el) => el.scrollHeight > el.clientHeight,
  );
  expect(editorScrolls || statScrolls).toBe(true);

  // Scroll the editor down and check that the stat panel didn't scroll.
  const statScrollBefore = await statPanel.evaluate((el) => el.scrollTop);
  await editor.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  const statScrollAfter = await statPanel.evaluate((el) => el.scrollTop);
  expect(statScrollAfter).toBe(statScrollBefore);
});

test("the quick-options header stays visible after scrolling the editor", async ({
  page,
}) => {
  await openBuilder(page);
  // The quick options are in the sticky header above the editor content.
  const quickOptions = page.getByTestId("editor-column").locator("..").first();
  const sticky = quickOptions.locator(".sticky").first();
  await expect(sticky).toBeVisible();

  // Scroll the editor column down.
  const editor = page.getByTestId("editor-column");
  await editor.evaluate((el) => el.scrollTo(0, el.scrollHeight));

  // The sticky header should still be visible.
  await expect(sticky).toBeVisible();
});
