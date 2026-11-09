// What NavBuilds hands every level of its recursive NavBuildRows: the row state shared across
// the whole tree, one drop list per folder, and the handlers each row reports through. Passed
// by injection so a folder seven levels down needs no chain of forwarded props and emits.
import type { InjectionKey } from "vue";
import type { DragHandleProps, useDropList } from "./useDragAndDrop";
import type { NavMenuItem } from "../lib/nav-menu";
import type { Build, BuildFolder } from "../types";

export type DropList = ReturnType<typeof useDropList>;

/** A rendered row, carrying its index in the *unfiltered* list it belongs to: drop targets
 *  and drag sources are expressed against the real order, so reordering keeps working while
 *  a filter is hiding rows. */
export type NavBuildRow =
  | { kind: "build"; build: Build; index: number }
  | {
      kind: "folder";
      folder: BuildFolder;
      rows: NavBuildRow[];
      index: number;
      /** Builds anywhere inside, filtered out or not. */
      count: number;
    };

export interface NavBuildsContext {
  state: Readonly<{
    selectedId: string | null;
    renamingId: string | null;
    renameText: string;
    menuOpenId: string | null;
    menuItems: NavMenuItem[];
    menuOrigin: { anchor: DOMRect; trigger: HTMLElement } | null;
  }>;
  isOpen(folder: BuildFolder): boolean;
  /** Whether the row being dragged may drop inside this folder. */
  canDropInto(folderId: string): boolean;
  folderDrop(folderId: string): DropList;
  handleProps(
    kind: "build" | "folder",
    id: string,
    index: number,
    parentId: string | null,
  ): DragHandleProps;
  on: {
    select(id: string): void;
    toggle(id: string): void;
    renameStart(id: string, name: string): void;
    renameCommit(): void;
    renameCancel(): void;
    moveUp(id: string): void;
    moveDown(id: string): void;
    deleteRequest(id: string, skipConfirm: boolean): void;
    menuOpen(id: string, event: MouseEvent): void;
    menuAction(action: string, id: string, skipConfirm: boolean): void;
    menuClose(): void;
  };
}

export const NAV_BUILDS_CONTEXT: InjectionKey<NavBuildsContext> =
  Symbol("nav-builds-context");
