// Phase 5 acceptance (§10) for what a person can see and touch.
//
// The floor is WebGL, so there is nothing in the DOM to assert about the picture itself — the
// walls, the sigils and the walk are checked by looking at the running binary, which is the only
// place they are actually drawn the way they ship. What is checked here is everything that is
// *not* pixels: that it mounts, that it is the default, that it can be put away and remembers
// that, that clicking through it works, and that it says in words what it is showing.
import { expect, test } from "@playwright/test";

type Page = import("@playwright/test").Page;

// The suite as a whole opens on the roster, because a WebGL context per test costs this GPU-less
// runner more than every other test in the file put together. These tests are about the floor,
// so they turn it back on — which is the preference §8.7 asks be remembered, set the way the
// toggle sets it.
test.use({
  storageState: {
    cookies: [],
    origins: [
      { origin: "http://localhost:1420", localStorage: [{ name: "grimoire.floor", value: "1" }] },
    ],
  },
});

async function openFloor(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("floor")).toBeVisible();
  // Pixi builds asynchronously; nothing below means anything until it has.
  await expect(page.getByTestId("floor")).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
}

test("the floor is what the window opens on", async ({ page }) => {
  // §8: "The roster rail is the fallback for when you want a list; the floor is the default."
  await openFloor(page);
  await expect(page.getByTestId("floor-toggle")).toHaveAttribute("data-floor", "on");
});

test("the floor opens on its painted room and every portrait, and nothing throws", async ({ page }) => {
  // The first Higgsfield floor asked Pixi for a texture it had never loaded. The first sync
  // threw, nothing caught it, and the default view was an empty window — rail and all
  // (DECISIONS 0021). Every other test in this file waited on `data-ready` and timed out.
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openFloor(page);
  await expect(page.getByTestId("floor")).toHaveAttribute("data-painted", "true");
  await expect(page.getByTestId("floor")).toHaveAttribute("data-portraits", "5");
  await expect(page.getByTestId("roster")).toBeVisible();
  expect(errors).toEqual([]);
});

test("art that does not load leaves the drawn floor, not a blank window", async ({ page }) => {
  // The painting and the portraits are files, and a file can be missing. What is left is the
  // floor the plan draws in code, with every familiar still standing on it.
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Only the image fetches. Under Vite an asset `import` is itself a module request (`?import`)
  // that answers with the URL; failing that would fail the module graph, not the art.
  await page.route(
    (url) => url.pathname.includes("/assets/higgsfield/") && !url.search.includes("import"),
    (route) => route.abort(),
  );
  await openFloor(page);
  await expect(page.getByTestId("floor")).toHaveAttribute("data-painted", "false");
  await expect(page.getByTestId("floor")).toHaveAttribute("data-portraits", "0");
  await expect(page.getByTestId("floor-mirror")).toContainText("Astrolabe is waiting for your seal");
  // §3: and it says so, on the floor, rather than only in a console nobody opens.
  await expect(page.getByTestId("floor-art-missing")).toContainText("did not load");
  expect(errors).toEqual([]);
});

test("a floor whose renderer cannot start says why and offers the roster", async ({ page }) => {
  // In every packaged build until now, Pixi refused to start under the CSP, and the scene that
  // caught it offered to restore five familiars who were already in the rail (DECISIONS 0021).
  // Taking WebGL away is the nearest a browser comes to that machine.
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = () => null;
    Object.defineProperty(navigator, "gpu", { value: undefined });
  });
  await page.goto("/");
  const recovery = page.getByTestId("floor-recovery");
  await expect(recovery).toContainText("did not start", { timeout: 20_000 });
  await expect(recovery.locator(".floor-recovery__reason")).not.toBeEmpty();
  await expect(page.getByTestId("roster")).toBeVisible();
  await recovery.getByRole("button", { name: "Show the roster" }).click();
  await expect(page.getByTestId("floor-toggle")).toHaveAttribute("data-floor", "off");
});

test("the floor fills the pane until you choose someone", async ({ page }) => {
  // §8 calls the floor "the thing you open the app to look at". Opening on a 40% strip beneath
  // a familiar nobody picked is not that, so nothing is selected until something is picked.
  await openFloor(page);
  await expect(page.getByTestId("floor-slot")).toHaveAttribute("data-strip", "false");
  await expect(page.getByTestId("pane-header")).toHaveCount(0);
});

test("choosing a familiar keeps the floor in sight", async ({ page }) => {
  // §8.5: the right pane switches to that familiar, and the floor stays as a strip above it.
  await openFloor(page);
  await page.locator('[data-familiar="sconce"]').click();
  await expect(page.getByTestId("pane-header")).toContainText("Sconce");
  await expect(page.getByTestId("floor-slot")).toHaveAttribute("data-strip", "true");
  await expect(page.getByTestId("floor")).toBeVisible();
});

test("the floor can be put away, and it stays away", async ({ page }) => {
  // Starts on, because this file asks for it above.
  // §8.7 asks for the toggle and asks that it be remembered across restarts.
  await openFloor(page);
  await page.locator('[data-testid="floor-toggle"] [data-view="roster"]').click();
  await expect(page.getByTestId("floor")).toHaveCount(0);
  // Nobody had been chosen — the floor does not need anyone chosen. Putting it away has to
  // find someone, or the window is empty.
  await expect(page.getByTestId("pane-header")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("pane-header")).toBeVisible();
  await expect(page.getByTestId("floor")).toHaveCount(0);

  // And back, still remembered.
  await page.locator('[data-testid="floor-toggle"] [data-view="floor"]').click();
  await expect(page.getByTestId("floor")).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("floor")).toBeVisible();
});

test("the floor is mirrored in words for anyone who cannot see it", async ({ page }) => {
  // §8.7. A canvas is a blank rectangle to a screen reader, so this is the floor's real content.
  await openFloor(page);
  const mirror = page.getByTestId("floor-mirror");
  await expect(mirror).toHaveAttribute("aria-live", "polite");

  // §8.4's first question, answered first: is anything waiting on me?
  await expect(mirror).toContainText("Astrolabe is waiting for your seal");
  // And every familiar accounted for, by name and state.
  for (const name of ["Vellum", "Sconce", "Astrolabe", "Anvil", "Tally"]) {
    await expect(mirror).toContainText(name);
  }
  await expect(mirror).toContainText("dormant at the hearth");
});

test("the canvas takes the keyboard, and says what it is", async ({ page }) => {
  await openFloor(page);
  const canvas = page.getByTestId("floor-canvas");
  await expect(canvas).toHaveAttribute("tabindex", "0");
  await expect(canvas).toHaveAttribute("role", "application");
  // §8.5's Escape route has to be discoverable, so it is in the accessible name.
  await expect(canvas).toHaveAttribute("aria-label", /Escape/);
});

test("the floor does not push the window sideways", async ({ page }) => {
  // A canvas has a size of its own before it is told otherwise, and a flex child will not shrink
  // below its content unless it is told to. Both together propped the scriptorium open.
  await openFloor(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("every familiar is still reachable from the rail while the floor is up", async ({ page }) => {
  // §8.7: "The floor is never the only route to anything."
  await openFloor(page);
  await page.locator('[data-familiar="tally"]').click();
  await expect(page.getByTestId("pane-header")).toContainText("Tally");
  await expect(page.getByTestId("floor")).toBeVisible();
});

test("the seal queue and the ledger are still their own views with the floor up", async ({ page }) => {
  await openFloor(page);
  await page.getByTestId("seal-rail").click();
  await expect(page.getByTestId("seals")).toBeVisible();
  await expect(page.getByTestId("floor")).toHaveCount(0);

  await page.getByTestId("ledger-toggle").click();
  await expect(page.getByTestId("ledger-empty")).toBeVisible();
});

test("the dev state override is there to drive states nothing yet produces", async ({ page }) => {
  // §10 asks that `bound` and `stalled` render in this phase even though the breaker that
  // causes them is Phase 6. This is how they are driven — and it is behind `import.meta.env.DEV`,
  // so it is not in the packaged application.
  await openFloor(page);
  const panel = page.getByTestId("floor-override");
  await expect(panel).toBeVisible();
  await panel.locator("summary").click();
  await panel.locator('[data-override="vellum"]').selectOption("bound");

  // The mirror is the observable proof that the override reached the floor's own model.
  await expect(page.getByTestId("floor-mirror")).toContainText("Vellum, bound");
  await panel.locator('[data-override="anvil"]').selectOption("stalled");
  await expect(page.getByTestId("floor-mirror")).toContainText("Anvil, stalled");
});

test("a hidden floor renders nothing at all", async ({ page }) => {
  // §8.6: "A background floor must cost 0% CPU." Throttling is not the same thing — a ticker at
  // 20fps in a hidden tab is still sixty redraws a wasted second. The frame counter is the
  // ticker's own, so this is the measurement rather than an impression of one.
  await openFloor(page);
  const stats = page.getByTestId("floor-stats");
  await expect.poll(async () => Number(await stats.getAttribute("data-frames"))).toBeGreaterThan(0);

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(async () => stats.getAttribute("data-running")).toBe("false");

  const stopped = Number(await stats.getAttribute("data-frames"));
  await page.waitForTimeout(1200);
  expect(Number(await stats.getAttribute("data-frames"))).toBe(stopped);

  // And it comes back when you look at it again.
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(async () => Number(await stats.getAttribute("data-frames"))).toBeGreaterThan(stopped);
});

test("panning and zooming inside a band does not redraw the room", async ({ page }) => {
  // §8.6: the baked layer is re-made on a resize, or when the zoom crosses 0.9× where the labels
  // come and go — never on a pan. At one device pixel per CSS pixel the stage and the bake
  // disagreed about which side of 0.9 the floor was on, so every drag and every wheel notch
  // re-drew the whole plan. This runner is 1×, which is the case Retina hid (DECISIONS 0022).
  await openFloor(page);
  const stats = page.getByTestId("floor-stats");
  const bakes = async () => Number(await stats.getAttribute("data-bakes"));
  await expect.poll(bakes).toBeGreaterThan(0);
  await page.waitForTimeout(600); // the first resize lands after mount
  const settled = await bakes();

  const box = (await page.getByTestId("floor-canvas").boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height * 0.3;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(x + i * 12, y + i * 6);
  await page.mouse.up();
  // In, then back out to where it began, never below 0.9×: exp(60/400) a notch.
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -60);
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 60);
  await page.waitForTimeout(600); // the readout is written every 250ms
  expect(await bakes()).toBe(settled);

  // Crossing 0.9× is the one zoom that re-draws it, and it does so once.
  await page.mouse.wheel(0, 120);
  await expect.poll(bakes).toBe(settled + 1);
  await page.mouse.wheel(0, 60);
  await page.waitForTimeout(600);
  expect(await bakes()).toBe(settled + 1);
});

test("twelve familiars, five of them working, keeps drawing", async ({ page }) => {
  // §10 sets the budget at twelve familiars with five working, at 60fps. **That number cannot
  // honestly be taken here**: this runner has no GPU, WebGL falls back to a software
  // rasteriser, and any figure it produces measures the rasteriser rather than the floor. The
  // real measurement is one for the owner's machine, and it is listed as such in TASKS.md.
  //
  // What is worth asserting is what a software rasteriser cannot hide: that a crowded floor
  // still runs — twelve actors placed, five threads of ink redrawn per frame, and the ticker
  // still advancing rather than wedged.
  await page.goto("/?familiars=12");
  await expect(page.getByTestId("floor")).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
  await expect(page.getByTestId("floor-mirror")).toContainText("Gnomon");

  const stats = page.getByTestId("floor-stats");
  await expect.poll(async () => Number(await stats.getAttribute("data-frames")), { timeout: 15_000 })
    .toBeGreaterThan(0);

  const first = Number(await stats.getAttribute("data-frames"));
  await page.waitForTimeout(1500);
  expect(Number(await stats.getAttribute("data-frames"))).toBeGreaterThan(first);
});

test("with motion reduced, nothing walks and nothing spins", async ({ page }) => {
  // §8.7. The observable half in a browser test is that the floor still draws every familiar
  // and still says the same thing — the absence of the walk is checked by eye in the real
  // binary, where there is something to watch.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openFloor(page);
  await expect(page.getByTestId("floor-mirror")).toContainText("Astrolabe is waiting for your seal");
  const stats = page.getByTestId("floor-stats");
  await expect.poll(async () => Number(await stats.getAttribute("data-frames"))).toBeGreaterThan(0);
});

test("a familiar the breaker has bound reads as bound, not as one asking permission", async ({ page }) => {
  // §7.4 gives `bound` a brass chord across the ring and §8.3 keeps it at its own desk. Both
  // were drawn from the first day of Phase 5 and never once driven: every pending request read
  // as `awaiting-seal`, so a familiar the breaker had stopped for running out of aether stood
  // in the ward circle looking like one asking to write a file.
  //
  // The mirror is the floor's own text and the only assertable rendering of what it is showing.
  await openFloor(page);
  await page.locator('[data-familiar="tally"]').click();
  await page.locator('[data-tab="commission"]').click();
  await page.getByTestId("intake-prompt").fill("work out the sums");
  await page.getByTestId("intake-submit").click();

  await page.locator('[data-tab="terminal"]').click();
  await page.getByTestId("terminal-toggle").click();
  await expect(page.getByTestId("terminal-pane")).toHaveAttribute("data-status", "live");

  const mirror = page.getByTestId("floor-mirror");
  await expect(mirror).toContainText("Tally, bound");
  // And it is not reported as the thing §8.4 reserves for a question you have to answer.
  await expect(mirror).not.toContainText("Tally, waiting for your seal");
});
