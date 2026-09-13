// Stand-in backend for the browser and for Playwright. Mirrors src-tauri/src/roster.rs.
import type { Backend } from "./ipc";
import type { Aether, FamiliarSummary } from "./types";

const roster: FamiliarSummary[] = [
  { id: "vellum", workspace: "~/work/essays", name: "Vellum", order: "quill", engine: "claude", state: "idle", status: "idle", error: null, warnings: [], cannot_summon: null, binding_path: "~/.grimoire/bindings/vellum.binding.md" },
  { id: "sconce", workspace: "~/work/research", name: "Sconce", order: "lantern", engine: "claude", state: "working", status: "reading · 6 sources", error: null, warnings: [], cannot_summon: null, binding_path: "~/.grimoire/bindings/sconce.binding.md" },
  { id: "astrolabe", workspace: "~/work/planning", name: "Astrolabe", order: "compass", engine: "claude", state: "awaiting-seal", status: "waiting on your seal", error: null, warnings: [], cannot_summon: null, binding_path: "~/.grimoire/bindings/astrolabe.binding.md" },
  { id: "anvil", workspace: "~/src/grimoire", name: "Anvil", order: "crucible", engine: "claude", state: "dormant", status: "dormant", error: null, warnings: [], cannot_summon: null, binding_path: "~/.grimoire/bindings/anvil.binding.md" },
  { id: "tally", workspace: "~/work/numbers", name: "Tally", order: "ledger", engine: "claude", state: "dormant", status: "dormant", error: null, warnings: [], cannot_summon: null, binding_path: "~/.grimoire/bindings/tally.binding.md" },
];

const aether: Record<string, Aether> = {
  sconce: { tokens: 148_000, tokens_max: 250_000, turns: 11, turns_max: 40, seconds: 1_680, seconds_max: 1_800 },
  astrolabe: { tokens: 32_400, tokens_max: 120_000, turns: 4, turns_max: 25, seconds: 300, seconds_max: 900 },
};

export function createMockBackend(): Backend {
  return {
    kind: "mock",
    homeInfo: async () => ({ home: "~/.grimoire", bindings: "~/.grimoire/bindings", db_file: "~/.grimoire/grimoire.db", schema_version: 1 }),
    listFamiliars: async () => structuredClone(roster),
    aetherFor: async (id) => aether[id] ?? null,
  };
}
