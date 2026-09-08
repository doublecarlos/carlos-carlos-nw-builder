// The confirmation store: what a caller gets back from each way of answering.
import { describe, expect, it, beforeEach } from "vitest";
import * as confirm from "../../../src/stores/confirm";

const request = {
  title: "Delete build",
  message: "Delete “Build 1”?",
  confirmLabel: "Delete",
  danger: true,
};

beforeEach(() => {
  confirm.settle(false);
});

describe("confirm store", () => {
  it("holds the request until it is answered", async () => {
    const answer = confirm.ask(request);
    expect(confirm.pending.value).toEqual(request);

    confirm.settle(true);
    expect(await answer).toEqual({ ok: true, checked: false });
    expect(confirm.pending.value).toBeNull();
  });

  it("reports a cancellation as not ok", async () => {
    const answer = confirm.ask(request);
    confirm.settle(false);

    expect(await answer).toEqual({ ok: false, checked: false });
  });

  it("carries the checkbox answer back to the caller", async () => {
    const answer = confirm.ask({
      ...request,
      checkbox: { label: "Also delete the 2 builds inside", checked: true },
    });
    confirm.settle(true, false);

    expect(await answer).toEqual({ ok: true, checked: false });
  });

  it("cancels an older request rather than queueing behind it", async () => {
    const first = confirm.ask(request);
    const second = confirm.ask({ ...request, title: "Delete layer" });

    expect(await first).toEqual({ ok: false, checked: false });
    expect(confirm.pending.value?.title).toBe("Delete layer");

    confirm.settle(true);
    expect(await second).toEqual({ ok: true, checked: false });
  });

  it("skips the dialog entirely, answering yes with the checkbox default", async () => {
    const answer = confirm.askUnless(true, {
      ...request,
      checkbox: { label: "Also delete the 2 builds inside", checked: true },
    });

    expect(confirm.pending.value).toBeNull();
    expect(await answer).toEqual({ ok: true, checked: true });
  });
});
