// The catalog a form and its nested controls author against, handed down by provide/inject.
//
// The layer editor's catalog includes the edited layer even when it is disabled, so controls
// that offer catalog-derived choices (ConditionRows' parameter picker) must read it rather than
// the engine's. Outside an editor, this falls back to the engine's composed catalog.
import { inject, provide, type ComputedRef, type InjectionKey } from "vue";
import * as engine from "../stores/resolved";
import type { Db } from "../types";

const EDITOR_DB: InjectionKey<ComputedRef<Db>> = Symbol("editorDb");

/** Offers `db` to everything below as the catalog being authored. */
export function provideEditorDb(db: ComputedRef<Db>) {
  provide(EDITOR_DB, db);
}

/** The surrounding editor's catalog, or the engine's when there is no editor above. */
export function useEditorDb(): ComputedRef<Db> {
  return inject(EDITOR_DB, engine.db);
}
