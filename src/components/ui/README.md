# src/components/ui

Universal chrome, not aware of the game domain (see AGENTS.md's Code layout). Reach for one of
these before hand-rolling markup for a control; each file's own header comment has the full
reasoning. `game/OcrTextField.vue`-style specialised controls still belong here too, not in
`game/` - "own primitive per concept" applies to a genuinely novel control as much as an
ordinary one.

| Component                                 | Owns                                                                                      |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| BaseBadge                                 | Status/count chip (added/edited/removed/unsaved) on a row or list                         |
| BaseButton                                | The shared button look; `as="label"` for button chrome on a native `<label>`              |
| BaseCard / BaseCardHeader / BaseCardBody  | Popover/hover-card shell: frame, sticky header, scrolling body                            |
| BaseCheckbox                              | A checkbox and its label as one clickable unit, `v-model` only                            |
| BaseDrawer                                | An in-flow panel worked alongside its surroundings; use BaseModal for open-use-leave      |
| BaseInput                                 | The ordinary text/number/search field                                                     |
| BaseLink                                  | An action link inline in running text, on the text baseline; `plain` writes it as text    |
| BaseModal                                 | The app's one modal overlay: backdrop, focus trap, Escape, scroll lock                    |
| BaseNotice                                | Dismissible inline message                                                                |
| BasePanel                                 | Side-panel shell                                                                          |
| BasePopover                               | Teleported overlay shell for tooltips, hover cards, click-triggered popovers              |
| BaseTextarea                              | The ordinary multi-line text field                                                        |
| BaseTooltip                               | Themed hover/focus tooltip, replacing `title`                                             |
| ClearableInput                            | A text filter field with an in-field clear button, wrapping BaseInput                     |
| CheckMenu                                 | Menu of checkbox options that stays open as they are toggled                              |
| CodeBlock                                 | Read-only, resizable JSON preview                                                         |
| ComboBox / ComboBoxMenu / ComboBoxMenuRow | Typeable single-select over a small fixed option list, replacing `<select>`               |
| CompareLine                               | A compare build's value stacked under this build's own, inside one table cell             |
| CreatableComboBox                         | Single-value combobox: pick a known option, or type one that doesn't exist yet            |
| DraftFormBar                              | Shared header bar (title, status badges, Save/Revert/Duplicate/Delete) for an editor form |
| DragHandle                                | The grip affordance on a draggable row                                                    |
| FormBar                                   | Sticky action bar at the top of an editing form                                           |
| FormField                                 | Label-above-control stack, the basic form unit                                            |
| FormGrid                                  | Wrapping row of FormField instances                                                       |
| FormSection                               | Section heading inside an editing form                                                    |
| HistoryButton                             | Undo/redo button with an inline "what this step would do" label                           |
| IconButton                                | Icon-only button; `title` is both its accessible name and its tooltip                     |
| IdField                                   | Read-only display of a frozen, generator-assigned id                                      |
| LinkList                                  | A comma-separated run of BaseLinks inside a sentence, some entries optionally plain text  |
| OcrHint                                   | Marks a field that reads pasted screenshots                                               |
| OcrTextField                              | A description field that also OCRs a pasted screenshot into it                            |
| PaletteInput                              | GoToPalette's own combobox-trigger search field                                           |
| PanelHead                                 | A panel's own internal section heading (not BasePanel's header slot)                      |
| PercentInput                              | A percent field over a decimal-stored value (`0.09` stored, `9` typed)                    |
| RailGutter / RailToggle                   | A side rail's show/hide-and-resize edge, and the button that collapses/restores it        |
| RepeatableRows                            | A list whose rows share one Add/Remove pair, with an empty state that still offers Add    |
| SegmentedControl                          | "Pick exactly one of a few options", with a `tone` per option                             |
| TabButton / TabStrip                      | A row of tabs, each drawn as its own button rather than joined to the panel below         |
| ThemeToggle                               | System -> Light -> Dark cycle button                                                      |
| TokenInput                                | Token/chip input with autocomplete and optional free text                                 |

`BaseInput`/`BaseTextarea` do not fit a genuinely novel control - `OcrTextField` and
`PercentInput` are the standing proof that a specialised input is still legitimate. The rule
enforced by lint (`vue/no-restricted-syntax` in `eslint.config.js`) is "do not hand-roll the
ordinary text-entry case outside this directory", not "never write an `<input>`" - a
checkbox/radio/file input is a different control and is unaffected by that rule.

Adding a primitive here: give it a header comment naming the concept and real call sites
(the existing convention every file above follows), and add its row to this table.
