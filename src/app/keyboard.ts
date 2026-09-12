// Global shortcuts (CLAUDE.md §9.3). ⌘ on macOS, Ctrl elsewhere (Playwright on Linux).
import { useEffect } from "react";

import type { AgentSummary, View } from "@/lib/types";

export function isMod(e: KeyboardEvent): boolean {
  return navigator.platform.toLowerCase().includes("mac") ? e.metaKey : e.ctrlKey;
}

export function useGlobalShortcuts(agents: AgentSummary[], setView: (v: View) => void, focusComposer: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isMod(e)) return;
      if (e.key >= "1" && e.key <= "5") {
        const a = agents.filter((x) => !x.error)[Number(e.key) - 1];
        if (a) { e.preventDefault(); setView({ kind: "agent", id: a.id }); }
      } else if (e.key === "0") { e.preventDefault(); setView({ kind: "approvals" }); }
      else if (e.key === ",") { e.preventDefault(); setView({ kind: "settings" }); }
      else if (e.key.toLowerCase() === "n") { e.preventDefault(); focusComposer(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [agents, setView, focusComposer]);
}

export const modLabel = typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac") ? "⌘" : "Ctrl+";
