// Tag badges on the item card: a badge per badged tag, in the item's tag order, and a tone
// authored in the Vocabulary tab reaching the card.
import { test, expect, type Page } from "@playwright/test";
import { hoverForCard, openBuilder, slotRow } from "./support/app";
import { buildRow, layerRow } from "./support/nav";
import { importTestCatalog } from "./support/testCatalog";
import type { TagDef } from "../../src/types";

const RING_SLOT = "gear.ring1";

/** Equips a test ring carrying `tags`, with `declared` as the layer's tag declarations. */
async function equipTaggedRing(page: Page, tags: string[], declared: TagDef[]) {
  await openBuilder(page);
  await importTestCatalog(page, {
    choices: { [RING_SLOT]: "test-badge-ring" },
    items: [
      {
        id: "test-badge-ring",
        name: "Test Badge Ring",
        filter: "gear_ring",
        tags,
      },
    ],
    tags: declared,
  });
}

// Badges state a fact at a glance, so they must sit inside the card's body, under its header,
// in the order the item lists its tags.
test(
  "the item card shows a badge per badged tag in tag order",
  { tag: "@cross-browser" },
  async ({ page }) => {
    await equipTaggedRing(
      page,
      ["test:second", "test:plain", "test:first"],
      [
        { id: "test:first", label: "First role", badge: { tone: "orange" } },
        {
          id: "test:second",
          badge: { label: "Second", tone: "blue" },
        },
        { id: "test:plain", label: "Plain tag" },
      ],
    );
    await hoverForCard(page, slotRow(page, RING_SLOT).locator(".slot-label"));

    const card = page.getByTestId("item-card");
    const badges = card.getByTestId("tone-badge");
    await expect(badges).toHaveText(["Second", "First role"]);
    await expect(badges.nth(0)).toHaveAttribute("data-tone", "blue");
    await expect(badges.nth(1)).toHaveAttribute("data-tone", "orange");

    const cardBox = (await card.boundingBox())!;
    const header = (await card.getByTestId("item-card-name").boundingBox())!;
    for (const badge of await badges.all()) {
      const box = (await badge.boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(header.y + header.height);
      expect(box.x).toBeGreaterThanOrEqual(cardBox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
    }
  },
);

// The tone picker is how a maintainer adds a badge, so it has to reach the card.
test("a badge tone set in the Vocabulary tab shows on the item card", async ({
  page,
}) => {
  await equipTaggedRing(page, ["test:role"], []);
  await layerRow(page, "Test catalog (imported)").locator(".nav-name").click();
  await page.getByTestId("tab-vocabulary").click();
  await page.locator(".editor-search").fill("test:role");
  await page
    .locator('.editor-row[data-kind="tag"]', {
      has: page.getByText("test:role", { exact: true }),
    })
    .click();

  await page.getByTestId("tag-badge-tone").click();
  await page.getByRole("option", { name: "Teal" }).click();
  await page.getByTestId("tag-badge-label-input").fill("Test Role");
  await page.getByTestId("save-tag").click();

  await buildRow(page, "Test catalog").first().click();
  await hoverForCard(page, slotRow(page, RING_SLOT).locator(".slot-label"));
  const badge = page.getByTestId("item-card").getByTestId("tone-badge");
  await expect(badge).toHaveText("Test Role");
  await expect(badge).toHaveAttribute("data-tone", "teal");
});
