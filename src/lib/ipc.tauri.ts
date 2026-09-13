import { invoke } from "@tauri-apps/api/core";
import type { z } from "zod";

import type { Backend } from "./ipc";
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
  };
}
