// The three ways an item can count one attached bonus, as the item editor presents them, and
// how each one reads and writes an `OccurrenceDraft`. Vue-free so BonusOccurrenceSection.vue
// owns only markup and wiring, the same split item-draft.ts makes for ItemForm.
//
// A mode is a view over the draft rather than a field of it: `BonusOccurrenceConfig` stores
// nothing but bounds, so a `min === max` config reads as Fixed, a 0..1 range as Toggle and
// anything else as Range. A plain-id attachment (no draft at all) is Fixed ×1.
import type { OccurrenceDraft } from "./item-draft";

export type OccurrenceMode = "fixed" | "toggle" | "range";

/** The draft a plain-id attachment stands for: always one occurrence, no player input. */
export const PLAIN_OCCURRENCE: OccurrenceDraft = {
  min: 1,
  max: 1,
  default: 1,
  label: "",
};

/** A draft's numeric field as a number, or null while the input is cleared. */
export function occurrenceNumber(value: number | string | null): number | null {
  if (value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** The count a Fixed-mode draft carries; a plain attachment counts as 1. */
export function fixedCountOf(draft: OccurrenceDraft | null): number | null {
  return draft ? occurrenceNumber(draft.min) : 1;
}

/** True once the draft says nothing a plain-id attachment would not: Fixed ×1 with no label.
 *  Every write below collapses such a draft back to `null`, and `toItem` does the same on
 *  save, so the item's JSON keeps the bare id for the ordinary case. */
export function isPlainOccurrence(draft: OccurrenceDraft | null): boolean {
  return (
    draft !== null &&
    occurrenceNumber(draft.min) === 1 &&
    occurrenceNumber(draft.max) === 1 &&
    occurrenceNumber(draft.default) === 1 &&
    draft.label.trim() === ""
  );
}

function normalize(draft: OccurrenceDraft): OccurrenceDraft | null {
  return isPlainOccurrence(draft) ? null : draft;
}

/** Fixed takes no player input, so there is no control for a label to caption: entering the
 *  mode drops any label, and Fixed ×1 is then always the plain attachment. */
function withFixedCount(count: number | string | null): OccurrenceDraft | null {
  return normalize({ min: count, max: count, default: count, label: "" });
}

/** One numeric field a mode shows, with its own read/write over the draft: Fixed's Count is
 *  not a draft field but writes all three bounds at once, while Range's fields map one to one. */
export interface OccurrenceNumberField {
  key: "count" | "min" | "max" | "default";
  label: string;
  read(draft: OccurrenceDraft | null): number | string | null;
  write(
    draft: OccurrenceDraft | null,
    value: number | string | null,
  ): OccurrenceDraft | null;
}

function rangeField(
  key: "min" | "max" | "default",
  label: string,
): OccurrenceNumberField {
  return {
    key,
    label,
    read: (draft) => (draft ?? PLAIN_OCCURRENCE)[key],
    write: (draft, value) =>
      normalize({ ...(draft ?? PLAIN_OCCURRENCE), [key]: value }),
  };
}

export interface OccurrenceModeSpec {
  value: OccurrenceMode;
  label: string;
  /** Whether a draft can be shown in this mode without losing anything it says. Fixed also
   *  accepts a null draft (a plain attachment) and Range accepts every draft, so the mode
   *  picked for a draft is the first accepting one in `OCCURRENCE_MODES` order. */
  fits(draft: OccurrenceDraft | null): boolean;
  /** The draft to hold after switching into this mode: keeps what the mode can still show
   *  (the bounds it has fields for, the label where there is a control to caption) and never
   *  changes what the attachment means until the user edits a field. */
  enter(draft: OccurrenceDraft | null): OccurrenceDraft | null;
  numberFields: OccurrenceNumberField[];
  /** Whether the mode shows the "On by default" checkbox (Toggle only). */
  hasDefaultToggle: boolean;
  /** Whether the mode shows the Label field; Fixed takes no player input, so it has nothing
   *  to caption. */
  hasLabel: boolean;
  summary(draft: OccurrenceDraft | null): string;
}

export const OCCURRENCE_MODES: OccurrenceModeSpec[] = [
  {
    value: "fixed",
    label: "Fixed",
    fits: (draft) =>
      draft === null ||
      occurrenceNumber(draft.min) === occurrenceNumber(draft.max),
    enter: (draft) =>
      withFixedCount(
        draft
          ? (occurrenceNumber(draft.default) ?? occurrenceNumber(draft.min))
          : 1,
      ),
    numberFields: [
      {
        key: "count",
        label: "Count",
        read: fixedCountOf,
        write: (_draft, count) => withFixedCount(count),
      },
    ],
    hasDefaultToggle: false,
    hasLabel: false,
    summary: (draft) => `×${fixedCountOf(draft) ?? 0}`,
  },
  {
    value: "toggle",
    label: "Toggle",
    fits: (draft) =>
      draft !== null &&
      occurrenceNumber(draft.min) === 0 &&
      occurrenceNumber(draft.max) === 1,
    enter: (draft) => ({
      min: 0,
      max: 1,
      default:
        (occurrenceNumber((draft ?? PLAIN_OCCURRENCE).default) ?? 0) >= 1
          ? 1
          : 0,
      label: draft?.label ?? "",
    }),
    numberFields: [],
    hasDefaultToggle: true,
    hasLabel: true,
    summary: () => "toggle",
  },
  {
    value: "range",
    label: "Range",
    fits: () => true,
    enter: (draft) => ({ ...(draft ?? PLAIN_OCCURRENCE) }),
    numberFields: [
      rangeField("min", "Min"),
      rangeField("max", "Max"),
      rangeField("default", "Default"),
    ],
    hasDefaultToggle: false,
    hasLabel: true,
    summary: (draft) => {
      const range = draft ?? PLAIN_OCCURRENCE;
      return `${occurrenceNumber(range.min) ?? 0}–${occurrenceNumber(range.max) ?? 0}`;
    },
  },
];

export function occurrenceModeSpec(mode: OccurrenceMode): OccurrenceModeSpec {
  return OCCURRENCE_MODES.find((spec) => spec.value === mode)!;
}

/** The mode a draft reads as: the first one in `OCCURRENCE_MODES` order that fits it. */
export function occurrenceModeOf(
  draft: OccurrenceDraft | null,
): OccurrenceMode {
  return OCCURRENCE_MODES.find((spec) => spec.fits(draft))!.value;
}

/** The draft to hold after switching to `mode`; see `OccurrenceModeSpec.enter`. */
export function occurrenceDraftForMode(
  draft: OccurrenceDraft | null,
  mode: OccurrenceMode,
): OccurrenceDraft | null {
  return occurrenceModeSpec(mode).enter(draft);
}

/** Whether the toggle is on by default; only meaningful for a Toggle-mode draft. */
export function occurrenceDefaultOn(draft: OccurrenceDraft | null): boolean {
  return (occurrenceNumber((draft ?? PLAIN_OCCURRENCE).default) ?? 0) >= 1;
}

export function withOccurrenceDefaultOn(
  draft: OccurrenceDraft | null,
  on: boolean,
): OccurrenceDraft | null {
  return normalize({ ...(draft ?? PLAIN_OCCURRENCE), default: on ? 1 : 0 });
}

export function withOccurrenceLabel(
  draft: OccurrenceDraft | null,
  label: string,
): OccurrenceDraft | null {
  return normalize({ ...(draft ?? PLAIN_OCCURRENCE), label });
}

/** The compact chip text an attachment shows while its card is collapsed: "×1" for a plain
 *  attachment, "×N" for a fixed count, "toggle" for a 0..1 range, "min–max" otherwise. */
export function occurrenceSummary(draft: OccurrenceDraft | null): string {
  return occurrenceModeSpec(occurrenceModeOf(draft)).summary(draft);
}
