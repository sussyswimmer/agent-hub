// Phase 7 acceptance (§10) for the half a person touches: setting a ward, reading what it will
// do, standing it down, and the warning in front of quitting.
//
// The schedule arithmetic is Rust and is tested there against a real clock, across missed
// windows and weekly wards, without waiting for any of it.
import { expect, test } from "@playwright/test";

type Page = import("@playwright/test").Page;

async function openWards(page: Page) {
  await page.goto("/");
  await page.locator('[data-familiar="astrolabe"]').click();
  await page.locator('[data-tab="wards"]').click();
  await expect(page.getByTestId("wards")).toBeVisible();
}

test("a familiar with no wards is told what one is for", async ({ page }) => {
  // §3: an empty state is an invitation, not a blank panel.
  await openWards(page);
  await expect(page.getByTestId("wards-empty")).toContainText("without you");
});

test("setting a ward needs both a schedule and something to do", async ({ page }) => {
  await openWards(page);
  const set = page.getByTestId("ward-set");
  await expect(set).toHaveAttribute("data-blocked", "true");

  await page.getByTestId("ward-cron").fill("0 9 * * 1");
  await expect(set).toHaveAttribute("data-blocked", "true");

  await page.getByTestId("ward-prompt").fill("Plan the week.");
  await expect(set).not.toHaveAttribute("data-blocked", "true");
});

test("the schedule is shown in words before it is set", async ({ page }) => {
  // A crontab expression is not something most people read fluently, and a ward that fires at
  // the wrong hour every day for a month is an expensive typo.
  await openWards(page);
  const cron = page.getByTestId("ward-cron");
  const words = page.getByTestId("ward-in-words");

  await cron.fill("0 9 * * 1");
  await expect(words).toHaveText("every Monday at 09:00");
  await cron.fill("30 6 * * *");
  await expect(words).toHaveText("every day at 06:30");
  await cron.fill("0 17 * * 1-5");
  await expect(words).toHaveText("every weekday at 17:00");
  await cron.fill("*/15 * * * *");
  await expect(words).toHaveText("every 15 minutes");
});

test("a schedule that cannot be read is refused, and says what to write", async ({ page }) => {
  // Storing it would mean failing silently once a minute for ever, with nothing on screen.
  await openWards(page);
  await page.getByTestId("ward-cron").fill("every tuesday please");
  await page.getByTestId("ward-prompt").fill("Plan the week.");
  await page.getByTestId("ward-set").click();

  const error = page.getByTestId("ward-error");
  await expect(error).toContainText("five");
  await expect(error).toContainText("0 9 * * 1");
  await expect(page.locator("[data-ward]")).toHaveCount(0);
});

test("a ward keeps its prompt exactly as written", async ({ page }) => {
  // §6.7's first rule: sent verbatim, every run. A ward is a thing you set up and stop thinking
  // about, and that is only safe if what it sends next month is what you read when you wrote it.
  await openWards(page);
  const prompt = "Plan the week.\n\n  Keep Tuesday clear.";
  await page.getByTestId("ward-cron").fill("0 9 * * 1");
  await page.getByTestId("ward-prompt").fill(prompt);
  await page.getByTestId("ward-set").click();

  const ward = page.locator("[data-ward]").first();
  await expect(ward.locator("[data-ward-cron]")).toHaveText("0 9 * * 1");
  expect(await ward.locator("[data-ward-prompt]").innerText()).toBe(prompt);
  // And the form empties, so the next ward is not a half-edited copy of the last.
  await expect(page.getByTestId("ward-cron")).toHaveValue("");
});

test("a ward can be stood down without being dismissed", async ({ page }) => {
  // Disabled is not deleted: §6.7's ward carries an `enabled` flag precisely so a thing you set
  // up once can be paused without being rebuilt from memory.
  await openWards(page);
  await page.getByTestId("ward-cron").fill("0 9 * * 1");
  await page.getByTestId("ward-prompt").fill("Plan the week.");
  await page.getByTestId("ward-set").click();

  const ward = page.locator("[data-ward]").first();
  const toggle = ward.locator("[data-ward-toggle]");
  await expect(toggle).toHaveText("standing");
  await toggle.click();
  await expect(ward.locator("[data-ward-toggle]")).toHaveText("stood down");
  await expect(page.locator("[data-ward]")).toHaveCount(1);

  await ward.locator("[data-ward-delete]").click();
  await expect(page.locator("[data-ward]")).toHaveCount(0);
});

test("each familiar's wards are its own", async ({ page }) => {
  await openWards(page);
  await page.getByTestId("ward-cron").fill("0 9 * * 1");
  await page.getByTestId("ward-prompt").fill("Plan the week.");
  await page.getByTestId("ward-set").click();
  await expect(page.locator("[data-ward]")).toHaveCount(1);

  await page.locator('[data-familiar="vellum"]').click();
  await page.locator('[data-tab="wards"]').click();
  await expect(page.getByTestId("wards-empty")).toBeVisible();
});

test("quitting with a familiar working warns, and names it", async ({ page }) => {
  // §6.7: "Quit is explicit ... and it warns if summonings are live." The warning is the only
  // place the cost is visible, so it says whose work is about to be thrown away.
  await page.goto("/");
  await page.locator('[data-tab="terminal"]').click();
  await page.getByTestId("terminal-toggle").click();
  await expect(page.getByTestId("terminal-pane")).toHaveAttribute("data-status", "live");

  await page.evaluate(() => dispatchEvent(new Event("grimoire:quit-requested")));
  const warning = page.getByTestId("quit-warning");
  await expect(warning).toBeVisible();
  await expect(page.getByTestId("quit-who")).toContainText("Vellum is still working");

  // Staying puts it away and changes nothing.
  await page.getByTestId("quit-stay").click();
  await expect(warning).toHaveCount(0);
  await expect(page.getByTestId("terminal-pane")).toHaveAttribute("data-status", "live");
});

test("quitting with nothing running does not ask", async ({ page }) => {
  // A confirmation nobody needs is one everybody learns to click through.
  await page.goto("/");
  let quit = false;
  await page.exposeFunction("grimoireQuit", () => {
    quit = true;
  });
  await page.evaluate(() => {
    addEventListener("grimoire:quit", () => (window as unknown as { grimoireQuit: () => void }).grimoireQuit());
    dispatchEvent(new Event("grimoire:quit-requested"));
  });

  await expect(page.getByTestId("quit-warning")).toHaveCount(0);
  await expect.poll(() => quit).toBe(true);
});
