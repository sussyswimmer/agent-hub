// The first-run tour and the How it works page. Written because the owner's first report was
// that nothing said how to get a familiar to do anything.
import { expect, test } from "@playwright/test";

// A first launch: no tour seen. The roster rather than the floor, as the rest of the suite.
test.use({
  storageState: {
    cookies: [],
    origins: [{ origin: "http://localhost:1420", localStorage: [{ name: "grimoire.floor", value: "0" }] }],
  },
});

test("the tour opens by itself on a first launch and walks through giving a familiar a task", async ({ page }) => {
  await page.goto("/");
  const tour = page.getByTestId("tour");
  await expect(tour).toBeVisible();
  await expect(tour).toHaveAttribute("data-step", "welcome");
  await expect(page.getByRole("dialog")).toContainText("Welcome to Grimoire");

  await page.getByTestId("tour-next").click();
  await expect(tour).toHaveAttribute("data-step", "roster");
  await expect(page.getByTestId("tour-ring")).toBeVisible();

  // The floor is put away in this window, so its step is passed over rather than pointing at
  // nothing.
  await page.getByTestId("tour-next").click();
  await expect(tour).toHaveAttribute("data-step", "commission");
  // It opened what it is pointing at: a familiar's commission tab, with the box to write in.
  await expect(page.getByTestId("intake-prompt")).toBeVisible();
  const ring = await page.getByTestId("tour-ring").boundingBox();
  const box = await page.getByTestId("intake-prompt").boundingBox();
  expect(ring && box && ring.x <= box.x && ring.y <= box.y && ring.x + ring.width >= box.x + box.width).toBe(true);

  await page.getByTestId("tour-next").click();
  await expect(tour).toHaveAttribute("data-step", "start");
  await expect(page.getByRole("dialog")).toContainText("Summon and start");

  // Back goes back, and skips the floor step in that direction too.
  await page.getByTestId("tour-back").click();
  await expect(tour).toHaveAttribute("data-step", "commission");
  await page.getByTestId("tour-back").click();
  await expect(tour).toHaveAttribute("data-step", "roster");

  // To the end.
  for (let i = 0; i < 12 && (await tour.count()) > 0; i++) {
    const done = (await page.getByTestId("tour-next").innerText()) === "Done";
    await page.getByTestId("tour-next").click();
    if (done) break;
  }
  await expect(tour).toHaveCount(0);

  // Seen is remembered: it does not come back on the next launch.
  await page.reload();
  await expect(page.getByTestId("pane-header")).toBeVisible();
  await expect(page.getByTestId("tour")).toHaveCount(0);
});

test("the tour can be skipped, with Escape as well as the button", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("tour")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("tour")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("pane-header")).toBeVisible();
  await expect(page.getByTestId("tour")).toHaveCount(0);
});

test("How it works explains every word and replays the tour", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("tour-skip").click();

  await page.getByTestId("help-toggle").click();
  const help = page.getByTestId("help");
  await expect(help).toBeVisible();
  await expect(page.getByTestId("help-steps")).toContainText("Summon and start");
  await expect(page.getByTestId("help-steps")).toContainText("Mark it done");

  // The canonical nouns the interface uses, each explained.
  for (const word of ["familiar", "binding", "commission", "summon", "banish", "seal", "aether", "codex", "standing ward"]) {
    await expect(page.locator(`[data-word="${word}"]`)).toBeVisible();
  }

  await page.getByTestId("help-tour").click();
  await expect(page.getByTestId("tour")).toHaveAttribute("data-step", "welcome");
});
