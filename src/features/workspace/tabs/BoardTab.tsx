import { EmptyState } from "@/components/EmptyState";
import type { AgentSummary } from "@/lib/types";

import { CollegeBoard } from "@/features/boards/college";
import { ResearchBoard } from "@/features/boards/research";
import { SchoolBoard } from "@/features/boards/school";
import { ScoutBoard } from "@/features/boards/scout";
import { TutorBoard } from "@/features/boards/tutor";

export const BOARD_TITLES: Record<string, string> = { research_library: "Library", college_tracker: "Tracker", scout_opportunities: "Opportunities", school_planner: "Planner", tutor_review: "Review" };

export function BoardTab({ agent, board }: { agent: AgentSummary; board: string | null }) {
  switch (board) {
    case "research_library": return <ResearchBoard />;
    case "college_tracker": return <CollegeBoard />;
    case "scout_opportunities": return <ScoutBoard />;
    case "school_planner": return <SchoolBoard />;
    case "tutor_review": return <TutorBoard />;
    default: return <EmptyState title={`${agent.name} has no board`} hint="Boards are declared per agent in agent.md (board:)." />;
  }
}
