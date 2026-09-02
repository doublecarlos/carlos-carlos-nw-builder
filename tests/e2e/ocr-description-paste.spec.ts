// Screenshot straight into a description field: paste a cropped capture and OCR's reading of
// it lands in the field, ready to correct.
//
// The fixture is a whole tooltip rather than a cropped description, because what this spec is
// about is the wiring -- that a pasted image reaches the engine and its text reaches the
// field. Cropping is the user's job, and the assertions only ask for a line the transcription
// is reliably right about.
import { test, expect, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { openBuilder } from "./support/app";
import { addLayer, layerRow } from "./support/nav";

const TOOLTIP = fileURLToPath(
  new URL("./fixtures/m32-omen-of-doom-celestial.png", import.meta.url),
);

/** A new item draft with its description fields showing. */
async function openDescriptionFields(page: Page) {
  await openBuilder(page);
  await addLayer(page);
  await layerRow(page, "Layer 1").locator(".nav-name").click();
  await page.getByTestId("new-item").click();
  await page.getByTestId("add-item-description").click();
  await expect(page.getByTestId("item-description-fields")).toBeVisible();
}

/** Pastes an image file onto a field, the way a screenshot lands from the clipboard. */
async function pasteImage(field: Locator, path: string) {
  const data = readFileSync(path).toString("base64");
  await field.evaluate(async (el, base64) => {
    const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], "tooltip.png", { type: "image/png" }));
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, data);
}

/** Pastes a blank capture: recognition succeeds and finds nothing, which is the case that
 *  leaves a message on screen with nothing in the form to dismiss it. */
async function pasteBlankImage(field: Locator) {
  await field.evaluate(
    (el) =>
      new Promise<void>((resolve) => {
        const canvas = document.createElement("canvas");
        canvas.width = 120;
        canvas.height = 60;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          const transfer = new DataTransfer();
          transfer.items.add(
            new File([blob!], "blank.png", { type: "image/png" }),
          );
          el.dispatchEvent(
            new ClipboardEvent("paste", {
              clipboardData: transfer,
              bubbles: true,
              cancelable: true,
            }),
          );
          resolve();
        }, "image/png");
      }),
  );
}

test.describe("reading a description off a screenshot", () => {
  // Serial on purpose: each OCR run loads its own ~4MB WASM core and ~3MB language model and
  // then saturates a core recognising. Run in parallel against the suite's other workers they
  // starve each other badly enough to look like a hang.
  test.describe.configure({ mode: "serial" });
  // The first run still pays for fetching the core and model.
  test.slow();

  test("a pasted screenshot fills the long description", async ({ page }) => {
    await openDescriptionFields(page);
    const fields = page.getByTestId("item-description-fields");
    const field = page.getByTestId("item-long-description-input");
    await field.click();
    const heightBefore = (await fields.boundingBox())?.height;

    await pasteImage(field, TOOLTIP);
    await expect(page.getByTestId("ocr-field-busy")).toBeVisible();
    // Progress is drawn over what follows the field rather than in the flow: reporting it must
    // not move the form out from under an edit in progress.
    expect((await fields.boundingBox())?.height).toBe(heightBefore);

    await expect(field).toHaveValue(/Omen of Doom/i, { timeout: 120_000 });
    await expect(page.getByTestId("ocr-field-busy")).toBeHidden();
    await expect(field).toHaveValue(/\n/);
  });

  test("an image with no text says so, and the message can be dismissed", async ({
    page,
  }) => {
    await openDescriptionFields(page);
    const field = page.getByTestId("item-long-description-input");
    const message = page.getByTestId("ocr-field-error");
    await field.click();

    await pasteBlankImage(field);
    await expect(message).toContainText(/no text/i, { timeout: 120_000 });

    // Clicking away is the intuitive dismissal, and has to beat the message's own timer by
    // enough that this is not just the timer firing.
    await page.getByTestId("item-name-input").click();
    await expect(message).toBeHidden({ timeout: 2000 });

    // Left alone, it still withdraws by itself.
    await field.click();
    await pasteBlankImage(field);
    await expect(message).toContainText(/no text/i, { timeout: 120_000 });
    await expect(message).toBeHidden({ timeout: 15_000 });
  });

  test("the short description takes the same text on one line", async ({
    page,
  }) => {
    await openDescriptionFields(page);
    const field = page.getByTestId("item-short-description-input");
    await field.click();

    await pasteImage(field, TOOLTIP);
    await expect(field).toHaveValue(/Omen of Doom/i, { timeout: 120_000 });
    await expect(field).not.toHaveValue(/\n/);
  });
});

test("a text paste is left to the browser", async ({ page }) => {
  await openDescriptionFields(page);
  const field = page.getByTestId("item-long-description-input");
  await field.fill("typed by hand");

  // `dispatchEvent` reports false only if something called preventDefault, which is how the
  // field claims a paste for OCR -- a text paste has to stay an ordinary paste.
  const delivered = await field.evaluate((el) => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", " and pasted");
    return el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }),
    );
  });

  expect(delivered).toBe(true);
  await expect(page.getByTestId("ocr-field-busy")).toBeHidden();
  await expect(field).toHaveValue("typed by hand");
});

test("every field that reads screenshots says so, and only those", async ({
  page,
}) => {
  await openDescriptionFields(page);
  // The marker sits on the control, so the count is exactly the two description fields --
  // the grant name beside them in BonusRows.vue takes no screenshot and carries none.
  const hints = page.getByTestId("ocr-hint");
  await expect(hints).toHaveCount(2);

  await hints.first().hover();
  await expect(page.getByTestId("tooltip")).toContainText(
    /paste a screenshot/i,
  );
});

test("both description fields are the same control at the same height", async ({
  page,
}) => {
  await openDescriptionFields(page);
  const short = await page
    .getByTestId("item-short-description-input")
    .boundingBox();
  const long = await page
    .getByTestId("item-long-description-input")
    .boundingBox();
  expect(short?.height).toBe(long?.height);
});
