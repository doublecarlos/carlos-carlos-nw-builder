# src/components/ui

Universal chrome, not aware of the game domain (see AGENTS.md's Code layout). Reach for one of
these before hand-rolling markup for a control; each file's own header comment has the full
reasoning. `game/OcrTextField.vue`-style specialised controls still belong here too, not in
`game/` - "own primitive per concept" applies to a genuinely novel control as much as an
ordinary one.

| Component                                 | Owns                                                                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| BaseBadge                                 | Status/count chip (added/edited/removed/unsaved) on a row or list                                                       |
| BaseButton                                | The shared button look; `as="label"` for button chrome on a native `<label>`                                            |
| BaseCard / BaseCardHeader / BaseCardBody  | Popover/hover-card shell: frame, sticky header, scrolling body                                                          |
| BaseCheckbox                              | A checkbox and its label as one clickable unit, `v-model` only                                                          |
| BaseDrawer                                | An in-flow panel worked alongside its surroundings; use BaseModal for open-use-leave                                    |
| BaseInput                                 | The ordinary text/number/search field                                                                                   |
| BaseLink                                  | An action link inline in running text, on the text baseline; `plain` writes it as text                                  |
| BaseMenu / BaseMenuItem                   | Click-triggered menu shell: placement, click-outside, Escape, roving keyboard focus                                     |
| BaseModal                                 | The one modal overlay; fills the screen below md, or stays a card with `phone="card"`; Back closes it on touch layouts  |
| BaseNotice                                | Dismissible inline message                                                                                              |
| BasePanel                                 | Side-panel shell                                                                                                        |
| BasePopover                               | Teleported overlay shell for tooltips, hover cards, click-triggered popovers                                            |
| BaseSheet                                 | Off-canvas side drawer or bottom sheet (kept above the keyboard): backdrop, focus trap, Back closes it on touch layouts |
| BaseTextarea                              | The ordinary multi-line text field                                                                                      |
| BaseTooltip                               | Mouse-hover/keyboard-focus tooltip, never on tap; `tappable` for an info-only trigger                                   |
| ClearableInput                            | A text filter field with an in-field clear button, wrapping BaseInput                                                   |
| CheckMenu                                 | Menu of checkbox options that stays open as they are toggled; built on BaseMenu                                         |
| CodeBlock                                 | Read-only, resizable JSON preview                                                                                       |
| CodeSnippet                               | Simple code snippet component                                                                                           |
| ComboBox / ComboBoxMenu / ComboBoxMenuRow | Typeable single-select over a small fixed option list, replacing `<select>`                                             |
| ComboBoxScreen                            | ComboBox's full-screen phone presentation (`phoneScreen`), sized to the visual viewport                                 |
| CompareLine                               | A compare build's value stacked under this build's own, inside one table cell                                           |
| CreatableComboBox                         | Single-value combobox: pick a known option, or type one that doesn't exist yet                                          |
| DescriptionText                           | Authored description paragraphs                                                                                         |
| DraftFormBar                              | Shared header bar (title, status badges, Save/Revert/Duplicate/Delete) for an editor form                               |
| DragHandle                                | The grip on a draggable row, `touch-none`; the only place a finger can start a drag                                     |
| DropIndicator                             | The drag-and-drop insertion line for one `useDropList`                                                                  |
| FilterChip                                | An active filter set from elsewhere, as a chip with its own clear button                                                |
| FormulaInput                              | A one-line expression field marking each problem's range under it; `#leading` adornment                                 |
| FormBar                                   | Sticky action bar at the top of an editing form                                                                         |
| FormField                                 | Label-above-control stack; `<label for>` names the first ui control, `hint` describes it                                |
| FormGrid                                  | A wrapping row of FormFields at their own widths, one full-width field per line when narrow                             |
| FormSection                               | Section heading inside an editing form                                                                                  |
| FormSectionDescription                    | Section description inside an editing form                                                                              |
| HistoryButtons                            | The undo/redo icon pair for one history; tooltips name the step each would apply                                        |
| IconButton                                | Icon-only button; `title` is its tooltip and, unless `label` is given, its accessible name                              |
| IdField                                   | Read-only display of a frozen, generator-assigned id                                                                    |
| InputRow                                  | A typed control in a fixed leading column, its description after it (above it on a phone)                               |
| ListAddRow                                | The add row after a list of cards: "+", other ways of adding, and the empty note                                        |
| ListCardHeader                            | A reorderable card's header: grip, fold, "Noun N", actions; wraps in whole groups                                       |
| LinkList                                  | A comma-separated run of BaseLinks inside a sentence, some entries optionally plain text                                |
| NumberStepper                             | A number field between -/+ buttons stepping by `step`; Ctrl/Cmd+click jumps to a bound                                  |
| NumberOrPercentInput                      | A number field, or a PercentInput when `percent` is set                                                                 |
| OcrHint                                   | Marks a field that reads pasted screenshots                                                                             |
| OcrStatus                                 | The busy and failure overlays under a field that reads pasted screenshots                                               |
| OcrTextField                              | A description field that also OCRs a pasted screenshot into it                                                          |
| PaletteInput                              | GoToPalette's own combobox-trigger search field                                                                         |
| PanelHead                                 | A panel's own internal section heading (not BasePanel's header slot)                                                    |
| PercentInput                              | A percent field over a decimal-stored value (`0.09` stored, `9` typed)                                                  |
| PresetButtons                             | A row of one-click values next to a number field, the current one highlighted                                           |
| RailGutter / RailToggle                   | A side rail's show/hide-and-resize edge, and the button that collapses/restores it                                      |
| RepeatableRows                            | A list whose rows share one Add/Remove pair, with an empty state that still offers Add                                  |
| SegmentedControl                          | "Pick exactly one of a few options"; stacks its options when one row does not fit                                       |
| TabButton / TabStrip                      | A row of tabs, each drawn as its own button rather than joined to the panel below                                       |
| ThemeToggle                               | System -> Light -> Dark cycle button                                                                                    |
| TokenInput                                | Token/chip input with autocomplete and optional free text; `fromImage` reads a pasted screenshot into a token           |

`BaseInput`/`BaseTextarea` do not fit a genuinely novel control - `OcrTextField` and
`PercentInput` are the standing proof that a specialised input is still legitimate. The rule
enforced by lint (`vue/no-restricted-syntax` in `eslint.config.js`) is "do not hand-roll the
ordinary text-entry case outside this directory", not "never write an `<input>`" - a
checkbox/radio/file input is a different control and is unaffected by that rule.

Adding a primitive here: give it a header comment naming the concept and real call sites
(the existing convention every file above follows), and add its row to this table.

## Sizing to the container

Wide, the form primitives keep the desktop layout their callers size: a field's `w-*` or
`flex-1` means what it says. Narrow, they stack instead of wrapping unevenly:

- FormGrid is a wrapping flow inside an `@container` element; below `@md` of its own width
  it stacks one field per line, overriding the callers' widths on the fields and their
  controls. Give it a definite width (a block, or a growing flex item): a size container never
  grows to fit its content, so as a content-sized flex item it collapses.
- InputRow puts its description first and the control under it on a phone (`max-md:`), and
  its `#presets` on a line of their own below that.
- RepeatableRows turns a row with a `#lead` into a card on a phone; from `md` up the
  caller's `rowClass` lays the row out as before.
- SegmentedControl measures instead: a breakpoint cannot know how long its labels are. It
  compares the one-row width of its labels with its own width (`src/lib/segmented-fit.ts`).
- FormField provides the label association (`src/composables/useFormField.ts`). A new text
  control in this directory calls `useFormFieldControl` for its input id and its
  `aria-describedby` (the field's `hint`); a control that a `<label for>` cannot name reads
  `useFormFieldLabelId` for `aria-labelledby` instead.

Outside this directory, lint rejects `flex-wrap` on an element holding form controls: such a
row wraps unevenly on a phone. Use the primitives above, keep the wrap to `md:flex-wrap` when
the row has its own phone layout, or mark a genuine flow of independent items (checkboxes,
chips, toolbar buttons) with `flow-wrap` from `src/base.css`.
