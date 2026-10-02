// Phase 3 acceptance (§10) for the interface: the queue is visible, and every figure of money
// in the ledger says it is an estimate.
import { expect, test } from "@playwright/test";

type Page = import("@playwright/test").Page;

/**
 * Place a commission on the currently selected familiar. Queued for later by default, which is
 * what these tests are about; `start` presses the main button instead.
 */
async function place(page: Page, prompt: string, fill: Record<string, string> = {}, start = false) {
  await page.locator('[data-tab="commission"]').click();
  await expect(page.getByTestId("intake")).toBeVisible();
  await page.getByTestId("intake-prompt").fill(prompt);
  for (const [field, value] of Object.entries(fill)) {
    const select = page.locator(`[data-field="${field}"] select`);
    if (await select.count()) await select.selectOption(value);
    else await page.locator(`[data-field="${field}"] input, [data-field="${field}"] textarea`).fill(value);
  }
  await page.getByTestId(start ? "intake-submit" : "intake-queue").click();
}

const VELLUM = { piece: "The swimming essay", mode: "structural" };

test("the form empties after a commission is placed", async ({ page }) => {
  // Found by placing two in a row in the running application: the second carried the first's
  // text, so the queue showed one prompt with another stuck on the end of it.
  await page.goto("/");
  await place(page, "First.", VELLUM);

  await expect(page.getByTestId("intake-prompt")).toHaveValue("");
  await expect(page.locator('[data-field="piece"] input')).toHaveValue("");
  await expect(page.locator('[data-field="mode"] select')).toHaveValue("");

  await place(page, "Second.", VELLUM);
  const prompts = await page.getByTestId("queue").locator("[data-commission]").allInnerTexts();
  expect(prompts.some((t) => t.includes("Second.") && !t.includes("First."))).toBe(true);
});

test("a commission is placed, queued, and visible straight away", async ({ page }) => {
  await page.goto("/");
  await place(page, "Tighten the opening.", VELLUM);

  const queue = page.getByTestId("queue");
  await expect(queue).toBeVisible();
  await expect(queue.locator("[data-commission]")).toHaveCount(1);
  await expect(queue.locator("[data-commission]").first()).toContainText("Tighten the opening.");
  await expect(queue.locator("[data-commission]").first()).toHaveAttribute("data-status", "queued");
  // §6.2 wants the queue visible, so the one at the front says it is next rather than only that
  // it is waiting.
  await expect(queue.getByText("next")).toBeVisible();
});

test("a familiar runs one commission and the rest queue behind it, visibly", async ({ page }) => {
  // §10 Phase 3: "a familiar with a running commission queues the next one visibly rather than
  // running both."
  await page.goto("/");
  await place(page, "First.", VELLUM);
  await place(page, "Second.", VELLUM);
  await place(page, "Third.", VELLUM);

  const queue = page.getByTestId("queue");
  await expect(queue.locator("[data-commission]")).toHaveCount(3);
  await expect(queue.locator('[data-status="queued"]')).toHaveCount(3);

  // Summoning takes the oldest and starts it.
  await page.locator('[data-tab="terminal"]').click();
  await page.getByTestId("terminal-toggle").click();
  await expect(page.getByTestId("terminal-pane")).toHaveAttribute("data-status", "live");

  await page.locator('[data-tab="commission"]').click();
  await expect(queue.locator('[data-status="running"]')).toHaveCount(1);
  await expect(queue.locator('[data-status="running"]')).toContainText("First.");

  // The other two are still waiting, and say where they are in the line rather than merely that
  // they exist. Exactly one of them is next.
  await expect(queue.locator('[data-status="queued"]')).toHaveCount(2);
  await expect(queue.getByText("next")).toHaveCount(1);
  await expect(queue.getByText("2 in line")).toBeVisible();
});

test("a commission that was running ends when its familiar is banished", async ({ page }) => {
  // Banished rather than done: the work stopped, and nobody said it finished.
  await page.goto("/");
  await place(page, "Interrupted work.", VELLUM);

  await page.locator('[data-tab="terminal"]').click();
  await page.getByTestId("terminal-toggle").click();
  await expect(page.getByTestId("terminal-pane")).toHaveAttribute("data-status", "live");
  await page.getByTestId("terminal-toggle").click();
  await expect(page.getByTestId("terminal-pane")).toHaveAttribute("data-status", "ended");

  await page.locator('[data-tab="commission"]').click();
  await expect(page.getByTestId("queue").locator('[data-status="banished"]')).toHaveCount(1);
});

test("each familiar has its own queue", async ({ page }) => {
  await page.goto("/");
  await place(page, "For Vellum.", VELLUM);

  await page.locator('[data-familiar="sconce"]').click();
  await expect(page.getByTestId("pane-header")).toContainText("Sconce");
  // Sconce has none of Vellum's, and no queue at all until it is given something.
  await expect(page.getByTestId("queue")).toHaveCount(0);

  await place(page, "For Sconce.", { question: "What is the question?", shape: "brief" });
  await expect(page.getByTestId("queue").locator("[data-commission]")).toHaveCount(1);
  await expect(page.getByTestId("queue")).toContainText("For Sconce.");
  await expect(page.getByTestId("queue")).not.toContainText("For Vellum.");
});

test("the ledger says estimated beside every figure of money", async ({ page }) => {
  // §6.9: "Estimated cost is labelled as estimated everywhere it appears. Never display it as a
  // settled number." This is the test that keeps that true as the view grows.
  await page.goto("/");
  await place(page, "Something that costs.", VELLUM);

  // Run it and stop it, so there is usage to roll up.
  await page.locator('[data-tab="terminal"]').click();
  await page.getByTestId("terminal-toggle").click();
  await expect(page.getByTestId("terminal-pane")).toHaveAttribute("data-status", "live");
  await page.getByTestId("terminal-toggle").click();
  await expect(page.getByTestId("terminal-pane")).toHaveAttribute("data-status", "ended");

  await page.getByTestId("ledger-toggle").click();
  await expect(page.getByTestId("ledger")).toBeVisible();

  // Spend by familiar and by day, both present (§6.9).
  await expect(page.locator('[data-spend-familiar="vellum"]')).toBeVisible();
  await expect(page.locator("[data-spend-day]")).toHaveCount(1);

  // A non-zero total, which is what makes this worth checking at all.
  await expect(page.getByTestId("ledger-total")).toContainText("est.");
  const total = await page.getByTestId("ledger-total").innerText();
  expect(Number.parseFloat(total.replace(/[^0-9.]/g, ""))).toBeGreaterThan(0);

  // And now the rule itself: every rendered money value carries the qualifier. Nothing in the
  // view may show a bare number.
  const moneys = await page.locator("[data-estimated]").allInnerTexts();
  expect(moneys.length).toBeGreaterThan(2);
  for (const m of moneys) {
    expect(m).toContain("est.");
    expect(m).toMatch(/^~\$/);
  }
});

test("the ledger is empty before anything has been done, and says so", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("ledger-toggle").click();
  await expect(page.getByTestId("ledger-empty")).toContainText("Nothing in the ledger yet");
});

test("the codex shows what a familiar has written, and an invitation when it has not", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-tab="codex"]').click();
  await expect(page.getByTestId("codex")).toBeVisible();
  await expect(page.getByTestId("codex")).toContainText("Dislikes the word");
  await expect(page.locator("[data-codex-words]")).toContainText("words");

  // A familiar that has written nothing gets an invitation rather than an empty box (§3).
  await page.locator('[data-familiar="anvil"]').click();
  await expect(page.getByTestId("codex-empty")).toContainText("has not written anything down yet");
});

test("one press summons a resting familiar and hands it the commission", async ({ page }) => {
  // Found by the owner on first use: nothing said how to get a familiar to do anything. The
  // commission tab queued work silently, and the header's Summon only changed tab.
  await page.goto("/");
  await expect(page.getByTestId("now-text")).toContainText("Vellum is resting");
  await expect(page.getByTestId("intake-submit")).toHaveText("Summon and start");

  await place(page, "Tighten the opening.", VELLUM, true);

  // It opened the terminal, summoned, and the commission arrived as the first thing said.
  await expect(page.locator('[data-tab="terminal"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("terminal-pane")).toHaveAttribute("data-status", "live");
  await expect(page.locator(".xterm-accessibility")).toContainText("Tighten the opening.");
  // Not reattached to something else: this terminal is the one that summoned it.
  await expect(page.locator(".xterm-accessibility")).not.toContainText("reattached");

  await page.locator('[data-tab="commission"]').click();
  await expect(page.getByTestId("queue").locator('[data-status="running"]')).toContainText("Tighten the opening.");
  await expect(page.getByTestId("now-text")).toContainText("Vellum is working on");
  await expect(page.getByTestId("intake-submit")).toHaveText("Add to queue");
});

test("a summoned familiar starts at once, and mark done hands it the next", async ({ page }) => {
  await page.goto("/");
  await place(page, "First.", VELLUM, true);
  await expect(page.getByTestId("terminal-pane")).toHaveAttribute("data-status", "live");

  // Busy: the next waits, and says why.
  await place(page, "Second.", VELLUM, true);
  const queue = page.getByTestId("queue");
  await expect(queue.locator('[data-status="queued"]')).toContainText("Second.");
  await expect(page.getByTestId("commission-notice")).toContainText("when you mark the current one done");

  // Done: the first is done — not banished — and the second is running in the same summoning.
  await page.getByTestId("commission-done").click();
  await expect(page.getByTestId("commission-notice")).toContainText("started on the next one");
  await expect(queue.locator('[data-status="done"]')).toContainText("First.");
  await expect(queue.locator('[data-status="running"]')).toContainText("Second.");

  // And once the queue is empty, done leaves it summoned and free, and Start starts at once.
  await page.getByTestId("commission-done").click();
  await expect(page.getByTestId("now-text")).toContainText("summoned and free");
  await expect(page.getByTestId("intake-submit")).toHaveText("Start");
  await place(page, "Third.", VELLUM, true);
  await expect(page.getByTestId("commission-notice")).toContainText("Started.");
  await expect(queue.locator('[data-status="running"]')).toContainText("Third.");

  await page.locator('[data-tab="terminal"]').click();
  await expect(page.locator(".xterm-accessibility")).toContainText("Third.");
});

test("the header's Summon summons, and then offers to banish", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("summon")).toHaveText(/^Summon\b/);
  await page.getByTestId("summon").click();
  await expect(page.getByTestId("terminal-pane")).toHaveAttribute("data-status", "live");
  await expect(page.getByTestId("summon")).toHaveText(/^Banish\b/);

  await page.getByTestId("summon").click();
  await expect(page.getByTestId("terminal-pane")).toHaveAttribute("data-status", "ended");
  await expect(page.getByTestId("summon")).toHaveText(/^Summon\b/);
});
