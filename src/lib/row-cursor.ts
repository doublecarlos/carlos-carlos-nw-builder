/**
 * Blur an input back onto its row's cursor anchor when it lives in a keyboard-cursor row
 * (BuildSlot.vue), instead of leaving focus on `<body>`. Escape and Enter-to-choose in a
 * picker both blur the input, and with the native-focus cursor that used to drop the
 * row cursor entirely -- focusing the anchor keeps the row highlighted and arrow keys live,
 * the same way the old virtual cursor survived a picker blur.
 *
 * Falls back to a plain blur for inputs outside any cursor row (the compare picker, section
 * copy popover, layer editor's own ComboBoxes), so those keep their exact behavior.
 */
export function blurToRowAnchor(input: HTMLInputElement | null) {
  const anchor = input
    ?.closest("[data-cursor-key]")
    ?.querySelector<HTMLElement>("[data-cursor-anchor]");
  if (anchor) anchor.focus();
  else input?.blur();
}
