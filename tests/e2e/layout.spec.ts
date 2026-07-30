// Regression coverage for the page shell's scroll model: BuildEditor and the sidebar are meant to
// scroll independently within a fixed-height viewport (`lg:h-screen` down to `main`), not let the
// whole document grow to fit their content. The tailwind migration briefly dropped `min-h-0` on
// `main`, which let it -- and the page -- grow past the viewport instead.
import { test, expect } from '@playwright/test';
import { openBuilder } from './support/app';

test('the page body does not scroll -- BuildEditor and the sidebar scroll internally instead', async ({ page }) => {
  // Short enough that BuildEditor/StatPanel content overflows even a freshly-created build.
  await page.setViewportSize({ width: 1280, height: 500 });
  await openBuilder(page);

  const pageScrolls = await page.evaluate(() => {
    const scroller = document.scrollingElement!;
    return scroller.scrollHeight > scroller.clientHeight;
  });
  expect(pageScrolls).toBe(false);

  const content = page.getByTestId('builder-content');
  const sidebar = page.locator('aside.sidebar');
  const contentOverflows = await content.evaluate(el => el.scrollHeight > el.clientHeight);
  const sidebarOverflows = await sidebar.evaluate(el => el.scrollHeight > el.clientHeight);
  expect(contentOverflows || sidebarOverflows).toBe(true);
});
