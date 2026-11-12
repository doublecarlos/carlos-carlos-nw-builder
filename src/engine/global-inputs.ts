// Bonus inputs as the engine reads them: a bonus's own definitions, plus its references to
// global inputs resolved against the flagged `build_parameter` slots that define them.
import { bonusInputAddress } from "../lib/build-inputs";
import type {
  Bonus,
  BuildParameterSlot,
  GlobalInputRef,
  InputAddress,
  InputDecl,
  InputDef,
  Slot,
} from "../types";

export type GlobalInputs = ReadonlyMap<string, BuildParameterSlot>;

const NO_GLOBALS: GlobalInputs = new Map();

/** Whether `decl` references a global input rather than defining its own value. */
export const isGlobalRef = (decl: InputDecl): decl is GlobalInputRef =>
  typeof decl === "object" && decl !== null && "global" in decl;

/** Whether `slot` defines a global input. */
export const isGlobalInputSlot = (
  slot: Pick<Slot, "type"> & { globalInput?: boolean },
): boolean => slot.type === "build_parameter" && slot.globalInput === true;

/** Every global input slot in `slots`, by id. */
export function globalInputsOf(slots: readonly Slot[]): GlobalInputs {
  return new Map(
    slots.flatMap((slot) =>
      slot.type === "build_parameter" && slot.globalInput
        ? [[slot.id, slot] as const]
        : [],
    ),
  );
}

/** A global input slot's definition in a bonus input's shape. */
export function globalInputDef(slot: BuildParameterSlot): InputDef {
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
  return def;
}

/** One bonus input as read: its definition and where its value is stored. `global` is the
 *  referenced slot's id. */
export interface DeclaredInput {
  name: string;
  def: InputDef;
  address: InputAddress;
  global?: string;
}

const declaredCache = new WeakMap<
  GlobalInputs,
  WeakMap<object, DeclaredInput[]>
>();

/** Every input `bonus` declares, in declaration order. A reference that resolves to no global
 *  input is left out, as the catalog check reports it. */
export function declaredInputs(
  bonus: Pick<Bonus, "id" | "inputs">,
  globals: GlobalInputs = NO_GLOBALS,
): DeclaredInput[] {
  const inputs = bonus.inputs;
  if (!inputs) return [];
  let byInputs = declaredCache.get(globals);
  if (!byInputs) declaredCache.set(globals, (byInputs = new WeakMap()));
  const cached = byInputs.get(bonus);
  if (cached) return cached;
  const out = Object.entries(inputs).flatMap(
    ([name, decl]): DeclaredInput[] => {
      if (!isGlobalRef(decl))
        return [
          { name, def: decl, address: bonusInputAddress(bonus.id, name) },
        ];
      const slot = globals.get(decl.global);
      if (!slot) return [];
      return [
        {
          name,
          def: globalInputDef(slot),
          address: { store: "context", path: slot.path },
          global: slot.id,
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
  globals: GlobalInputs = NO_GLOBALS,
): Record<string, InputDef> {
  return Object.fromEntries(
    declaredInputs(bonus, globals).map((entry) => [entry.name, entry.def]),
  );
}

/** `T` with its input references resolved. */
export type WithInputDefs<T> = Omit<T, "inputs"> & {
  inputs: Record<string, InputDef>;
};

/** `owner` with its input references resolved. */
export function withInputDefs<T extends Pick<Bonus, "id" | "inputs">>(
  owner: T,
  globals: GlobalInputs = NO_GLOBALS,
): WithInputDefs<T> {
  return { ...owner, inputs: inputDefs(owner, globals) };
}

/** The inputs `bonus` defines itself, stored under its own `bonusValues`. */
export function privateInputs(
  bonus: Pick<Bonus, "inputs">,
): [string, InputDef][] {
  return Object.entries(bonus.inputs ?? {}).flatMap(([name, decl]) =>
    isGlobalRef(decl) ? [] : [[name, decl] as [string, InputDef]],
  );
}
