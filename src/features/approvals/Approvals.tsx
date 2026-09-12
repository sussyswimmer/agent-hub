import { EmptyState } from "@/components/EmptyState";

export function Approvals() {
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-surface">
      <header className="flex h-12 shrink-0 items-center border-b border-separator px-4"><h2 className="text-md font-semibold">Approvals</h2></header>
      <EmptyState title="Nothing to approve" hint="Questions and proposed actions from every agent land here in Phase 2." />
    </div>
  );
}
