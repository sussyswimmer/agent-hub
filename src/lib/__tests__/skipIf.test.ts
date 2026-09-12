import { describe, expect, test } from "bun:test";

import { shouldSkip } from "../skipIf";

const ctx = { memory: { default_citation_style: "Chicago", empty: "", list: [1] }, profile: { class_of: 2028 }, task: { graded: "yes", mode: "tracker" } };

describe("skipIf (mock)", () => {
  test("matches the Rust grammar", () => {
    expect(shouldSkip("memory.default_citation_style", ctx)).toBe(true);
    expect(shouldSkip("memory.empty", ctx)).toBe(false);
    expect(shouldSkip("memory.missing", ctx)).toBe(false);
    expect(shouldSkip("task.graded != 'yes'", ctx)).toBe(false);
    expect(shouldSkip("task.mode != 'essay_coach'", ctx)).toBe(true);
    expect(shouldSkip("profile.class_of == 2028", ctx)).toBe(true);
    expect(shouldSkip("!(task.graded == 'yes') || memory.list", ctx)).toBe(true);
    expect(shouldSkip("task.graded == 'no' && memory.list", ctx)).toBe(false);
    expect(shouldSkip("memory.x ==", ctx)).toBe(false);
    expect(shouldSkip("", ctx)).toBe(false);
  });
});
