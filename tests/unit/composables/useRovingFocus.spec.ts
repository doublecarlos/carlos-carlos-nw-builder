// Pure keyboard logic, exercised against fake elements (`focus`/`disabled` only) rather than a
// real DOM. Vitest runs these under the `node` environment, with no jsdom dependency.
import { ref, nextTick } from "vue";
import { describe, it, expect, vi } from "vitest";
import { useRovingFocus } from "../../../src/composables/useRovingFocus";

function fakeItem(disabled = false): HTMLElement {
  return { focus: vi.fn(), disabled } as unknown as HTMLElement;
}

function fakeContainer(items: HTMLElement[]): HTMLElement {
  return { querySelectorAll: () => items } as unknown as HTMLElement;
}

function keyEvent(
  key: string,
  target: HTMLElement | null = null,
): KeyboardEvent {
  return { key, target, preventDefault: vi.fn() } as unknown as KeyboardEvent;
}

describe("useRovingFocus", () => {
  it("ArrowDown wraps from the last item to the first", () => {
    const [a, b, c] = [fakeItem(), fakeItem(), fakeItem()];
    const { onKeydown } = useRovingFocus({
      container: ref(fakeContainer([a, b, c])),
      itemSelector: "x",
      onDismiss: vi.fn(),
    });
    onKeydown(keyEvent("ArrowDown", c));
    expect(a.focus).toHaveBeenCalled();
  });

  it("ArrowUp wraps from the first item to the last", () => {
    const [a, b, c] = [fakeItem(), fakeItem(), fakeItem()];
    const { onKeydown } = useRovingFocus({
      container: ref(fakeContainer([a, b, c])),
      itemSelector: "x",
      onDismiss: vi.fn(),
    });
    onKeydown(keyEvent("ArrowUp", a));
    expect(c.focus).toHaveBeenCalled();
  });

  it("Home/End jump to the first/last item", () => {
    const [a, b, c] = [fakeItem(), fakeItem(), fakeItem()];
    const { onKeydown } = useRovingFocus({
      container: ref(fakeContainer([a, b, c])),
      itemSelector: "x",
      onDismiss: vi.fn(),
    });
    onKeydown(keyEvent("End", b));
    expect(c.focus).toHaveBeenCalled();
    onKeydown(keyEvent("Home", b));
    expect(a.focus).toHaveBeenCalled();
  });

  it("skips disabled items", () => {
    const [a, b, c] = [fakeItem(), fakeItem(true), fakeItem()];
    const { onKeydown } = useRovingFocus({
      container: ref(fakeContainer([a, b, c])),
      itemSelector: "x",
      onDismiss: vi.fn(),
    });
    // b is filtered out, so the list seen by the composable is [a, c].
    onKeydown(keyEvent("ArrowDown", a));
    expect(c.focus).toHaveBeenCalled();
  });

  it("Tab and Escape call onDismiss; Tab also prevents default", () => {
    const onDismiss = vi.fn();
    const { onKeydown } = useRovingFocus({
      container: ref(fakeContainer([fakeItem()])),
      itemSelector: "x",
      onDismiss,
    });
    const tabEvent = keyEvent("Tab");
    onKeydown(tabEvent);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(tabEvent.preventDefault).toHaveBeenCalled();

    onKeydown(keyEvent("Escape"));
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it("with roving off, arrow keys are untouched but Tab still dismisses", () => {
    const onDismiss = vi.fn();
    const [a, b] = [fakeItem(), fakeItem()];
    const { onKeydown } = useRovingFocus({
      container: ref(fakeContainer([a, b])),
      itemSelector: "x",
      roving: false,
      onDismiss,
    });
    onKeydown(keyEvent("ArrowDown", a));
    expect(a.focus).not.toHaveBeenCalled();
    expect(b.focus).not.toHaveBeenCalled();

    onKeydown(keyEvent("Tab"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("leaves unrelated keys alone", () => {
    const onDismiss = vi.fn();
    const [a, b] = [fakeItem(), fakeItem()];
    const { onKeydown } = useRovingFocus({
      container: ref(fakeContainer([a, b])),
      itemSelector: "x",
      onDismiss,
    });
    const event = keyEvent("a", a);
    onKeydown(event);
    expect(a.focus).not.toHaveBeenCalled();
    expect(b.focus).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("focusFirst/focusLast focus the first/last item after a tick", async () => {
    const [a, b, c] = [fakeItem(), fakeItem(), fakeItem()];
    const { focusFirst, focusLast } = useRovingFocus({
      container: ref(fakeContainer([a, b, c])),
      itemSelector: "x",
      onDismiss: vi.fn(),
    });
    focusFirst();
    await nextTick();
    expect(a.focus).toHaveBeenCalled();

    focusLast();
    await nextTick();
    expect(c.focus).toHaveBeenCalled();
  });
});
