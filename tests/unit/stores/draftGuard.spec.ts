// stores/draftGuard.ts: which drafts count as dirty, the unregister lifecycle, and the
// yes/no answers `confirmDiscard` reports.
import { describe, it, expect, beforeEach } from "vitest";
import * as draftGuard from "../../../src/stores/draftGuard";
import * as confirm from "../../../src/stores/confirm";

beforeEach(() => {
  // Close any dialog a previous test left open; each test owns its own unregister.
  confirm.settle(false);
});

describe("draftGuard", () => {
  it("reports no dirty draft when nothing is registered", async () => {
    expect(draftGuard.hasDirtyDraft()).toBe(false);
    expect(await draftGuard.confirmDiscard()).toBe(true);
  });

  it("reports a registered dirty draft and asks before discarding", async () => {
    const unregister = draftGuard.register({
      noun: "item",
      isDirty: () => true,
    });
    expect(draftGuard.hasDirtyDraft()).toBe(true);

    const answer = draftGuard.confirmDiscard();
    expect(confirm.pending.value?.title).toBe("Discard unsaved draft?");
    expect(confirm.pending.value?.message).toContain("The item");

    confirm.settle(false);
    expect(await answer).toBe(false);

    unregister();
    expect(draftGuard.hasDirtyDraft()).toBe(false);
  });

  it("goes ahead once the dialog is accepted", async () => {
    const unregister = draftGuard.register({
      noun: "bonus",
      isDirty: () => true,
    });
    const answer = draftGuard.confirmDiscard();
    confirm.settle(true);
    expect(await answer).toBe(true);
    unregister();
  });

  it("ignores a guard whose own draft is clean", async () => {
    const unregister = draftGuard.register({
      noun: "item",
      isDirty: () => false,
    });
    expect(draftGuard.hasDirtyDraft()).toBe(false);
    expect(await draftGuard.confirmDiscard()).toBe(true);
    unregister();
  });
});
