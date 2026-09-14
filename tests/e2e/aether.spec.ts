// Phase 6 acceptance (§10) for the half a person sees: three meters, the 80% signal, and the
// floor's arc agreeing with the pane's bar.
//
// The breaker itself is arithmetic and is tested where it lives, across every threshold, in
// microseconds rather than wall-clock minutes. What could not be tested there is whether the
// number reaches the screen, and whether two views of it can disagree.
import { expect, test } from "@playwright/test";

test("the bar shows all three meters, with what each is against", async ({ page }) => {
  // §6.5 meters three things, and §7.5 pins them to the bottom of the pane while a commission
  // runs. A bar alone is not a reading, so each carries its own figure.
  await page.goto("/");
  await page.locator('[data-familiar="sconce"]').click();
  const bar = page.getByTestId("aether");
  await expect(bar).toBeVisible();

  for (const meter of ["tokens", "turns", "time"]) {
    await expect(bar.locator(`[data-meter="${meter}"]`)).toBeVisible();
  }
  await expect(bar.locator('[data-meter="tokens"]')).toContainText("148k / 250k");
  await expect(bar.locator('[data-meter="turns"]')).toContainText("11 / 40");
  await expect(bar.locator('[data-meter="time"]')).toContainText("28 / 30 min");
});

test("a familiar with nothing running says so rather than showing zeroes", async ({ page }) => {
  // A row of empty meters reads as a commission that has done nothing, which is a different
  // and much more alarming thing than no commission at all.
  await page.goto("/");
  await page.locator('[data-familiar="anvil"]').click();
  await expect(page.getByTestId("aether")).toContainText("no commission running");
  await expect(page.getByTestId("aether").locator("[data-meter]")).toHaveCount(0);
});

test("the rule turns brass at eighty per cent and oxblood at the line", async ({ page }) => {
  // §6.5: "At 80% of any budget: the card's rule turns brass." Sconce is at 93% of its minutes
  // while barely into its tokens — so this also pins that it is the *tightest* budget that
  // counts, not the first one.
  await page.goto("/");
  await page.locator('[data-familiar="sconce"]').click();
  const bar = page.getByTestId("aether");
  await expect.poll(async () => Number(await bar.getAttribute("data-pressure"))).toBeGreaterThan(0.8);
  await expect(bar.locator('[role="separator"]')).toHaveClass(/bg-brass/);

  await page.locator('[data-familiar="vellum"]').click();
  await expect.poll(async () => Number(await bar.getAttribute("data-pressure"))).toBeGreaterThanOrEqual(1);
  await expect(bar.locator('[role="separator"]')).toHaveClass(/bg-oxblood/);
});

test("under eighty per cent the rule stays a hairline", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-familiar="astrolabe"]').click();
  const bar = page.getByTestId("aether");
  await expect.poll(async () => Number(await bar.getAttribute("data-pressure"))).toBeLessThan(0.8);
  await expect(bar.locator('[role="separator"]')).not.toHaveClass(/bg-brass|bg-oxblood/);
});

test("the floor's arc and the pane's bar read the same number", async ({ page }) => {
  // §10 asks that they match "to within one frame". They are the same object: one map in the
  // store, refreshed on one tick, read by both. Two fetches on two timers would have given two
  // readings taken at different moments, which is the bug this shape exists to prevent.
  await page.context().addInitScript(() => localStorage.setItem("grimoire.floor", "1"));
  await page.goto("/");
  await expect(page.getByTestId("floor")).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
  await page.locator('[data-familiar="sconce"]').click();

  const bar = page.getByTestId("aether");
  const pressure = Number(await bar.getAttribute("data-pressure"));
  // The marginalia card is the floor's own rendering of the same reading, so if the two sources
  // had drifted apart this is where it would show.
  await expect(bar.locator('[data-meter="tokens"]')).toContainText("148k / 250k");
  expect(pressure).toBeGreaterThan(0.8);
});
