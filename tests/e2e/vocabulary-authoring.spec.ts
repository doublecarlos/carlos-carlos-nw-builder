// The layer editor's Vocabulary tab: filters and tags in one list, a tag's label authored there
// reaching the conditions that test it, and an old Filters tab URL landing on it.
import { test, expect, type Page } from "@playwright/test";
import { hoverForCard, openBuilder, slotRow } from "./support/app";
import { addLayer, buildRow, layerRow } from "./support/nav";
import { importTestCatalog } from "./support/testCatalog";

const RING_SLOT = "gear.ring1";
const GEM_TAG = "test:gem";
const GEM_LABEL = "Test gem enchantment";

/** A worn ring whose bonus needs an item tagged `GEM_TAG`, which the build does not have. */
async function importGemRing(page: Page) {
  await importTestCatalog(page, {
    choices: { [RING_SLOT]: "test-gem-ring" },
    items: [
      {
        id: "test-gem-ring",
        name: "Test Gem Ring",
        filter: "gear_ring",
        bonuses: ["test-gem-bonus"],
      },
      {
        id: "test-gem",
        name: "Test Gem",
        filter: "enchantment_utility",
        tags: [GEM_TAG],
      },
    ],
    bonuses: [
      {
        id: "test-gem-bonus",
        name: "Test Gem Bonus",
        grants: [
          { when: { equipped: { tag: GEM_TAG } }, stats: { ca_p: 0.03 } },
        ],
      },
    ],
  });
}

/** Creates a layer, selects it, and opens the Vocabulary tab. */
async function openVocabularyTab(page: Page) {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByTestId("tab-vocabulary").click();
}

const tagRow = (page: Page, tag: string) =>
  page.locator('.editor-row[data-kind="tag"]', {
    has: page.getByText(tag, { exact: true }),
  });

// The label is how an unmet tag test reads to a player, so authoring it has to reach the card.
test("a tag labeled in the Vocabulary tab reads by its label in an unmet condition", async ({
  page,
}) => {
  await openBuilder(page);
  await importGemRing(page);
  await layerRow(page, "Test catalog (imported)").locator(".nav-name").click();
  await page.getByTestId("tab-vocabulary").click();

  // A tag in use is listed without a declaration, so labeling it needs no typed id.
  await page.locator(".editor-search").fill(GEM_TAG);
  await tagRow(page, GEM_TAG).click();
  await expect(page.getByTestId("tag-name-input")).toHaveCount(0);
  await expect(page.getByTestId("tag-item-count")).toContainText("1 item(s)");
  await page.getByTestId("tag-label-input").fill(GEM_LABEL);
  await page.getByTestId("save-tag").click();
  await expect(tagRow(page, GEM_TAG).getByText("added")).toBeVisible();

  await buildRow(page, "Test catalog").first().click();
  await hoverForCard(page, slotRow(page, RING_SLOT));
  await expect(
    page.getByTestId("item-card").getByTestId("item-card-bonus-unmet"),
  ).toContainText(`1× ${GEM_LABEL}`);
});

test("a filter labeled in the Vocabulary tab shows in the item form's filter picker", async ({
  page,
}) => {
  await openVocabularyTab(page);
  await page.locator(".editor-search").fill("gear_ring");
  await page
    .locator('.editor-row[data-kind="filter"]', {
      has: page.getByText("gear_ring", { exact: true }),
    })
    .click();
  await page.getByTestId("filter-label-input").fill("Zzz test ring label");

  await page.getByTestId("tab-items").click();
  await page.getByTestId("new-item").click();
  await page.getByTestId("item-filter-input").fill("Zzz test ring");
  await expect(
    page
      .getByRole("option", { name: "Zzz test ring label" })
      .getByTestId("option-row-id"),
  ).toHaveText("gear_ring");
});

// Filters and tags are one list, searched as one, each under its own heading.
test(
  "one search covers both groups, each under its heading",
  { tag: "@cross-browser" },
  async ({ page }) => {
    await openVocabularyTab(page);
    await page.locator(".editor-search").fill("ring");
    const filterHeading = page.getByTestId("entry-heading-filter");
    const tagHeading = page.getByTestId("entry-heading-tag");
    await expect(filterHeading).toBeVisible();
    await expect(tagHeading).toBeVisible();
    const filterBox = await filterHeading.boundingBox();
    const tagBox = await tagHeading.boundingBox();
    expect(tagBox!.y).toBeGreaterThan(filterBox!.y);
  },
);

test("a new tag is declared from the New menu, and its finding opens it", async ({
  page,
}) => {
  await openVocabularyTab(page);
  await page.getByTestId("new-vocabulary-entry").click();
  await page.getByTestId("new-tag").click();
  await page.getByTestId("tag-name-input").fill("zzz:unused");
  await page.getByTestId("tag-label-input").fill("Zzz unused");
  await page.getByTestId("save-tag").click();

  // Declared but carried by nothing, so it warns; the warning names the tag.
  const finding = page
    .getByTestId("validation-drawer")
    .getByRole("button", { name: "zzz:unused" });
  await expect(finding).toBeVisible();

  await page.getByTestId("tab-items").click();
  await finding.click();
  await expect(page.getByTestId("tab-vocabulary")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("tag-label-input")).toHaveValue("Zzz unused");
});

// The Vocabulary tab took over the Filters tab, so a link saved before still opens it.
test("an old Filters tab URL opens the Vocabulary tab", async ({ page }) => {
  await openVocabularyTab(page);
  const url = new URL(page.url());
  url.searchParams.set("section", "filters");
  url.searchParams.set("filter", "gear_ring");
  await page.goto(url.toString());

  await expect(page.getByTestId("tab-vocabulary")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByTestId("filter-default-max-copies")).toBeVisible();
  await expect(page).toHaveURL(/section=vocabulary/);
});

// Labeling a tag starts from the item that carries it, without hunting for it in the list.
test("an item's unlabeled tag links to its form, and labeling it drops the link", async ({
  page,
}) => {
  await openBuilder(page);
  await importGemRing(page);
  await layerRow(page, "Test catalog (imported)").locator(".nav-name").click();
  await page.locator(".editor-search").fill("Test Gem");
  await page
    .locator(".editor-row", {
      has: page.getByText("Test Gem", { exact: true }),
    })
    .click();

  await page
    .getByTestId("unlabeled-tags")
    .getByTestId("label-tag-link")
    .getByText(GEM_TAG, { exact: true })
    .click();
  await expect(page.getByTestId("tab-vocabulary")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByTestId("tag-label-input").fill(GEM_LABEL);
  await page.getByTestId("save-tag").click();

  await page.getByTestId("tab-items").click();
  await page.locator(".editor-search").fill("Test Gem");
  await page
    .locator(".editor-row", {
      has: page.getByText("Test Gem", { exact: true }),
    })
    .click();
  // The chip leads with the label and keeps the tag itself in view beside it.
  const chip = page
    .getByTestId("item-tags-input")
    .getByTestId("token-chip")
    .filter({ hasText: GEM_LABEL });
  await expect(chip.getByTestId("token-chip-value")).toHaveText(GEM_TAG);
  await expect(page.getByTestId("unlabeled-tags")).toHaveCount(0);
});
