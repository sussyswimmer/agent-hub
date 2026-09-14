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

test("a familiar you walk away from is still live when you come back", async ({ page }) => {
  // The regression this exists for. The pane is unmounted when you look at another familiar,
  // so it remembers nothing — but the summoning outlives it. The pane used to come back
  // reading "dormant" while the engine was still running, which left the familiar stranded:
  // the button offered to summon it and the backend refused, already summoned, so there was
  // no way to banish it from the window at all. Found by clicking away from a live Tally and
  // back, with the real `claude` still on the process table.
  await openTerminal(page);
  await page.getByTestId("terminal-toggle").click();
  await expect(page.getByTestId("terminal-pane")).toHaveAttribute("data-status", "live");
  await expect.poll(() => screen(page)).toContain("Grimoire mock terminal");

  await page.locator('[data-familiar="sconce"]').click();
  await expect(page.getByTestId("pane-header")).toContainText("Sconce");

  await page.locator('[data-familiar="vellum"]').click();
  await expect(page.getByTestId("pane-header")).toContainText("Vellum");
  await expect(page.getByTestId("terminal-pane")).toHaveAttribute("data-status", "live");
  await expect(page.getByTestId("terminal-toggle")).toHaveText("Banish");

  // And it says plainly that the scrollback is not the whole story, rather than presenting a
  // near-empty buffer as if that were everything the familiar has done.
  await expect.poll(() => screen(page)).toContain("what came before is not shown");

  // Typing still reaches it: the input path is re-wired, not just the label. Clicking in
  // first because coming back to a familiar does not steal the keyboard — moving through the
  // roster with the arrow keys would be unusable if it did.
  await page.getByTestId("xterm-host").click();
  await page.keyboard.type("still-listening");
  await expect.poll(() => screen(page)).toContain("still-listening");

  // And it can now be banished, which was the part that was impossible.
  await page.getByTestId("terminal-toggle").click();
  await expect(page.getByTestId("terminal-pane")).toHaveAttribute("data-status", "ended");
});

test("pressing Summon before the backend has answered does not re-attach to it", async ({ page }) => {
  // The race the `summoning` ref in Terminal.tsx exists for. The pane asks the backend, on
  // mount, whether this familiar is already running. Press Summon while that question is in
  // flight and the answer comes back "yes" — because the summon that has just started is what
  // it found. The pane then wrote "reattached" over a terminal that had just started, and left
  // two `onData` handlers on the same xterm, so every keystroke reached the engine twice.
  //
  // It surfaced as two intermittent failures in a full-suite run and passed on every rerun of
  // this file alone, which is what a few milliseconds of window looks like from the outside.
  // Holding the question open makes it a certainty rather than a matter of load.
  await page.addInitScript(() => localStorage.setItem("grimoire.mock.attachDelay", "400"));
  await page.goto("/");
  await page.locator('[data-tab="terminal"]').click();
  await expect(page.getByTestId("xterm-host")).toBeVisible();

  await page.getByTestId("terminal-toggle").click();
  await expect(page.getByTestId("terminal-pane")).toHaveAttribute("data-status", "live");
  await expect.poll(() => screen(page)).toContain("Grimoire mock terminal");

  // Long enough for the held answer to land and do its damage.
  await expect.poll(() => screen(page), { timeout: 3000 }).not.toContain("reattached");

  // The half that a person would actually notice: one handler, so one copy of what is typed.
  await page.locator(".xterm-helper-textarea").fill("");
  await page.keyboard.type("abc");
  await expect.poll(() => screen(page)).toContain("abc");
  expect(await screen(page)).not.toContain("aabbcc");
});
