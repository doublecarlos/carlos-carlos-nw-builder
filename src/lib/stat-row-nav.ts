// The other half of stat-row keyboard nav (see ComboBox.vue's `focusStatValue`): Tab/Enter on a
// stat's *value* field jumps to the next stat row's key picker. Plain Tab would land on that
// row's add/remove icon buttons first -- they sit before the combo box in the DOM -- and Enter
// has no native "next field" behaviour to begin with, so both are handled the same way here.
// Shared because the same `.stat-row` markup is built in four places (item-form.js's own stats,
// and bonus-rows.js's flat/tier/variant stats) with no component in common at the value-input
// level -- a plain `<input>` in three of the four, `PercentInput` in all four depending on the
// stat's kind.

export function focusNextCombo(event: KeyboardEvent) {
  if (event.key !== "Tab" && event.key !== "Enter") return;
  if (event.key === "Tab" && event.shiftKey) return;
  const target = event.target as HTMLElement;
  const row = target.closest(".stat-row");
  const next = row?.nextElementSibling;
  const combo = next?.classList?.contains("stat-row")
    ? next.querySelector<HTMLInputElement>(".combo--stat input")
    : null;
  if (!combo) return;
  event.preventDefault();
  combo.focus();
}
