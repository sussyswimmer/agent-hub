import { useCallback, useEffect, useState } from "react";

import { backend } from "@/lib/ipc";
import type { Engine, WorkbenchSettings } from "@/lib/types";
import { Panel, Pill, Rule } from "@/ui";
import { useStore } from "@/store";

const ENGINE_LABEL: Record<Engine, string> = {
  claude: "Claude",
  codex: "Codex",
  gemini: "Gemini",
  qwen: "Qwen",
  custom: "Custom",
};

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function date(seconds: number | null): string {
  return seconds === null ? "date unavailable" : new Date(seconds * 1000).toLocaleString();
}

export function Workbench() {
  const reloadRoster = useStore((state) => state.load);
  const [settings, setSettings] = useState<WorkbenchSettings | null>(null);
  const [paths, setPaths] = useState<Partial<Record<Engine, string>>>({});
  const [cap, setCap] = useState("10");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const next = await (await backend()).workbenchRead();
    setSettings(next);
    setPaths(Object.fromEntries(next.engines.map((row) => [row.engine, row.configured])));
    setCap(String(next.spend_cap_usd));
  }, []);

  useEffect(() => {
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [load]);

  async function act(key: string, action: () => Promise<string | null>) {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      setNotice(await action());
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-void" data-testid="workbench">
      <header className="flex h-12 shrink-0 items-center px-4">
        <div>
          <h1 className="display text-md text-bone">The workbench</h1>
          <p className="text-xs text-bone-dim">Paths, limits, and the records Grimoire keeps.</p>
        </div>
      </header>
      <Rule />
      <div className="rule-scroll min-h-0 flex-1 overflow-y-auto p-4">
        <section className="connection-deck mx-auto mb-5 max-w-5xl">
          <div className="connection-deck__story">
            <p className="mono text-xs tracking-[0.18em] text-brass-text">THE CONDUIT ROOM</p>
            <h2 className="display">Bring your own subscription.</h2>
            <p>Grimoire never asks for an API key or password. It opens the provider&apos;s own CLI sign-in, so ChatGPT and Claude subscriptions stay with their respective providers.</p>
          </div>
          <div className="connection-deck__providers">
            {(["codex", "claude"] as const).map((engine) => {
              const row = settings?.engines.find((candidate) => candidate.engine === engine);
              const available = Boolean(row?.resolved);
              return (
                <article className="connection-deck__provider" data-provider={engine} key={engine}>
                  <p className="mono text-xs text-bone-dim">{engine === "codex" ? "CHATGPT ACCOUNT" : "CLAUDE ACCOUNT"}</p>
                  <h3 className="display">{ENGINE_LABEL[engine]}</h3>
                  <p>{engine === "codex" ? "Use the ChatGPT subscription already linked to Codex." : "Use your Claude Pro or Max subscription through Claude Code."}</p>
                  <button
                    type="button"
                    disabled={!available || busy !== null}
                    onClick={() => void act(`connect-${engine}`, () => (async () => (await backend()).workbenchOpenEngineLogin(engine))())}
                  >
                    {busy === `connect-${engine}` ? "Opening..." : available ? "Open sign-in" : "Set CLI path below"}
                  </button>
                </article>
              );
            })}
          </div>
        </section>
        <div className="mx-auto grid max-w-5xl gap-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.75fr)]">
          <Panel title="Engine instruments" className="min-w-0">
            <div className="divide-y divide-rule">
              {settings?.engines.map((row) => (
                <div key={row.engine} className="grid gap-2 p-3 sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:items-center">
                  <div>
                    <p className="display text-base text-bone">{ENGINE_LABEL[row.engine]}</p>
                    <Pill tone={row.error ? "oxblood" : row.source === "workbench" ? "brass" : "verdigris"}>
                      {row.error ? "not found" : row.source === "workbench" ? "set here" : "on PATH"}
                    </Pill>
                  </div>
                  <div className="min-w-0">
                    <input
                      value={paths[row.engine] ?? ""}
                      onChange={(event) => setPaths((before) => ({ ...before, [row.engine]: event.target.value }))}
                      placeholder={row.engine === "custom" ? "Full path required" : "Leave blank to use PATH"}
                      aria-label={`${ENGINE_LABEL[row.engine]} binary path`}
                      className="mono h-8 w-full border border-rule bg-void px-2 text-xs outline-none focus:border-brass"
                    />
                    <p className={`mt-1 truncate text-xs ${row.error ? "text-oxblood-text" : "text-bone-dim"}`} title={row.error ?? row.resolved ?? undefined}>
                      {row.error ?? row.resolved}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void act(`engine-${row.engine}`, async () => {
                      await (await backend()).workbenchSetEnginePath(row.engine, paths[row.engine] ?? "");
                      await reloadRoster();
                      return `${ENGINE_LABEL[row.engine]} path saved.`;
                    })}
                    className="h-8 border border-rule bg-panel px-3 text-base text-bone hover:border-brass disabled:opacity-40"
                  >
                    {busy === `engine-${row.engine}` ? "Saving..." : "Save"}
                  </button>
                </div>
              )) ?? <p className="p-3 text-bone-dim">Reading the instruments...</p>}
            </div>
          </Panel>

          <div className="grid content-start gap-4">
            <Panel title="Runaway guard">
              <div className="p-3">
                <p className="measure text-base text-bone-dim">
                  Banish a commission when its estimated spend passes this cap. This guard acts independently of its aether budget.
                </p>
                <label className="mt-3 block text-xs text-bone-dim" htmlFor="spend-cap">Estimated dollars per commission</label>
                <div className="mt-1 flex gap-2">
                  <span className="mono flex h-8 items-center border border-r-0 border-rule bg-panel px-2 text-bone-dim">$</span>
                  <input
                    id="spend-cap"
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={cap}
                    onChange={(event) => setCap(event.target.value)}
                    className="mono h-8 min-w-0 flex-1 border border-rule bg-void px-2 outline-none focus:border-brass"
                  />
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() => void act("cap", async () => {
                      await (await backend()).workbenchSetSpendCap(Number(cap));
                      return "Runaway spend cap saved.";
                    })}
                    className="h-8 border border-rule bg-panel px-3 hover:border-brass disabled:opacity-40"
                  >
                    {busy === "cap" ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            </Panel>

            <Panel title="Shipped bindings">
              <div className="p-3">
                <p className="text-base text-bone-dim">Restore any missing shipped familiar. Existing binding files are never changed.</p>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void act("bindings", async () => {
                    const restored = await (await backend()).workbenchRestoreBindings();
                    await reloadRoster();
                    return restored.length ? `Restored ${restored.join(", ")}.` : "All shipped bindings are already present.";
                  })}
                  className="mt-3 h-8 border border-rule bg-panel px-3 hover:border-brass disabled:opacity-40"
                >
                  {busy === "bindings" ? "Restoring..." : "Restore missing bindings"}
                </button>
              </div>
            </Panel>
          </div>

          <Panel title="Local transcripts" className="min-w-0 lg:col-span-2">
            {settings && settings.transcripts.length > 0 ? (
              <div className="divide-y divide-rule">
                {settings.transcripts.map((transcript) => (
                  <div key={transcript.name} className="flex items-center gap-4 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="mono truncate text-base text-bone">{transcript.name}</p>
                      <p className="text-xs text-bone-dim">{size(transcript.bytes)} - {date(transcript.modified)}</p>
                    </div>
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void act(`transcript-${transcript.name}`, async () => {
                        await (await backend()).workbenchDeleteTranscript(transcript.name);
                        return `${transcript.name} deleted.`;
                      })}
                      className="h-8 border border-oxblood bg-transparent px-3 text-oxblood-text hover:bg-oxblood/20 disabled:opacity-40"
                    >
                      {busy === `transcript-${transcript.name}` ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="p-3 text-bone-dim">No local transcripts. Finished conversations will appear here.</p>
            )}
          </Panel>
        </div>
      </div>
      {(notice || error) && (
        <div role={error ? "alert" : "status"} className={`border-t border-rule px-4 py-2 text-base ${error ? "text-oxblood-text" : "text-verdigris-text"}`}>
          {error ?? notice}
        </div>
      )}
    </main>
  );
}
