// The two words a boolean reads as, wherever the app shows its state. Kept out of lib/format,
// which loads the stat schema, so the engine's condition labels can use the same words.
export const booleanLabel = (value: boolean): "enabled" | "disabled" =>
  value ? "enabled" : "disabled";

export interface BooleanOption {
  value: "true" | "false";
  label: "enabled" | "disabled";
}

/** Any picker offering a boolean, enabled first. */
export const booleanOptions = (): BooleanOption[] => [
  { value: "true", label: booleanLabel(true) },
  { value: "false", label: booleanLabel(false) },
];

/** The pair as one label, for a type name that describes both states. */
export const BOOLEAN_PAIR = `${booleanLabel(true)}/${booleanLabel(false)}`;
