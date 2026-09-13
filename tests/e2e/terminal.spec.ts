// Phase 1 acceptance for the front-end half: the terminal mounts, carries typed input, shows
// what comes back, survives a flood and a resize, and ends cleanly.
//
// Driven against the mock backend, which stands a fake pty behind the same IPC surface the
// real one uses. That exercises every line of the component and the channel decoding without
// needing an engine installed; the pty itself is covered by the Rust suite.
import { expect, test } from "@playwright/test";

/** Open Vellum's terminal tab and wait for xterm to have painted. */
async function openTerminal(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.locator('[data-tab="terminal"]').click();
  await expect(page.getByTestId("xterm-host")).toBeVisible();
  // xterm paints to a canvas under the WebGL renderer, so there is no text in the DOM to read.
  // Its accessibility tree is the mirror of the buffer, and the only route in — for a screen
  // reader and for this test alike.
  await expect(page.locator(".xterm-accessibility")).toBeAttached();
}

const screen = (page: import("@playwright/test").Page) =>
  page.locator(".xterm-accessibility").innerText();

test("the terminal summons, echoes what you type, and ends when banished", async ({ page }) => {
  await openTerminal(page);
  const pane = page.getByTestId("terminal-pane");
  await expect(pane).toHaveAttribute("data-status", "dormant");

  await page.getByTestId("terminal-toggle").click();
  await expect(pane).toHaveAttribute("data-status", "live");
  await expect.poll(() => screen(page)).toContain("Grimoire mock terminal");

  // Typed input goes out as bytes and comes back as output: the round trip the pane exists for.
  await page.locator(".xterm-helper-textarea").fill("");
  await page.keyboard.type("hello-from-the-terminal");
  await expect.poll(() => screen(page)).toContain("hello-from-the-terminal");

  await page.keyboard.press("Enter");
  await expect.poll(() => screen(page)).toContain("hello-from-the-terminal");

  // The button is the verb in the result (§3): Summon became Banish.
  await expect(page.getByTestId("terminal-toggle")).toHaveText("Banish");
  await page.getByTestId("terminal-toggle").click();
  await expect(pane).toHaveAttribute("data-status", "ended");
  // Beside the button, not in the buffer: the engine redraws the buffer as it dies and wipes
  // anything appended there. Found by watching a real engine exit in the running application.
  await expect(page.getByTestId("terminal-note")).toContainText("the summoning ended");
});

test("a flood does not freeze the interface", async ({ page }) => {
  await openTerminal(page);
  await page.getByTestId("terminal-toggle").click();
  await expect(page.getByTestId("terminal-pane")).toHaveAttribute("data-status", "live");

  await page.keyboard.type("flood");
  await page.keyboard.press("Enter");

  // The real assertion is not "the text arrived" but "the page still answers". A frozen
  // webview cannot run this evaluate, and cannot switch tabs.
  await expect
    .poll(async () => page.evaluate(() => document.querySelectorAll(".xterm-accessibility").length), {
      timeout: 15_000,
    })
    .toBe(1);
  await page.locator('[data-tab="outputs"]').click();
  await expect(page.getByTestId("tabpanel")).toContainText("Outputs arrive");
});

test("switching familiars does not show one familiar's scrollback under another's name", async ({ page }) => {
  await openTerminal(page);
  await page.getByTestId("terminal-toggle").click();
  await expect.poll(() => screen(page)).toContain("vellum");

  await page.locator('[data-familiar="sconce"]').click();
  await expect(page.getByTestId("pane-header")).toContainText("Sconce");
  // The tab survives the switch — flicking between two terminals is the point of the app —
  // but the terminal itself does not: a fresh one, dormant, with none of Vellum's scrollback.
  await expect(page.getByTestId("terminal-pane")).toHaveAttribute("data-status", "dormant");
  expect(await screen(page)).not.toContain("vellum");
});
