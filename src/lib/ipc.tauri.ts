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
    aetherFor: async () => null,

    async summon({ id, engine, args, cwd, cols, rows, onEmission }: SummonRequest) {
      const channel = new Channel<RawEmission>();
      channel.onmessage = (m) => onEmission(decode(m));
      const pid = await invoke("summon", { req: { id, engine, args, cwd, cols, rows }, channel });
      return S.pid.parse(pid);
    },
    sendInput: (id, bytes) =>
      // Tauri's serde bridge wants a plain number array, not a typed array.
      invoke("send_input", { id, bytes: Array.from(bytes) }).then(() => undefined),
    resizeSummoning: (id, cols, rows) =>
      invoke("resize_summoning", { id, cols, rows }).then(() => undefined),
    banish: (id) => call("banish", S.rung, { id }),
    liveSummonings: () => call("live_summonings", S.summoningIds),
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
