// The parts of "paste a screenshot into a field" that are not the recognition itself: picking
// the image off a clipboard or drop payload, and folding recognised text into the value being
// edited.
//
// Nothing here reaches `ocr.ts`, so the engine and its language model stay behind the dynamic
// import each caller does.

/** The first image on a paste or drop payload, if there is one. */
export function imageFrom(
  items: DataTransferItemList | null | undefined,
): File | null {
  for (const item of items ?? []) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}

/**
 * Tidies recognised text for the field it is going into.
 *
 * A one-line field takes the whole transcription on one line: OCR breaks a paragraph wherever
 * the tooltip wrapped it, and that break belongs to the screenshot's width rather than to the
 * description. Everywhere else the breaks are kept, since a tooltip that prints two paragraphs
 * meant them.
 */
export function tidyOcrText(text: string, singleLine: boolean): string {
  if (singleLine) return text.replace(/\s+/g, " ").trim();
  return text
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface TextInsertion {
  value: string;
  /** Where the caret belongs afterwards: the end of what was inserted. */
  caret: number;
}

/**
 * Splices `text` over `[start, end)`, the same thing an ordinary paste does to a selection.
 * The range is clamped because the field stays editable while recognition runs.
 */
export function insertText(
  value: string,
  start: number,
  end: number,
  text: string,
): TextInsertion {
  const from = Math.max(0, Math.min(start, value.length));
  const to = Math.max(from, Math.min(end, value.length));
  return {
    value: value.slice(0, from) + text + value.slice(to),
    caret: from + text.length,
  };
}
