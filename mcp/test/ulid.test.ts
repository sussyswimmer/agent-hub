import { describe, expect, test } from "bun:test";

import { ulid } from "../src/ulid";

describe("ulid", () => {
  test("shape and ordering", () => {
    const a = ulid(1_700_000_000_000);
    const b = ulid(1_700_000_000_000);
    const c = ulid(1_700_000_000_001);
    expect(a).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(a < b).toBe(true);
    expect(b < c).toBe(true);
    expect(new Set([a, b, c]).size).toBe(3);
  });
});
