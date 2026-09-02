// Descriptions are plain text that breaks the way markdown breaks it: a single newline is a
// wrap rather than a break, and a blank line starts a new paragraph.
//
// The asymmetry is what the text is made of. A lone newline is usually not the author's --
// OCR puts one wherever the tooltip's own width happened to wrap, and joining those back up
// is the only way a transcription reads as the sentence it was. A blank line takes two
// deliberate presses, so it is always meant.

/**
 * Splits a description into its paragraphs, soft-wrapped lines rejoined. Empty when there is
 * nothing to show, so a caller can render straight from the result.
 */
export function descriptionParagraphs(text: string | undefined): string[] {
  return (text ?? "")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}
