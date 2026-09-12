import { EmptyState } from "@/components/EmptyState";
import type { AgentSummary } from "@/lib/types";

export function OutputsTab({ agent }: { agent: AgentSummary }) {
  return <EmptyState title={`${agent.name} outputs`} hint="Files registered with save_output appear here with previews in Phase 2." />;
}
