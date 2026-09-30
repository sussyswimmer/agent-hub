// Phase 2 acceptance (§12): "the intake form blocks submit on a missing required field."
//
// The form is generated from the binding, so there is nothing here that hard-codes a question.
// The mock backend serves the same intake the seed bindings declare.
import { expect, test } from "@playwright/test";

async function openIntake(page: import("@playwright/test").Page) {
  await page.goto("/");
  await page.locator('[data-tab="commission"]').click();
  await expect(page.getByTestId("intake")).toBeVisible();
}

test("the form is built from the binding, not from the code", async ({ page }) => {
  await openIntake(page);

  // Vellum's three questions, in the order its binding lists them.
  await expect(page.locator("[data-field]")).toHaveCount(3);
  await expect(page.locator('[data-field="piece"]')).toContainText("Which piece are we working on?");
  await expect(page.locator('[data-field="mode"]')).toContainText("What kind of pass?");
  await expect(page.locator('[data-field="audience"]')).toContainText("Who reads it?");

  // Required is marked; optional is not.
  await expect(page.locator('[data-field="piece"]')).toContainText("required");
  await expect(page.locator('[data-field="audience"]')).not.toContainText("required");

  // A select renders its own options and nothing else.
  const options = await page.locator('[data-field="mode"] option').allTextContents();
  expect(options).toEqual(["Choose one", "line edit", "structural", "fact check", "cut for length"]);
});

test("a different familiar gets a different form", async ({ page }) => {
  await openIntake(page);
  await page.locator('[data-familiar="sconce"]').click();
  await expect(page.getByTestId("pane-header")).toContainText("Sconce");

  await expect(page.locator("[data-field]")).toHaveCount(2);
  await expect(page.locator('[data-field="question"]')).toContainText("What is the question?");
  // Vellum's questions are gone, not merely hidden.
  await expect(page.locator('[data-field="piece"]')).toHaveCount(0);
});

test("submit is blocked while a required answer is missing, and says which", async ({ page }) => {
  await openIntake(page);

  // Nothing is marked wrong before the first press: reddening a field for being unread would
  // tell people off for going through the form in order.
  await expect(page.locator("[data-missing]")).toHaveCount(0);

  await page.getByTestId("intake-submit").click();
  await expect(page.getByTestId("intake-blocked")).toBeVisible();
  await expect(page.getByTestId("intake-blocked")).toContainText("Say what Vellum should do");
  // The tab has not moved on.
  await expect(page.locator('[data-tab="commission"]')).toHaveAttribute("aria-selected", "true");

  await page.getByTestId("intake-prompt").fill("Tighten the opening.");
  await page.getByTestId("intake-submit").click();
  await expect(page.getByTestId("intake-blocked")).toContainText("all 2 questions");
  await expect(page.locator("[data-missing]")).toHaveCount(2);

  // Answer one; the complaint narrows rather than staying the same.
  await page.locator('[data-field="piece"] input').fill("The swimming essay");
  await page.getByTestId("intake-submit").click();
  await expect(page.getByTestId("intake-blocked")).toContainText("the question");
  await expect(page.locator("[data-missing]")).toHaveCount(1);
  await expect(page.locator('[data-field="mode"] [data-missing]')).toBeVisible();

  // Answer the last one and it goes through. The optional field stays empty on purpose. Queued
  // for later, so the familiar stays where it is and the queue is what shows.
  await page.locator('[data-field="mode"] select').selectOption("structural");
  await page.getByTestId("intake-queue").click();

  // "Goes through" means a commission was placed and is visible in the queue (§6.2), not that
  // some other tab opened. The complaint is gone too.
  await expect(page.getByTestId("queue").locator("[data-commission]")).toHaveCount(1);
  await expect(page.getByTestId("intake-blocked")).toHaveCount(0);
});

test("whitespace is not an answer", async ({ page }) => {
  await openIntake(page);
  await page.getByTestId("intake-prompt").fill("   ");
  await page.locator('[data-field="piece"] input').fill("  ");
  await page.getByTestId("intake-submit").click();

  await expect(page.getByTestId("intake-blocked")).toBeVisible();
  await expect(page.locator('[data-tab="commission"]')).toHaveAttribute("aria-selected", "true");
});
