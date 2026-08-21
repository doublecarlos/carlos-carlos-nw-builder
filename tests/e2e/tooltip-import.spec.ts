// Screenshot to reviewed item draft, end to end: OCR reads a real tooltip capture, the parser
// fills in the base stats, and "Create item" opens an ordinary new draft in ItemForm.
//
// The OCR assertions are deliberately about the numbers that matter (item level, the rating
// lines) rather than the whole transcription -- the engine omits fields rather than corrupting
// them, so a value that appears at all is expected to be right.
import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { openBuilder } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

const TOOLTIP = fileURLToPath(
  new URL("./fixtures/m32-omen-of-doom-celestial.png", import.meta.url),
);

async function openImportModal(page: import("@playwright/test").Page) {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByTestId("tooltip-import-toggle").click();
  await expect(page.getByTestId("tooltip-import")).toBeVisible();
}

test.describe("creating an item from a tooltip screenshot", () => {
  // Serial on purpose: each OCR run loads its own ~4MB WASM core and ~3MB language model and
  // then saturates a core recognising. Run in parallel against the suite's other workers they
  // starve each other badly enough to look like a hang.
  test.describe.configure({ mode: "serial" });
  // The first run still pays for fetching the core and model.
  test.slow();

  test("reads a screenshot and fills in the item's base stats", async ({
    page,
  }) => {
    await openImportModal(page);

    await page.getByTestId("tooltip-import-file").setInputFiles(TOOLTIP);

    const text = page.getByTestId("tooltip-import-text");
    await expect(text).not.toBeEmpty({ timeout: 120_000 });
    await expect(text).toHaveValue(/Omen of Doom/i);

    // The stat block this item is defined by.
    const stats = page.getByTestId("tooltip-import-stats");
    await expect(stats).toContainText("Item Level");
    await expect(stats).toContainText("5,250");
    await expect(stats).toContainText("Accuracy");
    await expect(stats).toContainText("3,412");
    await expect(stats).toContainText("Combined Rating");
    await expect(stats).toContainText("4,725");
  });

  test("creates a new item draft carrying the parsed values", async ({
    page,
  }) => {
    await openImportModal(page);
    await page.getByTestId("tooltip-import-file").setInputFiles(TOOLTIP);
    await expect(page.getByTestId("tooltip-import-text")).not.toBeEmpty({
      timeout: 120_000,
    });

    await page.getByTestId("tooltip-import-create").click();

    // The window closes and an ordinary new-item draft opens, pre-filled but unsaved.
    await expect(page.getByTestId("tooltip-import")).toBeHidden();
    await expect(page.getByTestId("item-name-input")).toHaveValue(
      /Omen of Doom/i,
    );
  });

  test("parses corrections typed into the recognised text", async ({
    page,
  }) => {
    await openImportModal(page);

    // No OCR involved: the text box is editable precisely so a missed line can be added.
    await page
      .getByTestId("tooltip-import-text")
      .fill("Hand Typed Ring\nItem Level: 1,234\n+999 Power");

    const stats = page.getByTestId("tooltip-import-stats");
    await expect(stats).toContainText("1,234");
    await expect(stats).toContainText("999");
  });

  test("carries the game id the tooltip prints into the new item draft", async ({
    page,
  }) => {
    await openImportModal(page);

    await page
      .getByTestId("tooltip-import-text")
      .fill(
        [
          "Hand Typed Hood",
          "Item Level: 5,700",
          "+999 Power",
          "Def: Head_M33_Lightdps_S-tier_Boe",
        ].join("\n"),
      );

    await expect(page.getByTestId("tooltip-import-game-id")).toContainText(
      "Head_M33_Lightdps_S-tier_Boe",
    );

    await page.getByTestId("tooltip-import-create").click();

    // The game id lands in the item's own field, ready to be saved with the rest.
    await expect(page.getByTestId("item-gameids-input")).toContainText(
      "Head_M33_Lightdps_S-tier_Boe",
    );
  });

  test("keeps Create disabled until something parses", async ({ page }) => {
    await openImportModal(page);
    await expect(page.getByTestId("tooltip-import-create")).toBeDisabled();

    await page
      .getByTestId("tooltip-import-text")
      .fill("Just some prose with no stat lines in it at all.");
    await expect(page.getByTestId("tooltip-import-create")).toBeDisabled();
  });
});

test("a pasted screenshot lands without clicking into the window first", async ({
  page,
}) => {
  await openImportModal(page);

  // Dispatched at the document, which is where the browser delivers Ctrl+V when nothing
  // inside the window has been clicked -- the case an in-flow panel drops entirely.
  await page.evaluate(() => {
    const PIXEL =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const bytes = Uint8Array.from(atob(PIXEL), (c) => c.charCodeAt(0));
    const data = new DataTransfer();
    data.items.add(new File([bytes], "tooltip.png", { type: "image/png" }));
    document.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true }),
    );
  });

  // Any of these is the paste having been received: it reads, then either finds no text in a
  // 1x1 pixel or fails to load the engine. Never getting this far is the defect.
  await expect(page.getByTestId("tooltip-import")).toContainText(
    /Reading the screenshot|No text was found|Could not read/,
  );
});
