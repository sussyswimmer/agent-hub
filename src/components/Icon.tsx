// SF Symbol names from agent.md rendered with lucide (CLAUDE.md §4: "rendered via bundled SVG set").
import { Binoculars, Bot, Brain, Calendar, Clock, GraduationCap, Inbox, type LucideIcon, Search, Settings, TriangleAlert } from "lucide-react";

const MAP: Record<string, LucideIcon> = {
  magnifyingglass: Search,
  graduationcap: GraduationCap,
  binoculars: Binoculars,
  calendar: Calendar,
  brain: Brain,
  "exclamationmark.triangle": TriangleAlert,
  tray: Inbox,
  clock: Clock,
  gear: Settings,
};

export function Icon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  const C = MAP[name] ?? Bot;
  return <C size={size} strokeWidth={1.75} className={className} aria-hidden="true" />;
}

const COLORS: Record<string, string> = {
  red: "text-sys-red", orange: "text-sys-orange", yellow: "text-sys-yellow", green: "text-sys-green", mint: "text-sys-mint",
  teal: "text-sys-teal", cyan: "text-sys-cyan", blue: "text-sys-blue", indigo: "text-sys-indigo", purple: "text-sys-purple",
  pink: "text-sys-pink", brown: "text-sys-brown", gray: "text-sys-gray",
};

export function colorClass(color: string): string {
  return COLORS[color] ?? "text-sys-gray";
}
