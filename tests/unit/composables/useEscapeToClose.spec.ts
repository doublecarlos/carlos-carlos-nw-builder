// The handler is captured from a mocked `useEventListener`: Vitest runs under `node`, with no
// window to dispatch on.
import { describe, it, expect, vi } from "vitest";

vi.stubGlobal("window", {});

let handler: ((event: KeyboardEvent) => void) | undefined;
vi.mock("@vueuse/core", () => ({
  useEventListener: (
    _target: unknown,
    _type: string,
    listener: (event: KeyboardEvent) => void,
  ) => {
    handler = listener;
  },
}));

const { useEscapeToClose } =
  await import("../../../src/composables/useEscapeToClose");

const press = (key: string, repeat = false) =>
  handler?.({ key, repeat } as KeyboardEvent);

// Every dismissible overlay closes through this, so a held Escape must close once, not keep
// closing whatever surfaces under it on each key repeat.
describe("useEscapeToClose", () => {
  it("closes on Escape, once per press", () => {
    const close = vi.fn();
    useEscapeToClose(close);
    press("Escape");
    press("Escape", true);
    press("Escape", true);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("ignores other keys", () => {
    const close = vi.fn();
    useEscapeToClose(close);
    press("Enter");
    press("Esc");
    expect(close).not.toHaveBeenCalled();
  });
});
