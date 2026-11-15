// Bonus inputs as the engine reads them: a bonus's own definitions, plus its references to
// shared inputs resolved against the flagged `build_parameter` slots that define them.
import { bonusInputAddress } from "../lib/build-inputs";
import type {
  Authored,
  AuthoredSlot,
  Bonus,
  BuildParameterSlot,
  SharedInputRef,
  InputAddress,
  InputDecl,
  InputDef,
  Slot,
} from "../types";

export type SharedInputs = ReadonlyMap<string, BuildParameterSlot>;

/** Shared inputs as authored, their labels not yet filled by `Db`: what the catalog check
 *  reads. Resolved ones fit wherever these do. */
export type AuthoredSharedInputs = ReadonlyMap<
  string,
  Authored<BuildParameterSlot>
>;

/** For an evaluation context built without a catalog, where no reference can resolve. */
export const NO_SHARED_INPUTS: SharedInputs = new Map();

/** Whether `decl` references a shared input rather than defining its own value. */
export const isSharedRef = (decl: InputDecl): decl is SharedInputRef =>
  typeof decl === "object" && decl !== null && "shared" in decl;

/** Whether `slot` defines a shared input. */
export const isSharedInputSlot = (
  slot: Pick<Slot, "type"> & { sharedInput?: boolean },
): boolean => slot.type === "build_parameter" && slot.sharedInput === true;

/** Whether `slot` is flagged shared, a shared input param or a shared picker: its control
 *  shows on the rows of the bonuses reading it, and in the Shared inputs section while the
 *  build uses it. */
export const isSharedSlot = (
  slot: Pick<Slot, "type"> & { sharedInput?: boolean },
): boolean =>
  (slot.type === "build_parameter" || slot.type === "item_picker") &&
  slot.sharedInput === true;

/** Every shared input slot in `slots`, by id. */
export function sharedInputsOf(slots: readonly Slot[]): SharedInputs;
export function sharedInputsOf(
  slots: readonly AuthoredSlot[],
): AuthoredSharedInputs;
export function sharedInputsOf(
  slots: readonly AuthoredSlot[],
): AuthoredSharedInputs {
  return new Map(
    slots.flatMap((slot) =>
      slot.type === "build_parameter" && slot.sharedInput
        ? [[slot.id, slot] as const]
        : [],
    ),
  );
}

/** A shared input slot's definition in a bonus input's shape. */
export function sharedInputDef(slot: Authored<BuildParameterSlot>): InputDef {
  if (slot.paramType === "boolean")
    return {
      type: "boolean",
      default: Boolean(slot.default),
      label: slot.label,
    };
  const def: InputDef = {
    type: slot.paramType === "percent" ? "percent" : "number",
    default: Number(slot.default ?? 0),
    label: slot.label,
  };
  if (slot.min !== undefined) def.min = slot.min;
  if (slot.max !== undefined) def.max = slot.max;
  if (slot.step !== undefined) def.step = slot.step;
  if (slot.presets) def.presets = slot.presets;
  if (slot.control) def.control = slot.control;
  if (slot.valueLabels) def.valueLabels = slot.valueLabels;
  return def;
}

/** One bonus input as read: its definition and where its value is stored. `shared` is the
 *  referenced slot's id. */
export interface DeclaredInput {
  name: string;
  def: InputDef;
  address: InputAddress;
  shared?: string;
}

const declaredCache = new WeakMap<
  AuthoredSharedInputs,
  WeakMap<object, DeclaredInput[]>
>();

/** Every input `bonus` declares, in declaration order. A reference that resolves to no shared
 *  input is left out, as the catalog check reports it. */
export function declaredInputs(
  bonus: Pick<Bonus, "id" | "inputs">,
  sharedInputs: AuthoredSharedInputs,
): DeclaredInput[] {
  const inputs = bonus.inputs;
  if (!inputs) return [];
  let byInputs = declaredCache.get(sharedInputs);
  if (!byInputs) declaredCache.set(sharedInputs, (byInputs = new WeakMap()));
  const cached = byInputs.get(bonus);
  if (cached) return cached;
  const out = Object.entries(inputs).flatMap(
    ([name, decl]): DeclaredInput[] => {
      if (!isSharedRef(decl))
        return [
          { name, def: decl, address: bonusInputAddress(bonus.id, name) },
        ];
      const slot = sharedInputs.get(decl.shared);
      if (!slot) return [];
      return [
        {
          name,
          def: sharedInputDef(slot),
          address: { store: "context", path: slot.path },
          shared: slot.id,
        },
      ];
    },
  );
  byInputs.set(bonus, out);
  return out;
}

/** `bonus`'s inputs by name with references resolved, what formula checks read. */
export function inputDefs(
  bonus: Pick<Bonus, "id" | "inputs">,
  sharedInputs: AuthoredSharedInputs,
): Record<string, InputDef> {
  return Object.fromEntries(
    declaredInputs(bonus, sharedInputs).map((entry) => [entry.name, entry.def]),
  );
}

/** `T` with its input references resolved. */
export type WithInputDefs<T> = Omit<T, "inputs"> & {
  inputs: Record<string, InputDef>;
};

/** `owner` with its input references resolved. */
export function withInputDefs<T extends Pick<Bonus, "id" | "inputs">>(
  owner: T,
  sharedInputs: AuthoredSharedInputs,
): WithInputDefs<T> {
  return { ...owner, inputs: inputDefs(owner, sharedInputs) };
}

/** The inputs `bonus` defines itself, stored under its own `bonusValues`. */
export function privateInputs(
  bonus: Pick<Bonus, "inputs">,
): [string, InputDef][] {
  return Object.entries(bonus.inputs ?? {}).flatMap(([name, decl]) =>
    isSharedRef(decl) ? [] : [[name, decl] as [string, InputDef]],
  );
}
