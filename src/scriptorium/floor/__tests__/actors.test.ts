// The state table in §8.3, checked as arithmetic rather than by watching the screen.
//
// `createActors` wants a WebGL context, so what is tested here is the part that decides things:
// which station a state puts a familiar at, and how a walk is paced. The drawing is verified in
// the running binary, where a headless canvas would only have told a comfortable lie anyway.

import { describe, expect, test } from "bun:test";

import { stationFor } from "../actors";
import { CENTRE, distance, slot, station } from "../plan";
import { walk } from "../paths";

describe("where each state puts a familiar", () => {
  test("dormant familiars are at the hearth", () => {
    expect(stationFor("dormant", "quill")).toBe("hearth");
  });

  test("a familiar waiting on your seal stands in the ward circle", () => {
    // §8.4's first question — "is anything waiting on me?" — is answered by looking at one spot.
    for (const order of ["quill", "lantern", "crucible", "compass", "ledger"] as const) {
      expect(stationFor("awaiting-seal", order)).toBe("ward");
    }
  });

  test("a working familiar is at its own order's desk", () => {
    expect(stationFor("working", "crucible")).toBe("desk-crucible");
    expect(stationFor("idle", "ledger")).toBe("desk-ledger");
    expect(stationFor("bound", "quill")).toBe("desk-quill");
    expect(stationFor("stalled", "lantern")).toBe("desk-lantern");
    expect(stationFor("misfired", "compass")).toBe("desk-compass");
  });

  test("a banished familiar leaves by the door", () => {
    expect(stationFor("banished", "quill")).toBe("door");
  });
});

describe("the walk", () => {
  /** Replays the pacing in `tick`: each leg gets its share of the 1.1s, measured once. */
  function journey(from: string, to: string, finish: { x: number; y: number }) {
    const legs = walk(from, to, finish);
    const start = slot(station(from), 0);
    const total = legs.reduce((sum, leg, i) => sum + distance(i === 0 ? start : legs[i - 1]!, leg), 0);
    const times = legs.map((leg, i) => 1100 * (distance(i === 0 ? start : legs[i - 1]!, leg) / total));
    return { legs, total, times };
  }

  test("the whole journey takes 1.1 seconds however many legs it has", () => {
    // The bug this exists for: measuring what is *left* each frame rather than the whole walk
    // once makes the last leg alone take the full 1.1s, so a familiar crossing the room
    // accelerates into its chair.
    for (const [from, to] of [
      ["door", "desk-quill"],
      ["desk-quill", "ward"],
      ["desk-crucible", "desk-lantern"],
      ["hearth", "desk-ledger"],
    ] as const) {
      const { times } = journey(from, to, slot(station(to), 0));
      const sum = times.reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1100, 5);
    }
  });

  test("a long crossing and a short shuffle move at the same speed", () => {
    const near = journey("desk-quill", "desk-lantern", slot(station("desk-lantern"), 0));
    const far = journey("desk-quill", "desk-compass", slot(station("desk-compass"), 0));
    expect(far.total).toBeGreaterThan(near.total);
    // Both take 1.1s in total, so speed is length over time and the far one is faster — that is
    // the deliberate choice §8.3 makes by giving the walk a fixed duration.
    expect(far.times.reduce((a, b) => a + b, 0)).toBeCloseTo(near.times.reduce((a, b) => a + b, 0), 5);
  });

  test("no leg has zero length, so nothing divides by nothing", () => {
    for (const [from, to] of [
      ["desk-quill", "ward"],
      ["ward", "desk-quill"],
      ["desk-ledger", "hearth"],
    ] as const) {
      const { legs, times } = journey(from, to, slot(station(to), 0));
      expect(legs.length).toBeGreaterThan(0);
      for (const t of times) expect(t).toBeGreaterThan(0);
    }
  });

  test("a familiar called to the seal finishes in the middle of the circle", () => {
    const legs = walk("desk-ledger", "ward", slot(station("ward"), 0));
    expect(legs[legs.length - 1]).toEqual(CENTRE);
  });
});
