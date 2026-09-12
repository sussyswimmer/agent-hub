// Phase 1 smoke against `vite dev` with the mock backend (VITE_IPC_MOCK=1).
import { expect, test } from "@playwright/test";

test("sidebar lists agents with an error badge for the broken one", async ({ page }) => {
  await page.goto("/");
  const rows = page.locator('[data-testid="agent-list"] [data-agent]');
  await expect(rows).toHaveCount(6);
  await expect(page.locator('[data-agent="research"]')).toHaveAttribute("aria-current", "page");
  await expect(page.locator('[data-agent="broken"] [data-error-badge]')).toBeVisible();
  await expect(page.locator('[data-agent="scout"] [data-badge="2"]')).toBeVisible();
  await expect(page.locator('[data-testid="workspace-header"]')).toContainText("Research");
  await expect(page.locator('[data-testid="preflight-banner"]')).toHaveCount(0);
});

test("a task typed into Chat streams tool steps and ends with a result card", async ({ page }) => {
  await page.goto("/");
  const composer = page.getByLabel("Task");
  await composer.fill("What is FSRS?");
  await composer.press("Control+Enter");
  const card = page.locator('[data-testid="run-card"]').first();
  await expect(card).toContainText("What is FSRS?");
  await expect(card).toHaveAttribute("data-status", "running", { timeout: 5_000 });
  await expect(card.locator('[data-row-kind="tool"]').first()).toContainText("Searching the web", { timeout: 5_000 });
  await expect(card).toHaveAttribute("data-status", "done", { timeout: 15_000 });
  await expect(card.locator('[data-testid="result-card"]')).toHaveAttribute("data-outcome", "done");
  await expect(card.locator('[data-testid="result-card"]')).toContainText("Produced brief.md");
  await expect(card).toContainText("9 turns");
  await expect(card).toContainText("$0.41");
  // Tool rows flipped from running to done via tool_result merge.
  await expect(card.locator('[data-row-kind="tool"][data-row-state="running"]')).toHaveCount(0);
  await expect(page.locator('[data-agent="research"] [data-state="idle"]')).toBeVisible();
});

test("broken agent cannot run", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-agent="broken"]').click();
  await expect(page.locator('[data-testid="workspace-header"]')).toContainText("invalid agent.md");
  await expect(page.getByLabel("Task")).toBeDisabled();
  await expect(page.locator('[data-testid="run-button"]')).toBeDisabled();
});

test("keyboard switches views and Activity lists runs", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-testid="agent-list"] [data-agent]')).toHaveCount(6);
  await page.keyboard.press("Control+2");
  await expect(page.locator('[data-testid="workspace-header"]')).toContainText("College");
  await page.keyboard.press("Control+0");
  await expect(page.getByRole("heading", { name: "Approvals" })).toBeVisible();
  await page.locator('[data-nav="activity"]').click();
  await expect(page.locator('[data-testid="activity-table"] tbody tr')).toHaveCount(1);
  await expect(page.locator('[data-testid="activity-table"]')).toContainText("Basel");
  await page.keyboard.press("Control+,");
  await expect(page.locator('[data-testid="settings"]')).toContainText("mock");
  await expect(page.locator('[data-testid="settings"]')).toContainText("2.1.268");
});

test("queue tab shows schedules and Run now starts a scheduled run", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-agent="scout"]').click();
  await page.locator('[data-tab="queue"]').click();
  await expect(page.locator('[data-schedule]')).toHaveCount(2);
  await expect(page.locator('[data-schedule="deadline-watch"]')).toContainText("db:deadline_watch");
  await expect(page.locator('[data-schedule] button')).toHaveCount(1); // db-only schedules have no Run now
  await page.locator('[data-schedule="weekly-sweep"] button').click();
  await expect(page.locator('[data-queue-run]').first()).toContainText("weekly sweep", { timeout: 5_000 });
  await page.locator('[data-tab="chat"]').click();
  await expect(page.locator('[data-testid="run-card"]').first()).toContainText("scheduled:weekly-sweep");
  await page.locator('[data-agent="research"]').click();
  await page.locator('[data-tab="board"]').click();
  await expect(page.getByText("This board arrives in Phase 7")).toBeVisible();
});

test("dark and light appearance both apply the token set", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const dark = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--label").trim());
  expect(dark).toBe("#f5f5f7");
  await page.emulateMedia({ colorScheme: "light" });
  const light = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--label").trim());
  expect(light).toBe("#1d1d1f");
  await expect(page.locator('[data-testid="sidebar"]')).toBeVisible();
});
