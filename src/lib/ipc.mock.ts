// Stand-in backend for the browser and for Playwright. Mirrors src-tauri/src/roster.rs.
import type { Backend, Emission, SummonRequest } from "./ipc";
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

/**
 * A stand-in for a real pty: it echoes what you type and answers a couple of commands, so the
 * terminal can be driven end to end in a plain browser and in Playwright. It is not a shell and
 * is not trying to be one — it exists so the wiring between xterm.js, the channel and the
 * component has something to carry.
 */
class FakeSummoning {
  private line = "";
  private readonly encoder = new TextEncoder();
  constructor(
    readonly id: string,
    private readonly emit: (e: Emission) => void,
  ) {}

  greet() {
    this.say(`Grimoire mock terminal — ${this.id}\r\nThere is no engine here. Type and it will echo.\r\n`);
    this.prompt();
  }

  prompt() {
    this.say("\u001b[38;2;176;141;63m❯\u001b[0m ");
  }

  input(bytes: Uint8Array) {
    for (const byte of bytes) {
      if (byte === 13) {
        this.say("\r\n");
        this.run(this.line.trim());
        this.line = "";
        this.prompt();
      } else if (byte === 127) {
        if (this.line.length > 0) {
          this.line = this.line.slice(0, -1);
          this.say("\b \b");
        }
      } else if (byte >= 32) {
        const ch = String.fromCharCode(byte);
        this.line += ch;
        this.say(ch);
      }
    }
  }

  private run(command: string) {
    if (command === "") return;
    if (command === "flood") {
      // The backpressure case, so the front-end path can be exercised without an engine.
      let out = "";
      for (let i = 1; i <= 5000; i++) out += `line ${i} of the flood\r\n`;
      this.say(out);
      return;
    }
    this.say(`${command}\r\n`);
  }

  private say(text: string) {
    this.emit({ kind: "output", bytes: this.encoder.encode(text) });
  }

  end() {
    this.emit({ kind: "ended", code: 0 });
  }
}

export function createMockBackend(): Backend {
  const live = new Map<string, FakeSummoning>();

  return {
    kind: "mock",
    homeInfo: async () => ({ home: "~/.grimoire", bindings: "~/.grimoire/bindings", db_file: "~/.grimoire/grimoire.db", schema_version: 1 }),
    listFamiliars: async () => structuredClone(roster),
    aetherFor: async (id) => aether[id] ?? null,

    async summon({ id, onEmission }: SummonRequest) {
      if (live.has(id)) throw new Error(`${id} is already summoned.`);
      const s = new FakeSummoning(id, onEmission);
      live.set(id, s);
      // Next tick, so a caller that renders on the resolved promise is mounted first.
      setTimeout(() => s.greet(), 0);
      return 4242;
    },
    async sendInput(id, bytes) {
      live.get(id)?.input(bytes);
    },
    async resizeSummoning() {},
    async banish(id) {
      const s = live.get(id);
      if (!s) throw new Error(`${id} is not summoned.`);
      live.delete(id);
      s.end();
      return "interrupt";
    },
    async liveSummonings() {
      return [...live.keys()];
    },
  };
}
