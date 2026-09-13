// Phase 0 acceptance (§10), driven against `vite dev` with the mock backend.
import { expect, test } from "@playwright/test";

test("the scriptorium draws the §7.5 layout: 240px rail, roster, pane, seals, aether", async ({ page }) => {
  await page.goto("/");
  const rail = page.getByTestId("roster");
  await expect(rail).toBeVisible();
  expect((await rail.boundingBox())?.width).toBe(240);

  await expect(page.locator("[data-familiar]")).toHaveCount(5);
  await expect(page.locator('[data-familiar="vellum"]')).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("pane-header")).toContainText("Vellum");
  await expect(page.getByTestId("pane-header")).toContainText("quill");
  await expect(page.getByTestId("pane-header").locator("[data-workspace]")).toHaveText("~/work/essays");

  // Seals live at the bottom of the rail with a count (§7.5). Astrolabe is awaiting one.
  await expect(page.getByTestId("seal-rail")).toContainText("1 waiting");

  // §3: sentence case, no ALL-CAPS labels anywhere.
  const shouted = await page.evaluate(() =>
    Array.from(document.querySelectorAll("body *"))
      .filter((e) => e.children.length === 0 && (e.textContent ?? "").trim().length > 1)
      .filter((e) => getComputedStyle(e).textTransform === "uppercase")
      .map((e) => (e.textContent ?? "").trim()),
  );
  expect(shouted).toEqual([]);

  // Four tabs, aether pinned below the panel.
  await expect(page.getByRole("tab")).toHaveCount(4);
  for (const t of ["commission", "terminal", "outputs", "codex"]) {
    await expect(page.locator(`[data-tab="${t}"]`)).toBeVisible();
  }
  const panel = await page.getByTestId("tabpanel").boundingBox();
  const aether = await page.getByTestId("aether").boundingBox();
  expect(aether!.y).toBeGreaterThan(panel!.y);
});

test("the rail fits the viewport at both sizes and nothing scrolls sideways", async ({ page }, testInfo) => {
  await page.goto("/");
  const { width, height } = testInfo.project.use.viewport!;
  const rail = (await page.getByTestId("roster").boundingBox())!;
  expect(rail.height).toBeLessThanOrEqual(height);
  // The pane takes exactly what the rail and the hairline leave.
  const pane = (await page.locator("main").boundingBox())!;
  expect(Math.round(rail.width + pane.width)).toBeGreaterThanOrEqual(width - 2);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
  // Every roster row still shows its name and status at the narrow size.
  await expect(page.locator('[data-familiar="astrolabe"] [data-status]')).toContainText("waiting on your seal");

  // The aether row is one line at both sizes — the wireframe shows it on one (§7.5).
  await page.locator('[data-familiar="sconce"]').click();
  const meters = page.getByTestId("aether").locator("[data-meter]");
  await expect(meters).toHaveCount(3);
  const heights = await meters.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  expect(Math.max(...heights)).toBeLessThan(28);
});

test("four names give four visibly different sigils", async ({ page }) => {
  await page.goto("/");
  const shapes = new Set<string>();
  for (const name of ["Vellum", "Sconce", "Astrolabe", "Anvil"]) {
    const svg = page.locator(`[data-sigil="${name}"]`).first();
    await expect(svg).toBeVisible();
    shapes.add(
      await svg.evaluate((n) => {
        const parts = Array.from(n.querySelectorAll("line,path")).map(
          (c) => c.getAttribute("d") ?? `${c.getAttribute("x1")},${c.getAttribute("y1")},${c.getAttribute("x2")}`,
        );
        return `${n.getAttribute("data-glyph")}:${n.getAttribute("data-strokes")}:${parts.join("|")}`;
      }),
    );
  }
  expect(shapes.size).toBe(4);
});

test("sigil states are drawn as §7.4 specifies", async ({ page }) => {
  await page.goto("/");
  // working: the ring turns
  const working = page.locator('[data-sigil="Sconce"]').first().locator('[data-part="ring"]');
  await expect(working).toHaveCSS("animation-name", "ring-turn");
  await expect(working).toHaveCSS("animation-duration", "8s");
  // awaiting seal: a brass dot, and the ring is still
  const seal = page.locator('[data-sigil="Astrolabe"]').first();
  await expect(seal.locator('[data-part="seal-dot"]')).toBeVisible();
  await expect(seal.locator('[data-part="ring"]')).toHaveCSS("animation-name", "none");
  // dormant: 40% opacity
  const dormant = page.locator('[data-sigil="Anvil"]').first();
  await expect(dormant).toHaveCSS("opacity", "0.4");
  // idle: full opacity, still
  const idle = page.locator('[data-sigil="Vellum"]').first();
  await expect(idle).toHaveCSS("opacity", "1");
  await expect(idle.locator('[data-part="seal-dot"]')).toHaveCount(0);
});

test("reduced motion replaces the rotation with a static brass tick", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  // A 1px-wide line has no bounding box, so assert the computed style rather than visibility.
  const tick = page.locator('[data-sigil="Sconce"]').first().locator('[data-part="tick"]');
  await expect(tick).toHaveCSS("display", "block");
  await expect(tick).toHaveCSS("stroke", "rgb(176, 141, 63)"); // --brass
  // and the ring is no longer really turning
  const ring = page.locator('[data-sigil="Sconce"]').first().locator('[data-part="ring"]');
  expect(await ring.evaluate((n) => parseFloat(getComputedStyle(n).animationDuration))).toBeLessThan(0.01);
});

test("a turning ring rotates about its own centre and stays inside its row", async ({ page }) => {
  await page.goto("/");
  // Regression: the ring group first carried `transform-box: view-box`. Chromium honours it;
  // WebKitGTK did not, resolved `center` against the border box in CSS pixels, and threw the
  // ring out of the row onto the status line below. Caught only by running the real app.
  // This asserts both the fix and the symptom, so neither can quietly come back.
  const sigil = page.locator('[data-sigil="Sconce"]').first();
  const ring = sigil.locator('[data-part="ring"]');
  await expect(ring).toHaveCSS("transform-box", "fill-box");

  const boxes = await sigil.evaluate((svg) => {
    const g = svg.querySelector('[data-part="ring"]')!;
    const a = svg.getBoundingClientRect();
    const b = g.getBoundingClientRect();
    return { a: { x: a.x + a.width / 2, y: a.y + a.height / 2 }, b: { x: b.x + b.width / 2, y: b.y + b.height / 2 } };
  });
  // Whatever angle the animation is caught at, the turning group stays concentric with its svg.
  expect(Math.abs(boxes.a.x - boxes.b.x)).toBeLessThan(1.5);
  expect(Math.abs(boxes.a.y - boxes.b.y)).toBeLessThan(1.5);

  // And it does not spill onto the status line underneath it.
  const row = page.locator('[data-familiar="sconce"]');
  const rowBox = (await row.boundingBox())!;
  const ringBox = (await ring.boundingBox())!;
  expect(ringBox.y).toBeGreaterThanOrEqual(rowBox.y - 1);
  expect(ringBox.y + ringBox.height).toBeLessThanOrEqual(rowBox.y + rowBox.height + 1);
});

test("selecting a familiar switches the pane and its aether meters", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("aether")).toContainText("no commission running");
  await page.locator('[data-familiar="sconce"]').click();
  await expect(page.getByTestId("pane-header")).toContainText("Sconce");
  const aether = page.getByTestId("aether");
  await expect(aether.locator('[data-meter="tokens"]')).toContainText("148k / 250k");
  await expect(aether.locator('[data-meter="turns"]')).toContainText("11 / 40");
  await expect(aether.locator('[data-meter="time"]')).toContainText("28 / 30 min");
  // 148k of 250k is under 80%, so the fill stays verdigris.
  await expect(aether.locator('[data-meter="tokens"] [role="meter"] > div')).toHaveCSS("background-color", "rgb(78, 122, 107)");
  // time is at 93% — past brass, into the warning colour.
  await expect(aether.locator('[data-meter="time"] [role="meter"] > div')).toHaveCSS("background-color", "rgb(176, 141, 63)");
});

test("every tab shows its own thing rather than an empty box", async ({ page }) => {
  await page.goto("/");

  // Terminal is real from Phase 1 on.
  await page.locator('[data-tab="terminal"]').click();
  await expect(page.locator('[data-tab="terminal"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.getByTestId("xterm-host")).toBeVisible();

  // Codex is real from Phase 3.
  await page.locator('[data-tab="codex"]').click();
  await expect(page.getByTestId("codex")).toBeVisible();

  // Commission is real from Phase 2's intake onward.
  await page.locator('[data-tab="commission"]').click();
  await expect(page.getByTestId("intake")).toBeVisible();

  // Outputs has not arrived, and §3 asks an empty state to say so rather than show nothing.
  await page.locator('[data-tab="outputs"]').click();
  await expect(page.getByTestId("tabpanel")).toContainText("Outputs arrive");
});
