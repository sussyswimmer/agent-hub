import { Rule } from "@/ui";
import { useStore } from "@/store";

/**
 * Every word Grimoire uses, and what it means in plain terms. The interface keeps the canonical
 * nouns (§3) so there is one word per thing from the screen to the code; this is where each one
 * is explained once, for a person who has not read the specification.
 */
export const GLOSSARY: { word: string; means: string }[] = [
  { word: "familiar", means: "An AI agent — a command-line tool such as claude — with its own name, working folder, memory and rules." },
  { word: "binding", means: "The markdown file that defines a familiar. Drop one into your bindings folder and it appears in the rail within two seconds." },
  { word: "writ", means: "A familiar's standing instructions: everything in its binding after the settings at the top." },
  { word: "commission", means: "A task you give a familiar. It works on one at a time; the rest wait in its queue." },
  { word: "summon", means: "Start a familiar running, in a terminal. Summon and start does this and hands it a commission in one press." },
  { word: "mark done", means: "Tell Grimoire a commission is finished. The familiar stays summoned and takes the next one in its queue." },
  { word: "banish", means: "Stop a familiar. Anything it was working on ends as banished, not done." },
  { word: "seal", means: "Your approval. Anything risky a familiar tries — writing outside its folder, deleting, pushing, sending — waits for it." },
  { word: "autonomy", means: "How much a familiar may do without asking: propose (ask for everything), bounded (act inside set limits), or free (act inside its folder)." },
  { word: "aether", means: "A commission's budget: tokens, turns and minutes. At 80% the familiar is told to wrap up; past 100% it is steered, bound or banished." },
  { word: "bound", means: "Paused because it ran out of aether. It waits in Seals for you to extend the budget or stop it." },
  { word: "codex", means: "A familiar's memory file, kept between commissions. It reads it on every summon and may add to it." },
  { word: "reliquary", means: "Memory shared between familiars. Every addition to it needs your seal." },
  { word: "standing ward", means: "A commission that repeats on a schedule, such as every weekday morning, and runs with the window closed." },
  { word: "ledger of ink", means: "The record of everything done and what it cost. Costs are estimates and are always marked so." },
  { word: "misfire", means: "A run that went wrong. The reason is shown on the familiar and in the ledger." },
  { word: "workbench", means: "Settings: where each engine is installed, signing in, the spend cap, and saved transcripts." },
  { word: "the floor", means: "The map of the tower with every familiar on it, so you can see who is working, who is resting and who needs you." },
];

const STEPS: { title: string; body: string }[] = [
  { title: "Pick a familiar", body: "Click one in the rail on the left, or on the floor." },
  {
    title: "Say what you want done",
    body: "On its commission tab, write the task in plain words and answer any questions it asks.",
  },
  {
    title: "Press Summon and start",
    body: "It is started in a terminal and begins on your task. There is nothing else to press. If it is already busy, the same button puts your task in its queue.",
  },
  {
    title: "Leave it, or watch it",
    body: "The terminal tab shows it working, and you can type to it there. If it wants to do something risky it stops and waits in Seals until you answer.",
  },
  {
    title: "Mark it done",
    body: "When the work is finished, press Mark done on the commission tab. It moves on to the next task in its queue, or waits for another.",
  },
  { title: "Banish it when you are finished", body: "Banish, at the top of the familiar's pane, stops it running." },
];

const FLOOR: { where: string; means: string }[] = [
  { where: "Wandering by the hearth, faint", means: "Resting. Not summoned." },
  { where: "Strolling near its own desk", means: "Summoned and free for a commission." },
  { where: "At its desk, ring turning, a line of ink to the lamp", means: "Working on a commission." },
  { where: "Standing in the circle in the middle", means: "Waiting for your seal." },
  { where: "A brass or oxblood arc around it", means: "Past 80% of its budget, or over it." },
  { where: "A slowly turning ring and no ink", means: "Stalled: nothing has happened for ten minutes." },
];

export function Help() {
  const setTour = useStore((s) => s.setTour);
  const home = useStore((s) => s.home);

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-void" data-testid="help">
      <header className="flex h-12 shrink-0 items-center px-4">
        <h1 className="display text-md text-bone">How it works</h1>
        <div className="ml-auto">
          <button
            type="button"
            onClick={() => setTour(0)}
            data-testid="help-tour"
            className="h-7 rounded-mark border border-brass px-3 text-base text-bone transition-colors duration-150 hover:bg-panel"
          >
            Replay the tour
          </button>
        </div>
      </header>
      <Rule />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 rule-scroll">
        <div className="measure flex flex-col gap-8">
          <section className="flex flex-col gap-3">
            <h2 className="display text-md text-bone">Getting something done</h2>
            <ol className="flex flex-col gap-3" data-testid="help-steps">
              {STEPS.map((s, i) => (
                <li key={s.title} className="flex gap-3">
                  <span className="mono w-5 shrink-0 pt-0.5 text-xs text-brass-text">{i + 1}</span>
                  <span className="flex flex-col">
                    <span className="text-base text-bone">{s.title}</span>
                    <span className="text-base text-bone-dim">{s.body}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="display text-md text-bone">The words</h2>
            <p className="text-base text-bone-dim">
              Grimoire names things after a scholar's study. Each word means one thing, everywhere it appears.
            </p>
            <dl className="flex flex-col" data-testid="glossary">
              {GLOSSARY.map((g) => (
                <div key={g.word} className="flex gap-4 border-t border-rule py-2 first:border-t-0" data-word={g.word}>
                  <dt className="display w-32 shrink-0 text-base text-bone">{g.word}</dt>
                  <dd className="text-base text-bone-dim">{g.means}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="display text-md text-bone">Reading the floor</h2>
            <dl className="flex flex-col">
              {FLOOR.map((f) => (
                <div key={f.where} className="flex gap-4 border-t border-rule py-2 first:border-t-0">
                  <dt className="w-56 shrink-0 text-base text-bone">{f.where}</dt>
                  <dd className="text-base text-bone-dim">{f.means}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="flex flex-col gap-3 pb-6">
            <h2 className="display text-md text-bone">Adding a familiar</h2>
            <p className="text-base text-bone-dim">
              Copy a <span className="mono text-xs">.binding.md</span> file into your bindings folder
              {home ? (
                <>
                  , <span className="mono text-xs">{home.bindings}</span>
                </>
              ) : null}
              . It appears in the rail within two seconds; delete the file and it goes. The five starter familiars are
              examples to copy from, and the workbench can put them back if they are removed.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
