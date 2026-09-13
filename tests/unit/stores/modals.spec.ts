// The modal-presence store: BaseModal registers itself here so app-level shortcuts can tell
// whether an overlay is on screen.
import { afterEach, describe, expect, it } from "vitest";
import {
  isModalOpen,
  modalClosed,
  modalOpened,
} from "../../../src/stores/modals";

afterEach(() => {
  // Leave the module-level counter clean for the next test.
  while (isModalOpen.value) modalClosed();
});

describe("modal presence", () => {
  it("starts closed", () => {
    expect(isModalOpen.value).toBe(false);
  });

  it("opens while a modal is mounted and closes when it goes", () => {
    modalOpened();
    expect(isModalOpen.value).toBe(true);

    modalClosed();
    expect(isModalOpen.value).toBe(false);
  });

  it("stays open while any of a stack remains", () => {
    modalOpened();
    modalOpened();

    modalClosed();
    expect(isModalOpen.value).toBe(true);

    modalClosed();
    expect(isModalOpen.value).toBe(false);
  });

  it("ignores a close with nothing open", () => {
    modalClosed();
    expect(isModalOpen.value).toBe(false);
  });
});
