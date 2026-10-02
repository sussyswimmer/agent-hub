import { useEffect, useId, useState } from "react";

import { Rule, Sigil } from "@/ui";
import { backend } from "@/lib/ipc";
import { useStore } from "@/store";
import type {
  Autonomy,
  BindingForm,
  Engine,
  FamiliarSummary,
  FolderStatus,
  IntakeField,
  IntakeKind,
  OnExceed,
  Order,
} from "@/lib/types";

// Setting a familiar up without writing YAML (DECISIONS 0028).
//
// The owner could not see how to make a familiar or point one at a folder: the only way was to
// write a `.binding.md` by hand. This is that file as a form. It writes the same file — the
// binding is still the source of truth, and still opens in an editor — so nothing here is a
// second idea of what a familiar is. The nouns stay canonical (§3); each one is said in plain
// words beside it, because the owner asked for exactly that.

/** What each order is for, in the words a person would use. */
export const ORDER_PLAIN: Record<Order, { title: string; means: string }> = {
  quill: { title: "Quill", means: "Writing and editing" },
  lantern: { title: "Lantern", means: "Research and reading" },
  crucible: { title: "Crucible", means: "Building and fixing code" },
  compass: { title: "Compass", means: "Planning and scheduling" },
  ledger: { title: "Ledger", means: "Numbers and data" },
};

const ORDER_LIST: Order[] = ["crucible", "quill", "lantern", "compass", "ledger"];

const AUTONOMY_PLAIN: Record<Autonomy, { title: string; means: string }> = {
  propose: {
    title: "Ask me first",
    means: "It reads and thinks freely, and waits for your seal before it changes a file or runs a command. The safest.",
  },
  bounded: {
    title: "Change files in its folder",
    means: "Edits inside its folder go ahead. Anything else — commands, the network, other folders — waits for your seal.",
  },
  free: {
    title: "Work freely in its folder",
    means: "Edits and commands in its folder go ahead. Deleting, force-pushing, sending anything and anything outside its folder still wait for your seal.",
  },
};

const EXCEED_PLAIN: Record<OnExceed, string> = {
  steer: "Tell it to wrap up, and let it carry on",
  bind: "Pause it and ask me (bind)",
  banish: "Stop it (banish)",
};

const KIND_PLAIN: Record<IntakeKind, string> = {
  text: "Short answer",
  multiline: "Long answer",
  select: "Pick one",
};

const ENGINES: { engine: Engine; label: string }[] = [
  { engine: "claude", label: "Claude (Claude Code)" },
  { engine: "codex", label: "Codex — cannot be summoned yet" },
  { engine: "gemini", label: "Gemini — cannot be summoned yet" },
  { engine: "qwen", label: "Qwen — cannot be summoned yet" },
  { engine: "custom", label: "Custom — cannot be summoned yet" },
];

/** A writ to start from, for a familiar of this order. Edited freely; it is only a beginning. */
export function starterWrit(order: Order, name: string): string {
  const who = name.trim() || "this familiar";
  const body: Record<Order, string> = {
    quill: `You are ${who}, a writer and editor. Work on one piece at a time. Propose changes and give the reason for each; do not rewrite wholesale unless you are asked to.`,
    lantern: `You are ${who}, a researcher. Read before you answer. Cite real sources, with links, and say plainly when you could not find something.`,
    crucible: `You are ${who}, a builder. Work in this folder. Make the change you are asked for and no more, run the tests before you say you are done, and explain what you changed.`,
    compass: `You are ${who}, a planner. Turn what you are given into a clear, ordered plan with dates, and say what is at risk.`,
    ledger: `You are ${who}, an analyst. Show your arithmetic, state your assumptions, and give every number with its unit and where it came from.`,
  };
  return `# Writ\n\n${body[order]}`;
}

export function blankForm(): BindingForm {
  return {
    name: "",
    order: "crucible",
    engine: "claude",
    model: null,
    workspace: "",
    autonomy: "propose",
    aether: { tokens: 200_000, turns: 40, minutes: 30, on_exceed: "bind" },
    intake: [],
    writ: starterWrit("crucible", ""),
  };
}

/** Whether a folder is there, asked a moment after the typing stops. */
function useFolderStatus(path: string): FolderStatus | null {
  const [status, setStatus] = useState<FolderStatus | null>(null);
  useEffect(() => {
    if (!path.trim()) {
      setStatus(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      void backend()
        .then((b) => b.folderStatus(path))
        .then((s) => {
          if (live) setStatus(s);
        })
        .catch(() => {
          if (live) setStatus(null);
        });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [path]);
  return status;
}

const field = "rounded-mark border border-rule bg-panel px-2 text-base text-bone outline-none placeholder:text-bone-dim focus:border-brass";

/**
 * The form. `id` is null for a new familiar. `live` says whether it is summoned now, in which
 * case the changes reach it at its next summon and the page says so.
 */
export function FamiliarForm({
  id,
  initial,
  live = false,
  onSaved,
}: {
  id: string | null;
  initial: BindingForm;
  live?: boolean;
  onSaved: (id: string) => void;
}) {
  const [form, setForm] = useState<BindingForm>(initial);
  // Numbers as typed, so a field can be emptied without becoming 0 on the way.
  const [budget, setBudget] = useState({
    tokens: initial.aether.tokens?.toString() ?? "",
    turns: initial.aether.turns?.toString() ?? "",
    minutes: initial.aether.minutes?.toString() ?? "",
  });
  // A new familiar's writ follows its name and order until someone writes in it.
  const [writTouched, setWritTouched] = useState(id !== null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const folder = useFolderStatus(form.workspace);
  const ids = useId();

  const set = <K extends keyof BindingForm>(key: K, value: BindingForm[K]) => {
    setSaved(null);
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (!writTouched && (key === "name" || key === "order")) next.writ = starterWrit(next.order, next.name);
      return next;
    });
  };

  const setQuestion = (i: number, q: Partial<IntakeField>) =>
    set(
      "intake",
      form.intake.map((old, j) => (j === i ? { ...old, ...q } : old)),
    );

  async function pick() {
    try {
      const chosen = await (await backend()).pickFolder(form.workspace || undefined);
      if (chosen) set("workspace", chosen);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(null);
    const number = (raw: string, what: string): number | null => {
      if (!raw.trim()) return null;
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) throw new Error(`The budget's ${what} has to be a whole number above nothing, or left blank for no limit.`);
      return n;
    };
    let toSave: BindingForm;
    try {
      toSave = {
        ...form,
        aether: {
          ...form.aether,
          tokens: number(budget.tokens, "tokens"),
          turns: number(budget.turns, "turns"),
          minutes: number(budget.minutes, "minutes"),
        },
      };
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return;
    }
    setSaving(true);
    try {
      const saved = await (await backend()).bindingSave(id, toSave);
      setSaved(
        id === null
          ? `Created ${toSave.name.trim()}.`
          : live
            ? `Saved. ${toSave.name.trim()} uses these settings the next time it is summoned.`
            : "Saved.",
      );
      onSaved(saved);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  }

  const name = form.name.trim() || "it";

  return (
    <form className="measure flex flex-col gap-6 pb-6" onSubmit={(e) => void save(e)} data-testid="setup-form" noValidate>
      <Section title="Who it is">
        <label className="flex flex-col gap-1">
          <span className="text-base text-bone">Name</span>
          <input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Nib, Gnomon, Ferrule…"
            data-testid="setup-name"
            className={`h-8 ${field}`}
          />
        </label>
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-base text-bone">
            What it is for <span className="text-bone-dim">· its order, which sets its colour and its desk</span>
          </legend>
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2" data-testid="setup-order">
            {ORDER_LIST.map((o) => (
              <label
                key={o}
                data-order={o}
                className={`flex cursor-pointer items-center gap-2 border px-2 py-1.5 ${
                  form.order === o ? "border-brass bg-panel" : "border-rule hover:bg-panel"
                }`}
              >
                <input
                  type="radio"
                  name={`${ids}-order`}
                  value={o}
                  checked={form.order === o}
                  onChange={() => set("order", o)}
                  className="sr-only"
                />
                <Sigil name={form.name || o} order={o} size={20} />
                <span className="flex flex-col">
                  <span className="text-base text-bone">{ORDER_PLAIN[o].means}</span>
                  <span className="text-xs text-bone-dim">{ORDER_PLAIN[o].title}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </Section>

      <Section title="Where it works">
        <label className="flex flex-col gap-1">
          <span className="text-base text-bone">The folder it works in</span>
          <span className="text-xs text-bone-dim">
            Its terminal opens here, and this is the folder its seal protects. A project, a folder of essays, anything.
          </span>
          <span className="flex gap-2">
            <input
              value={form.workspace}
              onChange={(e) => set("workspace", e.target.value)}
              placeholder="~/Documents/my-project"
              data-testid="setup-folder"
              className={`mono h-8 min-w-0 flex-1 text-xs ${field}`}
            />
            <button
              type="button"
              onClick={() => void pick()}
              data-testid="setup-folder-pick"
              className="h-8 shrink-0 rounded-mark border border-brass px-3 text-base text-bone hover:bg-panel"
            >
              Choose…
            </button>
          </span>
          {folder && (
            <span
              className={`text-xs ${folder.exists ? "text-verdigris-text" : "text-oxblood-text"}`}
              data-testid="setup-folder-status"
              data-exists={folder.exists}
            >
              {folder.exists
                ? `Found: ${folder.expanded}`
                : `There is no folder at ${folder.expanded}. Choose one that exists, or create it first.`}
            </span>
          )}
        </label>
      </Section>

      <Section title="What it may do on its own">
        <fieldset className="flex flex-col gap-1" data-testid="setup-autonomy">
          <legend className="sr-only">How much {name} may do without asking you</legend>
          {(Object.keys(AUTONOMY_PLAIN) as Autonomy[]).map((a) => (
            <label
              key={a}
              data-autonomy={a}
              className={`flex cursor-pointer gap-2 border px-2 py-1.5 ${
                form.autonomy === a ? "border-brass bg-panel" : "border-rule hover:bg-panel"
              }`}
            >
              <input
                type="radio"
                name={`${ids}-autonomy`}
                value={a}
                checked={form.autonomy === a}
                onChange={() => set("autonomy", a)}
                className="mt-1.5 accent-[var(--brass)]"
              />
              <span className="flex flex-col">
                <span className="text-base text-bone">
                  {AUTONOMY_PLAIN[a].title} <span className="text-xs text-bone-dim">· {a}</span>
                </span>
                <span className="text-xs text-bone-dim">{AUTONOMY_PLAIN[a].means}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </Section>

      <Section title="Its instructions">
        <label className="flex flex-col gap-1">
          <span className="text-base text-bone">
            Standing instructions <span className="text-bone-dim">· the writ</span>
          </span>
          <span className="text-xs text-bone-dim">
            Who it is and how it should work. It is given these every time it is summoned; the task itself you give it
            each time, on its commission tab.
          </span>
          <textarea
            value={form.writ}
            onChange={(e) => {
              setWritTouched(true);
              set("writ", e.target.value);
            }}
            rows={8}
            data-testid="setup-writ"
            className={`p-2 ${field}`}
          />
        </label>
      </Section>

      <Section title="Questions it asks before each task">
        <p className="text-xs text-bone-dim">
          Optional. Each answer is added to the task you give it. A required one has to be answered before it starts.
        </p>
        <div className="flex flex-col gap-3" data-testid="setup-questions">
          {form.intake.map((q, i) => (
            <div key={i} className="flex flex-col gap-1 border-l-2 border-rule pl-3" data-testid="setup-question">
              <span className="flex flex-wrap items-center gap-2">
                <input
                  value={q.ask}
                  onChange={(e) => setQuestion(i, { ask: e.target.value })}
                  placeholder="Which piece are we working on?"
                  aria-label={`Question ${i + 1}`}
                  className={`h-8 min-w-0 flex-1 ${field}`}
                />
                <select
                  value={q.type}
                  onChange={(e) => setQuestion(i, { type: e.target.value as IntakeKind })}
                  aria-label={`Question ${i + 1}: kind of answer`}
                  className={`h-8 ${field}`}
                >
                  {(Object.keys(KIND_PLAIN) as IntakeKind[]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_PLAIN[k]}
                    </option>
                  ))}
                </select>
                <label className="flex items-center gap-1 text-xs text-bone-dim">
                  <input
                    type="checkbox"
                    checked={q.required}
                    onChange={(e) => setQuestion(i, { required: e.target.checked })}
                    className="accent-[var(--brass)]"
                  />
                  required
                </label>
                <button
                  type="button"
                  onClick={() => set("intake", form.intake.filter((_, j) => j !== i))}
                  className="h-8 rounded-mark px-2 text-xs text-bone-dim hover:text-oxblood-text"
                  aria-label={`Remove question ${i + 1}`}
                >
                  Remove
                </button>
              </span>
              {q.type === "select" && (
                <input
                  value={q.options.join(", ")}
                  onChange={(e) => setQuestion(i, { options: e.target.value.split(",") })}
                  placeholder="Choices, separated by commas: line edit, structural, cut for length"
                  aria-label={`Question ${i + 1}: choices`}
                  className={`h-8 ${field}`}
                />
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => set("intake", [...form.intake, { id: "", ask: "", type: "text", options: [], required: false }])}
            data-testid="setup-add-question"
            className="h-8 self-start rounded-mark border border-rule px-3 text-base text-bone-dim hover:bg-panel hover:text-bone"
          >
            Add a question
          </button>
        </div>
      </Section>

      <Section title="Engine and budget">
        <div className="flex flex-wrap gap-3">
          <label className="flex min-w-48 flex-1 flex-col gap-1">
            <span className="text-base text-bone">The AI it runs on</span>
            <select
              value={form.engine}
              onChange={(e) => set("engine", e.target.value as Engine)}
              data-testid="setup-engine"
              className={`h-8 ${field}`}
            >
              {ENGINES.map((e) => (
                <option key={e.engine} value={e.engine} disabled={e.engine !== "claude" && e.engine !== form.engine}>
                  {e.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-48 flex-1 flex-col gap-1">
            <span className="text-base text-bone">Model</span>
            <input
              value={form.model ?? ""}
              onChange={(e) => set("model", e.target.value || null)}
              list={`${ids}-models`}
              placeholder="Blank for the default"
              data-testid="setup-model"
              className={`mono h-8 text-xs ${field}`}
            />
            <datalist id={`${ids}-models`}>
              <option value="sonnet" />
              <option value="opus" />
              <option value="haiku" />
            </datalist>
          </label>
        </div>
        <p className="text-xs text-bone-dim">
          The budget for each task <span className="text-bone-dim">(its aether)</span>. Blank means no limit. At 80% it
          is told to wrap up.
        </p>
        <div className="flex flex-wrap gap-3">
          {(
            [
              ["tokens", "Tokens", "setup-tokens"],
              ["turns", "Turns", "setup-turns"],
              ["minutes", "Minutes", "setup-minutes"],
            ] as const
          ).map(([key, label, testid]) => (
            <label key={key} className="flex w-32 flex-col gap-1">
              <span className="text-xs text-bone-dim">{label}</span>
              <input
                inputMode="numeric"
                value={budget[key]}
                onChange={(e) => {
                  setSaved(null);
                  setBudget((b) => ({ ...b, [key]: e.target.value.replace(/[^\d]/g, "") }));
                }}
                data-testid={testid}
                className={`mono h-8 text-xs ${field}`}
              />
            </label>
          ))}
          <label className="flex min-w-56 flex-1 flex-col gap-1">
            <span className="text-xs text-bone-dim">When it runs out</span>
            <select
              value={form.aether.on_exceed}
              onChange={(e) => set("aether", { ...form.aether, on_exceed: e.target.value as OnExceed })}
              data-testid="setup-on-exceed"
              className={`h-8 ${field}`}
            >
              {(Object.keys(EXCEED_PLAIN) as OnExceed[]).map((k) => (
                <option key={k} value={k}>
                  {EXCEED_PLAIN[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Section>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          data-testid="setup-save"
          className="h-8 rounded-mark border border-brass bg-panel px-4 text-base text-bone transition-colors duration-150 hover:bg-void disabled:text-bone-dim"
        >
          {id === null ? `Create ${form.name.trim() || "this familiar"}` : "Save"}
        </button>
        {saved && (
          <span role="status" className="text-base text-verdigris-text" data-testid="setup-saved">
            {saved}
          </span>
        )}
        {error && (
          <span role="alert" className="text-base text-oxblood-text" data-testid="setup-error">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="display text-md text-bone">{title}</h2>
      {children}
    </section>
  );
}

/** The whole-window view behind "New familiar" in the rail. */
export function NewFamiliar() {
  const load = useStore((s) => s.load);
  const select = useStore((s) => s.select);
  const setTab = useStore((s) => s.setTab);
  const home = useStore((s) => s.home);
  return (
    <main className="flex min-w-0 flex-1 flex-col bg-void" data-testid="new-familiar-view">
      <header className="flex h-12 shrink-0 items-center px-4">
        <h1 className="display text-md text-bone">A new familiar</h1>
      </header>
      <Rule />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 rule-scroll">
        <p className="measure mb-6 text-base text-bone-dim">
          A familiar is an AI agent with a name, a folder to work in, standing instructions and a limit on what it may do
          alone. This writes its binding file
          {home ? (
            <>
              {" "}
              into <span className="mono text-xs">{home.bindings}</span>
            </>
          ) : null}
          , which you can also edit by hand.
        </p>
        <FamiliarForm
          id={null}
          initial={blankForm()}
          onSaved={(id) => {
            void load().then(() => {
              select(id);
              setTab("commission");
            });
          }}
        />
      </div>
    </main>
  );
}

/** The settings tab: the familiar's binding, as the form. */
export function Settings({ familiar, live }: { familiar: FamiliarSummary; live: boolean }) {
  const load = useStore((s) => s.load);
  const [form, setForm] = useState<BindingForm | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  // Filled once per familiar, not on every roster tick, which would throw away whatever was
  // being typed.
  useEffect(() => {
    let live = true;
    setForm(null);
    setError(null);
    void backend()
      .then((b) => b.bindingForm(familiar.id))
      .then((f) => {
        if (live) setForm(f);
      })
      .catch((e) => {
        if (live) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      live = false;
    };
  }, [familiar.id]);

  async function remove() {
    setRemoveError(null);
    try {
      await (await backend()).bindingRemove(familiar.id);
      await load();
    } catch (e) {
      setRemoveError(e instanceof Error ? e.message : String(e));
    }
  }

  if (error) {
    return (
      <div className="measure flex flex-col gap-2" data-testid="settings-error">
        <p className="text-base text-oxblood-text">{error}</p>
        <p className="mono text-xs text-bone-dim">{familiar.binding_path}</p>
      </div>
    );
  }
  if (!form) return <p className="text-base text-bone-dim">Reading the binding…</p>;

  return (
    <div className="flex flex-col gap-2" data-testid="settings">
      <p className="measure mb-4 text-xs text-bone-dim">
        These are written into <span className="mono">{familiar.binding_path}</span>. Anything this page does not show is
        left as the file has it.
      </p>
      <FamiliarForm
        key={familiar.id}
        id={familiar.id}
        initial={form}
        live={live}
        onSaved={() => void load()}
      />
      <Rule />
      <div className="measure flex flex-col gap-2 pt-4">
        {!removing ? (
          <button
            type="button"
            onClick={() => setRemoving(true)}
            data-testid="setup-remove"
            className="h-8 self-start rounded-mark border border-rule px-3 text-base text-bone-dim hover:border-oxblood hover:text-oxblood-text"
          >
            Put {familiar.name} away
          </button>
        ) : (
          <div className="flex flex-col gap-2 border-l-2 border-oxblood pl-3" data-testid="setup-remove-confirm">
            <p className="text-base text-bone">
              Put {familiar.name} away? It leaves the rail and the floor. Its file is renamed rather than deleted, so it can
              be brought back by renaming it.
            </p>
            <span className="flex gap-3">
              <button
                type="button"
                onClick={() => void remove()}
                data-testid="setup-remove-yes"
                className="h-8 rounded-mark border border-oxblood px-3 text-base text-bone hover:bg-panel"
              >
                Put away
              </button>
              <button
                type="button"
                onClick={() => setRemoving(false)}
                className="h-8 rounded-mark border border-rule px-3 text-base text-bone-dim hover:bg-panel hover:text-bone"
              >
                Keep {familiar.name}
              </button>
            </span>
            {removeError && (
              <p role="alert" className="text-base text-oxblood-text">
                {removeError}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Said where the eye is when a familiar's folder is not on this machine, with the fix one press
 * away. The starter familiars point at the owner's own folders, which no other Mac has — and
 * until this, the first sign of it was an error in the terminal after pressing Summon.
 */
export function FolderFix({ familiar }: { familiar: FamiliarSummary }) {
  const load = useStore((s) => s.load);
  const setTab = useStore((s) => s.setTab);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function choose() {
    setError(null);
    setBusy(true);
    try {
      const b = await backend();
      const chosen = await b.pickFolder();
      if (!chosen) return;
      const form = await b.bindingForm(familiar.id);
      await b.bindingSave(familiar.id, { ...form, workspace: chosen });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="measure mb-5 flex flex-col gap-2 border-l-2 border-brass pl-3" data-testid="folder-fix">
      <p className="text-base text-bone">
        {familiar.name} works in <span className="mono text-xs">{familiar.workspace}</span>, which is not on this machine.
        Choose the folder it should work in before you summon it.
      </p>
      <span className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void choose()}
          disabled={busy}
          data-testid="folder-fix-pick"
          className="h-7 rounded-mark border border-brass px-3 text-base text-bone hover:bg-panel disabled:text-bone-dim"
        >
          Choose a folder
        </button>
        <button
          type="button"
          onClick={() => setTab("settings")}
          className="h-7 rounded-mark px-1 text-base text-bone-dim underline underline-offset-4 hover:text-bone"
        >
          All its settings
        </button>
      </span>
      {error && (
        <p role="alert" className="text-base text-oxblood-text">
          {error}
        </p>
      )}
    </div>
  );
}
