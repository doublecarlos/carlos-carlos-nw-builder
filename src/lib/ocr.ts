// Reads a tooltip screenshot into text, for `tooltip-parser.ts` to turn into an item draft.
//
// tesseract.js and its language model are behind the dynamic `import()` below, so neither
// reaches the main chunk -- nobody who does not open this feature pays for it.
//
// The two settings here are not defaults, and both came out of measuring engines against real
// tooltip captures:
//
//   - 3x upscale. Tooltip text is 11-13px tall in a native-resolution crop, which is where
//     every engine tested struggled. Upscaling is the only preprocessing that helped; keying
//     on colour and thresholding to black-on-white -- the obvious idea -- made accuracy
//     dramatically *worse*, because tooltips colour their text (magenta titles, cyan and green
//     stat names, dim grey secondary text) and any such key discards most of it.
//   - PSM 3. tesseract.js defaults to PSM 6, which scored materially worse on these layouts.
//
// Expect an omitted field rather than a wrong one: across the measured corpus this recovered
// ~94% of an item's catalog stat fields with no incorrect values.

import type { Worker } from "tesseract.js";

/** Match the assets the `tesseract-assets` plugin in vite.config.ts serves. Set explicitly so
 *  nothing is fetched from jsDelivr, which is where tesseract.js looks by default. */
const LANG_PATH = "/tessdata";
const CORE_PATH = "/tesseract";
const WORKER_PATH = "/tesseract/worker.min.js";

const SCALE = 3;

let workerPromise: Promise<Worker> | null = null;

/**
 * One worker, created on first use and kept: startup dominates per-image cost, and the model
 * is several megabytes we would rather fetch once.
 */
const getWorker = async (): Promise<Worker> => {
  workerPromise ??= (async () => {
    const { createWorker, PSM } = await import("tesseract.js");
    const worker = await createWorker("eng", undefined, {
      langPath: LANG_PATH,
      corePath: CORE_PATH,
      workerPath: WORKER_PATH,
      // The model ships gzipped; without this tesseract.js expects it raw.
      gzip: true,
    });
    await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
    return worker;
  })();
  return workerPromise;
};

/** Upscales onto a canvas. See the note above on why nothing else is done to the pixels. */
const upscale = (source: ImageBitmap): HTMLCanvasElement => {
  const canvas = document.createElement("canvas");
  canvas.width = source.width * SCALE;
  canvas.height = source.height * SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
};

export async function readTooltip(image: Blob): Promise<string> {
  const bitmap = await createImageBitmap(image);
  try {
    const worker = await getWorker();
    const { data } = await worker.recognize(upscale(bitmap));
    return data.text;
  } finally {
    bitmap.close();
  }
}

/** Releases the worker and its model. Safe to call when no worker was ever started. */
export async function disposeOcr(): Promise<void> {
  const pending = workerPromise;
  workerPromise = null;
  if (pending) await (await pending).terminate();
}
