import { Channel, invoke } from "@tauri-apps/api/core";
import type { z } from "zod";

import type { Backend, Emission, SummonRequest } from "./ipc";
import * as S from "./schemas";

async function call<T>(cmd: string, schema: z.ZodType<T>, args?: Record<string, unknown>): Promise<T> {
  const raw = await invoke(cmd, args);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    console.error(`ipc ${cmd} returned something unexpected`, parsed.error.issues, raw);
    throw new Error(`The ${cmd} command returned a shape Grimoire does not understand. Check the Rust side.`);
  }
  return parsed.data;
}

export function createTauriBackend(): Backend {
  return {
    kind: "tauri",
    homeInfo: () => call("home_info", S.homeInfo),
    listFamiliars: () => call("list_familiars", S.familiarSummary.array()),
    aetherFor: (id) => call("aether_for", S.aether.nullable(), { id }),
    intakeFor: (id) => call("intake_for", S.intakeField.array(), { id }),
    async onBindingsChanged(fn) {
      const { listen } = await import("@tauri-apps/api/event");
      return listen("bindings-changed", () => fn());
    },

    async summon({ id, engine, args, cwd, cols, rows, model, onEmission }: SummonRequest) {
      const channel = new Channel<RawEmission>();
      channel.onmessage = (m) => onEmission(decode(m));
      const pid = await invoke("summon", {
        req: { id, engine, args, cwd, cols, rows, model: model ?? null },
        channel,
      });
      return S.pid.parse(pid);
    },
    sendInput: (id, bytes) =>
      // Tauri's serde bridge wants a plain number array, not a typed array.
      invoke("send_input", { id, bytes: Array.from(bytes) }).then(() => undefined),
    resizeSummoning: (id, cols, rows) =>
      invoke("resize_summoning", { id, cols, rows }).then(() => undefined),
    banish: (id) => call("banish", S.rung, { id }),
    liveSummonings: () => call("live_summonings", S.summoningIds),
    async attachSummoning(id, onEmission) {
      const channel = new Channel<RawEmission>();
      channel.onmessage = (m) => onEmission(decode(m));
      return S.attached.parse(await invoke("attach_summoning", { id, channel }));
    },

    commissionCreate: (id, prompt, intake) => call("commission_create", S.commission, { id, prompt, intake }),
    commissionsFor: (id) => call("commissions_for", S.commission.array(), { id }),
    ledgerSummary: () => call("ledger_summary", S.ledgerSummary),
    ledgerEvents: (limit) => call("ledger_events", S.ledgerEvent.array(), { limit: limit ?? null }),
    codexFor: (id) => call("codex_for", S.codexView, { id }),

    sealsPending: () => call("seals_pending", S.seal.array()),
    sealDecide: (id, resolution) => call("seal_decide", S.seal, { id, resolution }),
    async onSealsChanged(fn) {
      const { listen } = await import("@tauri-apps/api/event");
      return listen("seals-changed", () => fn());
    },
  };
}

/** What arrives on the wire, before the byte array is turned back into a Uint8Array. */
type RawEmission = { kind: "output"; bytes: number[] } | { kind: "ended"; code: number | null };

function decode(m: RawEmission): Emission {
  const parsed = S.emission.safeParse(m);
  if (!parsed.success) {
    console.error("a summoning emitted something unexpected", parsed.error.issues, m);
    // Treat an unreadable message as the end rather than feeding the terminal rubbish.
    return { kind: "ended", code: null };
  }
  return parsed.data.kind === "output"
    ? { kind: "output", bytes: Uint8Array.from(parsed.data.bytes) }
    : { kind: "ended", code: parsed.data.code };
}
