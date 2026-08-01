// Platform detection: one-export module so the heuristics live in one place instead of
// scattered across Ctrl/Cmd-click handlers and keyboard shortcut guards.
export const isMac = /mac/i.test(
  (navigator as { userAgentData?: { platform?: string } }).userAgentData
    ?.platform ?? navigator.platform,
);
