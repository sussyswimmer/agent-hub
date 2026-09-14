// Stand-in backend for the browser and for Playwright. Mirrors src-tauri/src/roster.rs.
import type { Backend, Emission, SummonRequest } from "./ipc";
import type {
  Aether,
  CodexView,
  Commission,
  Event,
  FamiliarSummary,
  IntakeField,
  LedgerSummary,
  Resolution,
  Seal,
} from "./types";

const roster: FamiliarSummary[] = [
  { id: "vellum", workspace: "~/work/essays", name: "Vellum", order: "quill", engine: "claude", state: "idle", status: "idle", error: null, warnings: [], cannot_summon: null, binding_path: "~/.grimoire/bindings/vellum.binding.md" },
  { id: "sconce", workspace: "~/work/research", name: "Sconce", order: "lantern", engine: "claude", state: "working", status: "reading · 6 sources", error: null, warnings: [], cannot_summon: null, binding_path: "~/.grimoire/bindings/sconce.binding.md" },
  { id: "astrolabe", workspace: "~/work/planning", name: "Astrolabe", order: "compass", engine: "claude", state: "awaiting-seal", status: "waiting on your seal", error: null, warnings: [], cannot_summon: null, binding_path: "~/.grimoire/bindings/astrolabe.binding.md" },
  { id: "anvil", workspace: "~/src/grimoire", name: "Anvil", order: "crucible", engine: "claude", state: "dormant", status: "dormant", error: null, warnings: [], cannot_summon: null, binding_path: "~/.grimoire/bindings/anvil.binding.md" },
  { id: "tally", workspace: "~/work/numbers", name: "Tally", order: "ledger", engine: "claude", state: "dormant", status: "dormant", error: null, warnings: [], cannot_summon: null, binding_path: "~/.grimoire/bindings/tally.binding.md" },
];

const aether: Record<string, Aether> = {
  // Sconce sits past 80% of its minutes, which is where §6.5 turns the rule brass — the case
  // worth having on screen by default, because it is the one with a consequence.
  sconce: { tokens: 148_000, tokens_max: 250_000, turns: 11, turns_max: 40, seconds: 1_680, seconds_max: 1_800 },
  astrolabe: { tokens: 32_400, tokens_max: 120_000, turns: 4, turns_max: 25, seconds: 300, seconds_max: 900 },
  // Over the line, so the oxblood end of the scale is reachable without waiting for a run.
  vellum: { tokens: 260_000, tokens_max: 250_000, turns: 30, turns_max: 40, seconds: 600, seconds_max: 1_800 },
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
    private emit: (e: Emission) => void,
  ) {}

  /** A new terminal takes over the output, as it does in the real backend. */
  attach(emit: (e: Emission) => void) {
    this.emit = emit;
  }

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

/**
 * The roster, optionally padded out to `?familiars=N`.
 *
 * §10 sets the floor's budget at twelve familiars with five of them working, and five is all
 * the seeds there are. Rather than invent a thirteenth seed nobody wants in their study, the
 * mock will make up as many as a test asks for — original names in §3's register, spread across
 * the five orders so the desks share and queue the way §8.2 describes.
 *
 * Only the mock does this. The real roster is whatever is in the bindings folder.
 */
function crowd(): FamiliarSummary[] {
  const wanted = Number(new URLSearchParams(location.search).get("familiars") ?? 0);
  if (!Number.isFinite(wanted) || wanted <= roster.length) return roster;

  const orders = ["quill", "lantern", "crucible", "compass", "ledger"] as const;
  const names = [
    "Gnomon", "Camber", "Rubric", "Plumb", "Ferrule", "Signet", "Bezel",
    "Sextant", "Verso", "Colophon", "Armature", "Quire",
  ];
  const made: FamiliarSummary[] = [];
  for (let i = 0; roster.length + made.length < wanted; i++) {
    const name = names[i % names.length]! + (i >= names.length ? ` ${Math.floor(i / names.length) + 1}` : "");
    // Five working, because that is the case §10 puts a number on. The rest are idle.
    made.push({
      id: `made-${i}`,
      name,
      order: orders[i % orders.length]!,
      engine: "claude",
      state: i < 4 ? "working" : "idle",
      status: i < 4 ? "working" : "idle",
      workspace: "~/work/elsewhere",
      error: null,
      warnings: [],
      cannot_summon: null,
      binding_path: `~/.grimoire/bindings/made-${i}.binding.md`,
    });
  }
  return [...roster, ...made];
}

/** Mirrors the intake in seeds/*.binding.md, so the form has something real to render. */
const intake: Record<string, IntakeField[]> = {
  vellum: [
    { id: "piece", ask: "Which piece are we working on?", type: "text", options: [], required: true },
    { id: "mode", ask: "What kind of pass?", type: "select", options: ["line edit", "structural", "fact check", "cut for length"], required: true },
    { id: "audience", ask: "Who reads it?", type: "text", options: [], required: false },
  ],
  sconce: [
    { id: "question", ask: "What is the question?", type: "multiline", options: [], required: true },
    { id: "shape", ask: "What should come back?", type: "select", options: ["brief", "literature review", "data and charts"], required: true },
  ],
  astrolabe: [
    { id: "horizon", ask: "How far ahead are we planning?", type: "select", options: ["today", "this week", "the next fortnight"], required: true },
    { id: "fixed", ask: "What is immovable this period?", type: "multiline", options: [], required: false },
  ],
  anvil: [
    { id: "change", ask: "What should change?", type: "multiline", options: [], required: true },
    { id: "done", ask: "What does done look like?", type: "multiline", options: [], required: true },
  ],
};

/**
 * An in-memory stand-in for the commissions table, with the one rule that matters: a familiar
 * runs one at a time and the rest queue behind it (§6.2). The queue is the thing worth testing
 * in the interface, so the mock has to actually have one rather than always answering "queued".
 */
class Commissions {
  private rows: Commission[] = [];
  private seq = 0;

  place(familiarId: string, prompt: string, intake: Record<string, string>): Commission {
    const row: Commission = {
      // Padded so string ordering matches insertion order, as the rowid does in SQLite.
      id: `c${String(++this.seq).padStart(4, "0")}`,
      familiar_id: familiarId,
      summoning_id: null,
      prompt,
      intake,
      status: "queued",
      created: Math.floor(Date.now() / 1000),
      ended: null,
      tokens: { input: 0, output: 0, cache_read: 0, cache_write: 0 },
      turns: 0,
      cost: { usd: 0, estimated: true },
      note: null,
    };
    this.rows.push(row);
    return structuredClone(row);
  }

  /** Newest first, as the real one returns them. */
  for(familiarId: string): Commission[] {
    return this.rows.filter((c) => c.familiar_id === familiarId).reverse().map((c) => structuredClone(c));
  }

  /** Start the oldest queued one, if the familiar is free. Mirrors `next_to_run`. */
  startNext(familiarId: string): Commission | null {
    const mine = this.rows.filter((c) => c.familiar_id === familiarId);
    if (mine.some((c) => c.status === "running" || c.status === "awaiting_seal")) return null;
    const next = mine.find((c) => c.status === "queued");
    if (!next) return null;
    next.status = "running";
    next.summoning_id = "s1";
    return structuredClone(next);
  }

  end(familiarId: string) {
    for (const c of this.rows) {
      if (c.familiar_id === familiarId && (c.status === "running" || c.status === "awaiting_seal")) {
        c.status = "banished";
        c.ended = Math.floor(Date.now() / 1000);
        // A run that did something costs something, so the ledger has a number to show.
        c.tokens = { input: 24_000, output: 1_200, cache_read: 0, cache_write: 0 };
        c.turns = 3;
        c.cost = { usd: 0.09, estimated: true };
      }
    }
  }

  summary(): LedgerSummary {
    const zero = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
    const add = (a: typeof zero, b: typeof zero) => ({
      input: a.input + b.input,
      output: a.output + b.output,
      cache_read: a.cache_read + b.cache_read,
      cache_write: a.cache_write + b.cache_write,
    });

    const byFamiliar = [...new Set(this.rows.map((c) => c.familiar_id))].map((familiar_id) => {
      const mine = this.rows.filter((c) => c.familiar_id === familiar_id);
      return {
        familiar_id,
        commissions: mine.length,
        tokens: mine.map((c) => c.tokens).reduce(add, zero),
        cost: { usd: mine.reduce((n, c) => n + c.cost.usd, 0), estimated: true as const },
        seconds: mine.reduce((n, c) => n + ((c.ended ?? c.created) - c.created), 0),
      };
    });
    byFamiliar.sort((a, b) => b.cost.usd - a.cost.usd);

    const today = new Date().toISOString().slice(0, 10);
    return {
      by_familiar: byFamiliar,
      by_day: this.rows.length
        ? [
            {
              day: today,
              commissions: this.rows.length,
              tokens: this.rows.map((c) => c.tokens).reduce(add, zero),
              cost: { usd: this.rows.reduce((n, c) => n + c.cost.usd, 0), estimated: true as const },
            },
          ]
        : [],
      total: { usd: this.rows.reduce((n, c) => n + c.cost.usd, 0), estimated: true },
      tokens: this.rows.map((c) => c.tokens).reduce(add, zero),
      commissions: this.rows.length,
    };
  }
}

/**
 * A stand-in for the seal's queue (§6.4).
 *
 * The mock familiar has no real tool calls to judge, so requests are raised on a schedule the
 * interface can drive: summoning a familiar whose binding is `propose` puts one in front of the
 * owner, which is exactly the shape the real one produces.
 */
class Seals {
  private rows: Seal[] = [];
  private seq = 0;
  private listeners = new Set<() => void>();

  raise(familiarId: string, name: string, commissionId: string, kind: Seal["kind"], action: string, reason: string, preview: string | null) {
    this.rows.push({
      id: `s${String(++this.seq).padStart(4, "0")}`,
      commission_id: commissionId,
      familiar_id: familiarId,
      familiar_name: name,
      kind,
      action,
      reason,
      preview,
      raised: Math.floor(Date.now() / 1000),
      resolved: null,
      resolution: null,
    });
    this.changed();
  }

  pending(): Seal[] {
    return this.rows.filter((s) => s.resolved === null).map((s) => structuredClone(s));
  }

  decide(id: string, resolution: Resolution): Seal {
    const row = this.rows.find((s) => s.id === id);
    if (!row) throw new Error(`there is no seal ${id}`);
    if (row.resolved !== null) throw new Error("that request has already been answered");
    row.resolved = Math.floor(Date.now() / 1000);
    row.resolution = resolution;
    this.changed();
    return structuredClone(row);
  }

  watch(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private changed() {
    for (const fn of this.listeners) fn();
  }
}

export function createMockBackend(): Backend {
  const live = new Map<string, FakeSummoning>();
  const commissions = new Commissions();
  const seals = new Seals();
  const events: Event[] = [];

  return {
    kind: "mock",
    homeInfo: async () => ({ home: "~/.grimoire", bindings: "~/.grimoire/bindings", db_file: "~/.grimoire/grimoire.db", schema_version: 1 }),
    listFamiliars: async () =>
      structuredClone(
        // The real backend overlays what is actually happening onto the binding's own row
        // (see `list_familiars`). The mock does the one part a test can observe: a familiar
        // with a live summoning is not dormant.
        crowd().map((f) => (live.has(f.id) && f.state === "dormant" ? { ...f, state: "idle" as const, status: "summoned, idle" } : f)),
      ),
    aetherFor: async (id) => aether[id] ?? null,
    intakeFor: async (id) => structuredClone(intake[id] ?? []),
    // The mock backend has no folder to watch, so nothing ever changes under it.
    onBindingsChanged: async () => () => {},

    async summon({ id, onEmission }: SummonRequest) {
      if (live.has(id)) throw new Error(`${id} is already summoned.`);
      const s = new FakeSummoning(id, onEmission);
      live.set(id, s);
      const taken = commissions.startNext(id);
      if (taken) {
        events.push(event(events.length + 1, id, taken.id, "commission_started"));
        // Astrolabe stands in for a familiar whose binding is `propose`: the first thing it
        // tries needs a seal, which is what the queue is for.
        if (id === "astrolabe") {
          seals.raise(
            id,
            "Astrolabe",
            taken.id,
            "write",
            "write to ~/work/planning/week.md",
            "Astrolabe is set to propose, so anything beyond reading and thinking comes to you first.",
            "# The week\n\nMonday: the swimming essay.\n",
          );
        }
      }
      events.push(event(events.length + 1, id, taken?.id ?? null, "summoned"));
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
      commissions.end(id);
      events.push(event(events.length + 1, id, null, "banished"));
      s.end();
      return "interrupt";
    },
    async liveSummonings() {
      return [...live.keys()];
    },
    async attachSummoning(id, onEmission) {
      const s = live.get(id);
      if (!s) return false;
      s.attach(onEmission);
      return true;
    },

    async commissionCreate(id, prompt, intake) {
      const row = commissions.place(id, prompt, intake);
      events.push(event(events.length + 1, id, row.id, "commission_queued"));
      return row;
    },
    async commissionsFor(id) {
      return commissions.for(id);
    },
    async ledgerSummary() {
      return commissions.summary();
    },
    async ledgerEvents(limit) {
      return events.slice(-(limit ?? 100)).reverse();
    },
    async sealsPending() {
      return seals.pending();
    },
    async sealDecide(id, resolution) {
      return seals.decide(id, resolution);
    },
    async onSealsChanged(fn) {
      return seals.watch(fn);
    },
    async codexFor(id) {
      return codex[id] ?? { path: `~/.grimoire/codex/${id}.md`, text: "", words: 0, needs_condense: false };
    },
  };
}

function event(id: number, familiar: string, commission: string | null, kind: Event["kind"]): Event {
  return {
    id,
    at: Math.floor(Date.now() / 1000),
    commission_id: commission,
    familiar_id: familiar,
    kind,
    payload: {},
  };
}

/** One familiar with something already written, so the codex tab has content to show. */
const codex: Record<string, CodexView> = {
  vellum: {
    path: "~/.grimoire/codex/vellum.md",
    text: "Prefers short paragraphs.\nDislikes the word `leverage`.\nThe swimming essay is the one that matters.\n",
    words: 18,
    needs_condense: false,
  },
};
