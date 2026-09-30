// Phase 4 acceptance (§10) for the interface: the seal queue, its three answers, and the badge.
//
// The gate itself lives in Rust and is tested there, end to end through a real socket and
// against a real engine. What this covers is the half a person touches: that a waiting request
// is visible, says exactly what it is, and cannot be answered twice.
import { expect, test } from "@playwright/test";

type Page = import("@playwright/test").Page;

/** Give Astrolabe a commission and summon it, which is what raises a request in the mock. */
async function raiseOne(page: Page) {
  await page.goto("/");
  await page.locator('[data-familiar="astrolabe"]').click();
  await expect(page.getByTestId("pane-header")).toContainText("Astrolabe");

  await page.locator('[data-tab="commission"]').click();
  await page.getByTestId("intake-prompt").fill("Plan the week.");
  await page.locator('[data-field="horizon"] select').selectOption("this week");
  // One press: Summon and start summons it in the terminal with the commission in hand.
  await page.getByTestId("intake-submit").click();
  await expect(page.getByTestId("terminal-pane")).toHaveAttribute("data-status", "live");
}

test("the rail counts what is waiting, even before the queue is opened", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-seal-count]")).toHaveAttribute("data-seal-count", "0");
  await expect(page.getByTestId("seal-rail")).toContainText("none waiting");

  await raiseOne(page);
  await expect(page.locator("[data-seal-count]")).toHaveAttribute("data-seal-count", "1");
  await expect(page.getByTestId("seal-rail")).toContainText("1 waiting");
});

test("a request shows the familiar, the exact action, the reason, and what it would write", async ({ page }) => {
  // §6.4: "Each request shows the familiar, the exact action, the exact target path or command,
  // and a diff where one applies."
  await raiseOne(page);
  await page.getByTestId("seal-rail").click();
  await expect(page.getByTestId("seals")).toBeVisible();

  const request = page.locator("[data-seal]").first();
  await expect(request).toContainText("Astrolabe");
  await expect(request.locator("[data-seal-action]")).toContainText("~/work/planning/week.md");
  await expect(request.locator("[data-seal-reason]")).toContainText("propose");
  await expect(request.locator("[data-seal-preview]")).toContainText("Monday: the swimming essay.");
  await expect(request.locator("[data-seal-kind]")).toContainText("write");
});

test("all three answers are offered, and answering clears the request", async ({ page }) => {
  await raiseOne(page);
  await page.getByTestId("seal-rail").click();

  for (const answer of ["sealed", "sealed_always", "refused"]) {
    await expect(page.locator(`[data-seal-button="${answer}"]`)).toBeVisible();
  }

  await page.locator('[data-seal-button="refused"]').click();
  await expect(page.getByTestId("seals-empty")).toContainText("Nothing is waiting on you");
  await expect(page.locator("[data-seal-count]")).toHaveAttribute("data-seal-count", "0");
});

test("sealing it also clears it, and the badge follows", async ({ page }) => {
  await raiseOne(page);
  await page.getByTestId("seal-rail").click();
  await page.locator('[data-seal-button="sealed"]').click();

  await expect(page.locator("[data-seal]")).toHaveCount(0);
  await expect(page.locator("[data-seal-count]")).toHaveAttribute("data-seal-count", "0");
});

test("the queue says so when nothing is waiting, rather than showing an empty box", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("seal-rail").click();
  await expect(page.getByTestId("seals-empty")).toContainText("Familiars stop here");
});

test("opening the queue does not lose the familiar you were looking at", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-familiar="sconce"]').click();
  await page.getByTestId("seal-rail").click();
  await expect(page.getByTestId("seals")).toBeVisible();

  // Clicking it again goes back, and Sconce is still the one selected.
  await page.getByTestId("seal-rail").click();
  await expect(page.getByTestId("pane-header")).toContainText("Sconce");
});

test("the seal queue and the ledger do not fight over the window", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("ledger-toggle").click();
  await expect(page.getByTestId("ledger-empty")).toBeVisible();

  await page.getByTestId("seal-rail").click();
  await expect(page.getByTestId("seals")).toBeVisible();
  await expect(page.getByTestId("ledger-empty")).toHaveCount(0);

  await page.getByTestId("ledger-toggle").click();
  await expect(page.getByTestId("ledger-empty")).toBeVisible();
  await expect(page.getByTestId("seals")).toHaveCount(0);
});

test("every part of the window talks to the same backend", async ({ page }) => {
  // A regression, and a subtle one. `backend()` used to cache the resolved value, so two callers
  // arriving before the first construction finished each built one and the second won — leaving
  // whoever captured the first talking to an orphan. It showed up here as a badge that never
  // moved: the rail was subscribed to one backend while the terminal summoned on another.
  //
  // The observable property is that a change made through one part of the window is seen by
  // another part that never asked for it.
  await raiseOne(page);

  // The rail was never opened, and its count still knows.
  await expect(page.locator("[data-seal-count]")).toHaveAttribute("data-seal-count", "1");

  // Answer it in the queue; the rail follows without being told twice.
  await page.getByTestId("seal-rail").click();
  await page.locator('[data-seal-button="sealed"]').click();
  await expect(page.locator("[data-seal-count]")).toHaveAttribute("data-seal-count", "0");
});
