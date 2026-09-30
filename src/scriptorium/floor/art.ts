// The generated art the floor is drawn with: the painted room and the familiars standing in it
// (§8, DECISIONS 0020).
//
// All of it is loaded *before* any actor is made, through Pixi's loader, and anything that
// fails to load is simply absent: a familiar without a portrait is drawn in code, and a floor
// without its painting is the vector plan. The first version of this took `Texture.from()` of a
// URL at module load, which in Pixi v8 is a cache lookup, not a load — it returned nothing, the
// first `sync` threw, and with no boundary above it the whole window went blank on the default
// view (DECISIONS 0021).

import { Assets, type Texture, loadTextures } from "pixi.js";

import type { Order } from "@/lib/types";

import { absolute } from "./assetUrl";
import floorPainting from "@/assets/higgsfield/floor-plan.jpg";
import quill from "@/assets/higgsfield/familiars/quill.png";
import lantern from "@/assets/higgsfield/familiars/lantern.png";
import crucible from "@/assets/higgsfield/familiars/crucible.png";
import compass from "@/assets/higgsfield/familiars/compass.png";
import ledger from "@/assets/higgsfield/familiars/ledger.png";

/** One figure per order. Adding a sixth order means one more line here, as in `plan.ts`. */
export const PORTRAIT_URLS: Record<Order, string> = { quill, lantern, crucible, compass, ledger };

/** The room from directly above, registered so its 0..1 square is the plan's 0..`WORLD` square. */
export const FLOOR_PAINTING_URL = floorPainting;

/**
 * Decode on the main thread. Pixi's default is a Web Worker built from a `blob:` URL, which the
 * application's CSP (`default-src 'self'`, no `worker-src`) refuses — and Pixi's support check
 * waits on that worker's reply with no error path, so under Tauri the floor would never open.
 * The browser the Playwright suite runs in has no CSP, which is why only the binary would show it.
 */
if (loadTextures.config) loadTextures.config.preferWorkers = false;

/** A load that has not settled by now is treated as failed; the floor opens without it. */
const LOAD_TIMEOUT_MS = 8000;

export type Portraits = Partial<Record<Order, Texture>>;

export interface Art {
  portraits: Portraits;
  floor: Texture | null;
  /** What did not load and why, one line each — said on the floor, not only in a console. */
  missing: string[];
}

async function load(url: string, what: string, missing: string[]): Promise<Texture | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const late = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no answer in ${LOAD_TIMEOUT_MS / 1000}s`)), LOAD_TIMEOUT_MS);
    });
    return (await Promise.race([Assets.load<Texture>(absolute(url)), late])) ?? null;
  } catch (reason) {
    console.warn(`${what} did not load; drawing it in code instead`, reason);
    missing.push(`${what}: ${reason instanceof Error ? reason.message : String(reason)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Everything that loads. Never rejects: what fails is drawn in code, not a crash. */
export async function loadArt(
  urls: { portraits: Record<Order, string>; floor: string } = { portraits: PORTRAIT_URLS, floor: FLOOR_PAINTING_URL },
): Promise<Art> {
  const missing: string[] = [];
  const [floor, ...portraits] = await Promise.all([
    load(urls.floor, "the painted floor", missing),
    ...(Object.entries(urls.portraits) as [Order, string][]).map(async ([order, url]) => {
      const texture = await load(url, `the ${order} familiar's portrait`, missing);
      return texture ? ([order, texture] as const) : null;
    }),
  ]);
  return {
    floor: floor as Texture | null,
    portraits: Object.fromEntries(portraits.filter((entry) => entry !== null)) as Portraits,
    missing,
  };
}
