import { Tabs } from "radix-ui";
import { useEffect, useState } from "react";

import { useStore } from "@/app/store";
import type { AgentDetail, AgentSummary } from "@/lib/types";

import { Header } from "./Header";
import { BoardTab, BOARD_TITLES } from "./tabs/BoardTab";
import { ChatTab } from "./tabs/ChatTab";
import { OutputsTab } from "./tabs/OutputsTab";
import { QueueTab } from "./tabs/QueueTab";

export function Workspace({ agent }: { agent: AgentSummary }) {
  const { backend, state } = useStore();
  const [tab, setTab] = useState("chat");
  const [newTaskTick, setNewTaskTick] = useState(0);
  useEffect(() => { if (state.newTaskTick > 0) { setTab("chat"); setNewTaskTick((n) => n + 1); } }, [state.newTaskTick]);
  const [detail, setDetail] = useState<AgentDetail | null>(null);
  useEffect(() => { setTab("chat"); }, [agent.id]);
  useEffect(() => { void backend?.getAgent(agent.id).then(setDetail); }, [backend, agent.id, agent.hash]);
  const board = detail?.def?.board ?? null;
  const boardTitle = (board && BOARD_TITLES[board]) ?? "Board";
  const trigger = (v: string, label: string) => (
    <Tabs.Trigger value={v} className="h-6 rounded-[5px] px-3 text-sm text-secondary transition-colors duration-150 data-[state=active]:bg-card data-[state=active]:font-medium data-[state=active]:text-label data-[state=active]:shadow-sm" data-tab={v}>{label}</Tabs.Trigger>
  );
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-surface">
      <Header agent={agent} onNewTask={() => { setTab("chat"); setNewTaskTick((n) => n + 1); }} />
      <Tabs.Root value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <Tabs.List className="mx-4 mt-2 inline-flex w-fit rounded-mac bg-input p-0.5" aria-label="Workspace tabs">
          {trigger("chat", "Chat")}{trigger("queue", "Queue")}{trigger("board", boardTitle)}{trigger("outputs", "Outputs")}
        </Tabs.List>
        <Tabs.Content value="chat" className="min-h-0 flex-1 outline-none"><ChatTab agent={agent} newTaskTick={newTaskTick} /></Tabs.Content>
        <Tabs.Content value="queue" className="min-h-0 flex-1 outline-none"><QueueTab agent={agent} /></Tabs.Content>
        <Tabs.Content value="board" className="min-h-0 flex-1 outline-none"><BoardTab agent={agent} board={board} /></Tabs.Content>
        <Tabs.Content value="outputs" className="min-h-0 flex-1 outline-none"><OutputsTab agent={agent} /></Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
