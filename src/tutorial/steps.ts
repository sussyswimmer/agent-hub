// The guided tour, as data. Each step points at something on screen by selector and says, in
// plain words, what it is and what to do with it. The nouns are the canonical ones (§3); the
// sentences say what they mean, because the owner's first report was that nothing said how to
// get a familiar to do anything.

export interface Step {
  id: string;
  title: string;
  body: string;
  /** What to point at. None means a card in the middle of the window. */
  anchor?: string;
  /** A step whose anchor is not on screen is passed over rather than pointing at nothing. */
  optional?: boolean;
  /** What has to be open for the anchor to exist. */
  needs?: "familiar";
}

export const STEPS: Step[] = [
  {
    id: "welcome",
    title: "Welcome to Grimoire",
    body:
      "Grimoire runs AI agents on this machine: each one is a familiar, with its own name, folder and memory. " +
      "This tour takes a minute and shows the whole of how to use them. It can be replayed from How it works, in the rail.",
  },
  {
    id: "roster",
    title: "Your familiars",
    body:
      "Every familiar is listed here. The mark beside each name moves with what it is doing: faint when resting, " +
      "turning while it works, a brass dot when it is waiting for you. Click one to open it.",
    anchor: "[data-testid='roster']",
  },
  {
    id: "floor",
    title: "The floor",
    body:
      "The floor shows everyone at once. Resting familiars wander by the hearth, summoned ones stay near their own " +
      "desk, and one standing in the circle in the middle is waiting on you. Click a familiar here to open it too.",
    anchor: "[data-testid='floor-slot']",
    optional: true,
  },
  {
    id: "commission",
    title: "Give it a task",
    body:
      "This is how you get a familiar to do something. Write what you want done here, in plain words, and answer " +
      "any questions below it. That task is called a commission.",
    anchor: "[data-testid='intake-prompt']",
    needs: "familiar",
  },
  {
    id: "start",
    title: "Press Summon and start",
    body:
      "One press. The familiar is summoned — started in a terminal — and begins on your commission straight away. " +
      "If it is already working, the same button adds your task to its queue instead.",
    anchor: "[data-testid='intake-submit']",
    needs: "familiar",
  },
  {
    id: "now",
    title: "What it is doing, and what to do next",
    body:
      "This line always says what the familiar is doing. While it works, Mark done appears here: press it when the " +
      "work is finished, and it moves on to the next commission in its queue.",
    anchor: "[data-testid='now']",
    needs: "familiar",
  },
  {
    id: "terminal",
    title: "Watch it work",
    body:
      "The terminal tab is the familiar itself, running. Watch it, or type to it directly as you would in any terminal. " +
      "Banish, at the top, stops it.",
    anchor: "[data-tab='terminal']",
    needs: "familiar",
  },
  {
    id: "seals",
    title: "Nothing risky happens without you",
    body:
      "When a familiar wants to do something that needs your say — write outside its folder, delete, push, send — it " +
      "stops and waits here. Seal to allow it, or refuse. The count shows how many are waiting.",
    anchor: "[data-testid='seal-rail']",
  },
  {
    id: "aether",
    title: "Its budget",
    body:
      "The aether meters show what the current commission has used: tokens, turns and minutes. At 80% the familiar is " +
      "told to wrap up; past its budget it is stopped the way its binding says.",
    anchor: "[data-testid='aether']",
    needs: "familiar",
    optional: true,
  },
  {
    id: "help",
    title: "That is all of it",
    body:
      "How it works explains every word Grimoire uses and replays this tour. New familiars are markdown files in your " +
      "bindings folder; the workbench shows where that is.",
    anchor: "[data-testid='help-toggle']",
  },
];
