// Derives every icon in public/ from public/icon-512.png, the one hand-authored source.
//
// No image library is installed, and none is wanted for a job this small -- the resizing runs
// in the Chromium that Playwright already ships for the e2e suite, through a plain <canvas>.
// The .ico container is assembled here by hand (see `buildIco`), since it is 6 bytes of header
// plus a 16-byte directory entry per size wrapped around PNGs Chromium already produced.
//
// Run via `npm run icons`. The outputs are committed, so this only needs re-running when
// icon-512.png itself changes.
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const publicDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "public",
);

/** Sizes packed into favicon.ico: 16 and 32 for tabs, 48 for Windows' own shell. */
const ICO_SIZES = [16, 32, 48];

interface IconSpec {
  file: string;
  size: number;
  /** Painted under the glyph. Transparent (undefined) everywhere iOS isn't involved. */
  background?: string;
  /** Fraction of the canvas left empty on each edge, for icons that get masked. */
  padding?: number;
}

const ICONS: IconSpec[] = [
  { file: "favicon-32.png", size: 32 },
  { file: "icon-192.png", size: 192 },
  // iOS composites transparency onto black and rounds the corners itself, so this one gets an
  // opaque ground and keeps the glyph clear of the corners it will crop.
  {
    file: "apple-touch-icon.png",
    size: 180,
    background: "#ffffff",
    padding: 0.1,
  },
];

/**
 * The resizer, as source the page parses itself rather than a callback handed to
 * `page.evaluate`. tsx compiles this file with esbuild's `keepNames`, which rewrites function
 * declarations into `__name(...)` calls -- harmless in Node, but a serialized callback carries
 * those calls into a page that has no such helper and throws. Living here, this code reaches
 * Chromium exactly as written.
 *
 * Downscaling halves repeatedly instead of drawing 512 -> 16 in one step: a single step that
 * steep samples too few source pixels and visibly aliases the glyph's curves, while halving
 * keeps every pixel contributing.
 */
const RENDER_SCRIPT = `
  window.renderIcon = async (size, background, padding) => {
    const image = new Image();
    image.src = window.SOURCE;
    await image.decode();

    const draw = (width, from) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = width;
      const context = canvas.getContext("2d");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(from, 0, 0, width, width);
      return canvas;
    };

    const box = Math.round(size * (1 - padding * 2));

    let step = image;
    let width = image.naturalWidth;
    while (Math.floor(width / 2) >= box) {
      width = Math.floor(width / 2);
      step = draw(width, step);
    }
    const glyph = draw(box, step);

    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (background) {
      context.fillStyle = background;
      context.fillRect(0, 0, size, size);
    }
    const offset = Math.round((size - box) / 2);
    context.drawImage(glyph, offset, offset);

    return canvas.toDataURL("image/png");
  };
`;

/**
 * Wraps already-encoded PNGs in an ICO container: a 6-byte ICONDIR, then one 16-byte
 * ICONDIRENTRY per image, then the images themselves. PNG payloads (rather than the older BMP
 * form) are what every current browser and Windows Vista onwards read.
 */
function buildIco(images: { size: number; png: Buffer }[]): Buffer {
  const HEADER = 6;
  const ENTRY = 16;

  const header = Buffer.alloc(HEADER);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  let offset = HEADER + ENTRY * images.length;
  const entries = images.map(({ size, png }) => {
    const entry = Buffer.alloc(ENTRY);
    // 256 is stored as 0; every size here is smaller, but the wrap keeps that rule explicit.
    entry.writeUInt8(size % 256, 0);
    entry.writeUInt8(size % 256, 1);
    entry.writeUInt8(0, 2); // palette size: not paletted
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    return entry;
  });

  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)]);
}

const source = readFileSync(path.join(publicDir, "icon-512.png")).toString(
  "base64",
);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(
  `<!doctype html><meta charset="utf-8"><script>
     window.SOURCE = "data:image/png;base64,${source}";
     ${RENDER_SCRIPT}
   </script>`,
);

/** One rendered PNG, by size. `background`/`padding` default to "transparent, no inset". */
async function render(spec: Omit<IconSpec, "file">): Promise<Buffer> {
  const dataUrl = await page.evaluate<string>(
    `renderIcon(${spec.size}, ${JSON.stringify(spec.background ?? null)}, ${spec.padding ?? 0})`,
  );
  return Buffer.from(dataUrl.replace(/^data:image\/png;base64,/, ""), "base64");
}

for (const { file, ...spec } of ICONS) {
  writeFileSync(path.join(publicDir, file), await render(spec));
  console.log(`wrote public/${file}`);
}

const icoImages = [];
for (const size of ICO_SIZES) {
  icoImages.push({ size, png: await render({ size }) });
}
writeFileSync(path.join(publicDir, "favicon.ico"), buildIco(icoImages));
console.log(`wrote public/favicon.ico (${ICO_SIZES.join(", ")})`);

await browser.close();
