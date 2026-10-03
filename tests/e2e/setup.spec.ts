// Setting familiars up from inside the app, and talking to one that is running (DECISIONS 0028).
// Written because the owner could not see how to make a familiar, point one at a folder, or get
// one to do what they wanted without writing YAML by hand.
import { expect, test } from "@playwright/test";

test("a new familiar is made from the rail and is ready to be given a task", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-familiar").click();
  await expect(page.getByTestId("new-familiar-view")).toBeVisible();

  await page.getByTestId("setup-name").fill("Nib");
  await page.locator('[data-testid="setup-order"] [data-order="quill"]').click();
  // The writ follows the name and order until someone writes in it.
  await expect(page.getByTestId("setup-writ")).toHaveValue(/You are Nib, a writer and editor/);
  await page.getByTestId("setup-folder-pick").click();
  await expect(page.getByTestId("setup-folder")).toHaveValue("~/work/chosen");
  await expect(page.getByTestId("setup-folder-status")).toHaveAttribute("data-exists", "true");
  await page.locator('[data-testid="setup-autonomy"] [data-autonomy="bounded"]').click();
  await page.getByTestId("setup-save").click();

  // It is in the rail, selected, on its commission tab, with the box to write a task in.
  const row = page.locator('[data-familiar="nib"]');
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("aria-current", "page");
  await expect(page.getByTestId("pane-header")).toContainText("Nib");
  await expect(page.getByTestId("pane-header")).toContainText("~/work/chosen");
  await expect(page.locator('[data-tab="commission"]')).toHaveAttribute("aria-selected", "true");

  // And what was saved is what the settings tab reads back.
  await page.locator('[data-tab="settings"]').click();
  await expect(page.getByTestId("setup-name")).toHaveValue("Nib");
  await expect(page.locator('[data-autonomy="bounded"] input')).toBeChecked();
  await expect(page.locator('[data-order="quill"] input')).toBeChecked();

  // It can be summoned and given work at once.
  await page.locator('[data-tab="commission"]').click();
  await page.getByTestId("intake-prompt").fill("Tighten the opening.");
  await page.getByTestId("intake-submit").click();
  await expect(page.getByTestId("terminal-pane")).toHaveAttribute("data-status", "live");
  await expect(page.locator(".xterm-accessibility")).toContainText("Tighten the opening.");
});

test("a new familiar needs a name and a folder, and is told so", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-familiar").click();
  await page.getByTestId("setup-save").click();
  await expect(page.getByTestId("setup-error")).toHaveText("Give the familiar a name.");
  await page.getByTestId("setup-name").fill("Nib");
  await page.getByTestId("setup-save").click();
  await expect(page.getByTestId("setup-error")).toHaveText("Choose the folder Nib works in.");
  // A name already taken is refused rather than writing over the other one.
  await page.getByTestId("setup-name").fill("Vellum");
  await page.getByTestId("setup-folder").fill("~/work");
  await page.getByTestId("setup-save").click();
  await expect(page.getByTestId("setup-error")).toContainText("There is already a familiar file called vellum.binding.md");
  await expect(page.locator('[data-familiar="vellum"]')).toHaveCount(1);
});

test("the settings tab changes a familiar, and the rail and its form follow", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-familiar="vellum"]').click();
  await page.locator('[data-tab="settings"]').click();
  await expect(page.getByTestId("setup-name")).toHaveValue("Vellum");

  await page.getByTestId("setup-name").fill("Vellum the Second");
  // Its first question stops being required, and a pick-one question gains a choice.
  const questions = page.getByTestId("setup-question");
  await expect(questions).toHaveCount(3);
  await questions.nth(0).getByRole("checkbox").uncheck();
  await page.getByTestId("setup-save").click();
  await expect(page.getByTestId("setup-saved")).toHaveText("Saved.");

  await expect(page.locator('[data-familiar="vellum"]')).toContainText("Vellum the Second");
  await expect(page.getByTestId("pane-header")).toContainText("Vellum the Second");

  // The commission form asks the questions as they now are: the first is no longer required.
  await page.locator('[data-tab="commission"]').click();
  await expect(page.locator('[data-field="piece"]')).toBeVisible();
  await expect(page.locator('[data-field="piece"]')).not.toContainText("required");
  await expect(page.locator('[data-field="mode"]')).toContainText("required");
});

test("a pick-one question with nothing to pick is refused with what to do", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-familiar="anvil"]').click();
  await page.locator('[data-tab="settings"]').click();
  await page.getByTestId("setup-add-question").click();
  const added = page.getByTestId("setup-question").last();
  await added.getByRole("textbox").first().fill("Which branch?");
  await added.getByRole("combobox").selectOption("select");
  await page.getByTestId("setup-save").click();
  await expect(page.getByTestId("setup-error")).toContainText("“Which branch?” is a pick-one question with nothing to pick");
});

test("a familiar whose folder is not on this machine says so, and is fixed in one press", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("new-familiar").click();
  await page.getByTestId("setup-name").fill("Stray");
  await page.getByTestId("setup-folder").fill("~/nowhere/at-all");
  await expect(page.getByTestId("setup-folder-status")).toHaveAttribute("data-exists", "false");
  await page.getByTestId("setup-save").click();

  const row = page.locator('[data-familiar="stray"]');
  await expect(row.locator("[data-status]")).toHaveText("needs a folder");
  await expect(page.getByTestId("folder-fix")).toBeVisible();
  await expect(page.getByTestId("summon")).toBeDisabled();
  // And looks it. A base rule outside Tailwind's layers used to override every colour class on
  // every button, so a disabled Summon was as bright as an enabled one (DECISIONS 0028).
  await expect(page.getByTestId("summon")).toHaveCSS("color", "rgb(140, 132, 116)");
  await expect(page.getByTestId("intake-submit")).toHaveText("Queue it");

  await page.getByTestId("folder-fix-pick").click();
  await expect(page.getByTestId("folder-fix")).toHaveCount(0);
  await expect(row.locator("[data-status]")).toHaveText("dormant");
  await expect(page.getByTestId("pane-header")).toContainText("~/work/chosen");
  await expect(page.getByTestId("summon")).toBeEnabled();
  await expect(page.getByTestId("summon")).toHaveCSS("color", "rgb(201, 191, 164)");
  await expect(page.getByTestId("intake-submit")).toHaveText("Summon and start");
});

test("a familiar can be put away, and is asked about first", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-familiar="tally"]').click();
  await page.locator('[data-tab="settings"]').click();
  await page.getByTestId("setup-remove").click();
  await expect(page.getByTestId("setup-remove-confirm")).toContainText("renamed rather than deleted");
  await page.getByTestId("setup-remove-yes").click();
  await expect(page.locator('[data-familiar="tally"]')).toHaveCount(0);
});

test("a running familiar can be told something from its commission tab", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-familiar="vellum"]').click();
  // Nothing to say to a familiar that is not running, so the box is not there.
  await expect(page.getByTestId("say")).toHaveCount(0);

  await page.getByTestId("intake-prompt").fill("Tighten the opening.");
  await page.locator('[data-field="piece"] input').fill("the swimming essay");
  await page.locator('[data-field="mode"] select').selectOption("line edit");
  await page.getByTestId("intake-submit").click();
  await expect(page.getByTestId("terminal-pane")).toHaveAttribute("data-status", "live");

  await page.locator('[data-tab="commission"]').click();
  await expect(page.getByTestId("say")).toBeVisible();
  await page.getByTestId("say-text").fill("Keep the second paragraph as it is.");
  await page.getByTestId("say-text").press("Enter");
  await expect(page.getByTestId("say-sent")).toContainText("Sent to Vellum.");
  await expect(page.getByTestId("say-text")).toHaveValue("");

  await page.locator('[data-tab="terminal"]').click();
  await expect(page.locator(".xterm-accessibility")).toContainText("Keep the second paragraph as it is.");
});

test("a save from the settings tab keeps an edit made to the file while it was open", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-familiar="vellum"]').click();
  await page.locator('[data-tab="settings"]').click();
  await expect(page.getByTestId("setup-name")).toHaveValue("Vellum");

  // Someone rewords the writ in an editor while the page is open.
  await page.evaluate(() =>
    dispatchEvent(new CustomEvent("grimoire:mock-file-edit", { detail: { id: "vellum", change: { writ: "Edited in the file." } } })),
  );
  // The page changes only the model, and saves.
  await page.getByTestId("setup-model").fill("opus");
  await page.getByTestId("setup-save").click();
  await expect(page.getByTestId("setup-saved")).toHaveText("Saved.");

  // Both are in the file, and the page now shows what the file says.
  await expect(page.getByTestId("setup-writ")).toHaveValue("Edited in the file.");
  await expect(page.getByTestId("setup-model")).toHaveValue("opus");
  await page.locator('[data-tab="commission"]').click();
  await page.locator('[data-tab="settings"]').click();
  await expect(page.getByTestId("setup-writ")).toHaveValue("Edited in the file.");
  await expect(page.getByTestId("setup-model")).toHaveValue("opus");
});

test("a question added on the settings tab keeps its id when it is reworded and saved again", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-familiar="anvil"]').click();
  await page.locator('[data-tab="settings"]').click();
  await page.getByTestId("setup-add-question").click();
  const added = page.getByTestId("setup-question").last();
  await added.getByRole("textbox").first().fill("Which branch?");
  await page.getByTestId("setup-save").click();
  await expect(page.getByTestId("setup-saved")).toHaveText("Saved.");

  // Reworded in the same tab, without leaving it.
  await page.getByTestId("setup-question").last().getByRole("textbox").first().fill("Which branch, exactly?");
  await page.getByTestId("setup-save").click();
  await expect(page.getByTestId("setup-saved")).toHaveText("Saved.");

  // The id it was given the first time is the one it keeps, so a writ naming it still fills in.
  await page.locator('[data-tab="commission"]').click();
  await expect(page.locator('[data-field="which_branch"]')).toContainText("Which branch, exactly?");
  await expect(page.locator('[data-field="which_branch_exactly"]')).toHaveCount(0);
});
