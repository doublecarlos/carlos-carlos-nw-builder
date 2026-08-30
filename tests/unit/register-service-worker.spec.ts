// The dev-mode gate is the load-bearing part here: a cache-first worker sitting in front of
// Vite's unhashed dev modules would serve stale code and break HMR, and that is a mistake you
// only notice long after making it.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { registerServiceWorker } from "../../src/lib/service-worker";

const register = vi.fn(() => Promise.resolve({}));

beforeEach(() => {
  register.mockClear();
  vi.stubGlobal("navigator", { serviceWorker: { register } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("registerServiceWorker", () => {
  it("registers the worker at the deployed base path in production", () => {
    vi.stubEnv("PROD", true);
    vi.stubEnv("BASE_URL", "/builder/");

    registerServiceWorker();

    expect(register).toHaveBeenCalledWith("/builder/sw.js");
  });

  it("stays out of the way in development", () => {
    vi.stubEnv("PROD", false);

    registerServiceWorker();

    expect(register).not.toHaveBeenCalled();
  });

  it("does nothing where service workers are unavailable", () => {
    vi.stubEnv("PROD", true);
    vi.stubGlobal("navigator", {});

    expect(() => registerServiceWorker()).not.toThrow();
  });

  it("keeps the app up when registration is refused", async () => {
    vi.stubEnv("PROD", true);
    vi.stubEnv("BASE_URL", "/");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    register.mockRejectedValueOnce(new Error("insecure origin"));

    expect(() => registerServiceWorker()).not.toThrow();
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    warn.mockRestore();
  });
});
