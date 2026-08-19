// The ICO container in public/favicon.ico is assembled by hand in scripts/generate-icons.ts --
// offsets and lengths written into a binary header have no compiler to catch a mistake, and a
// malformed icon fails silently in a browser (it simply falls back to a blank page icon). These
// assertions re-parse the committed file the way a decoder would.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PNG_SIGNATURE = "89504e470d0a1a0a";

const ico = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "public",
    "favicon.ico",
  ),
);

/** ICONDIR is 6 bytes, then one 16-byte ICONDIRENTRY per image. */
const count = ico.readUInt16LE(4);
const entries = Array.from({ length: count }, (_, i) => {
  const base = 6 + i * 16;
  return {
    // A width byte of 0 means 256; nothing here is that big, but decoders read it that way.
    width: ico.readUInt8(base) || 256,
    height: ico.readUInt8(base + 1) || 256,
    bytes: ico.readUInt32LE(base + 8),
    offset: ico.readUInt32LE(base + 12),
  };
});

describe("public/favicon.ico", () => {
  it("declares itself an icon, not a cursor", () => {
    expect(ico.readUInt16LE(0)).toBe(0); // reserved
    expect(ico.readUInt16LE(2)).toBe(1); // 1 = icon, 2 = cursor
  });

  it("packs the tab and shell sizes", () => {
    expect(entries.map((e) => e.width)).toEqual([16, 32, 48]);
    expect(entries.every((e) => e.width === e.height)).toBe(true);
  });

  it("points every entry at a PNG payload inside the file", () => {
    for (const entry of entries) {
      expect(entry.offset + entry.bytes).toBeLessThanOrEqual(ico.length);
      expect(ico.subarray(entry.offset, entry.offset + 8).toString("hex")).toBe(
        PNG_SIGNATURE,
      );
    }
  });

  it("leaves no gap or overlap between payloads", () => {
    let expected = 6 + count * 16;
    for (const entry of entries) {
      expect(entry.offset).toBe(expected);
      expected += entry.bytes;
    }
    expect(expected).toBe(ico.length);
  });
});
