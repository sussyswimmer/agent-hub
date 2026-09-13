// The waypoint graph, and every route across it, worked out once at load (§8.2, §8.6).
//
// §8.6 is explicit that there is no pathfinding at runtime: routes between stations are
// precomputed. There are ten stations, so there are ninety ordered pairs, and solving all of
// them costs less than a frame — done once here rather than once per walk.
//
// **Why a graph at all, when the room is a disc.** A disc is convex, so a straight line between
// any two points inside it already stays inside: no wall can be crossed by walking directly.
// The graph is not there to avoid the wall. It is there so a familiar crossing the room walks
// *around* the ward circle rather than straight through the middle of it — the centre of this
// room means something (§8.4: anyone standing there is waiting on you), and traffic strolling
// across it would say something untrue every time.

import {
  CENTRE,
  CONCOURSE_RADIUS,
  DESK_DEPTH,
  DESK_RADIUS,
  type Point,
  STATIONS,
  type Station,
  WALL_INNER,
  at,
  distance,
  station,
} from "./plan";

/** How many nodes the concourse ring carries. Twelve gives a walk that curves rather than turns. */
const CONCOURSE_NODES = 12;

interface Node {
  id: string;
  at: Point;
}

/** Where a familiar heading for a station aims before it takes its own slot. */
export function approach(s: Station): Point {
  switch (s.kind) {
    case "desk":
      return at(s.bearing, DESK_RADIUS - DESK_DEPTH / 2 - 34);
    case "ward":
      return CENTRE;
    case "door":
      return at(0, WALL_INNER - 46);
    default:
      return at(s.bearing, 358);
  }
}

const concourse: Node[] = Array.from({ length: CONCOURSE_NODES }, (_, i) => {
  const bearing = (360 / CONCOURSE_NODES) * i;
  return { id: `concourse-${i}`, at: at(bearing, CONCOURSE_RADIUS) };
});

const stationNodes: Node[] = STATIONS.map((s) => ({ id: s.id, at: approach(s) }));

const NODES: Node[] = [...concourse, ...stationNodes];
const NODE_AT = new Map(NODES.map((n) => [n.id, n.at]));

/** Undirected adjacency. Weights are plain distance, so the shortest route is the shortest walk. */
const EDGES = new Map<string, string[]>();

function link(a: string, b: string) {
  if (a === b) return;
  for (const [from, to] of [
    [a, b],
    [b, a],
  ] as const) {
    const list = EDGES.get(from) ?? [];
    if (!list.includes(to)) list.push(to);
    EDGES.set(from, list);
  }
}

// The ring itself.
for (let i = 0; i < concourse.length; i++) {
  link(concourse[i]!.id, concourse[(i + 1) % concourse.length]!.id);
}

// Every station joins the ring at whichever node it is nearest — which, because both the ring
// and the stations are laid out by bearing, is the one on its own side of the room.
for (const s of STATIONS) {
  if (s.kind === "ward") {
    // The centre reaches the ring in every direction, so a familiar called to the seal leaves
    // by the shortest way rather than always by the north.
    for (const c of concourse) link(s.id, c.id);
    continue;
  }
  const target = approach(s);
  let nearest = concourse[0]!;
  for (const c of concourse) {
    if (distance(c.at, target) < distance(nearest.at, target)) nearest = c;
  }
  link(s.id, nearest.id);
}

/**
 * Dijkstra, with one rule: the centre is never walked *through*.
 *
 * Without it the shortest route between two opposite desks runs straight across the ward circle,
 * because through the middle of a disc is always shorter than around it. Dropping the node
 * unless it is an endpoint is the whole of the fix, and it is stated here rather than buried in
 * an edge weight nobody would be able to read back.
 */
function shortest(fromId: string, toId: string): string[] {
  const usable = (id: string) => id !== "ward" || id === fromId || id === toId;

  const dist = new Map<string, number>([[fromId, 0]]);
  const previous = new Map<string, string>();
  const seen = new Set<string>();

  for (;;) {
    let current: string | null = null;
    for (const [id, d] of dist) {
      if (seen.has(id)) continue;
      if (current === null || d < dist.get(current)!) current = id;
    }
    if (current === null) break;
    if (current === toId) break;
    seen.add(current);

    for (const next of EDGES.get(current) ?? []) {
      if (!usable(next) || seen.has(next)) continue;
      const step = dist.get(current)! + distance(NODE_AT.get(current)!, NODE_AT.get(next)!);
      if (step < (dist.get(next) ?? Infinity)) {
        dist.set(next, step);
        previous.set(next, current);
      }
    }
  }

  if (!dist.has(toId)) return [];
  const path: string[] = [toId];
  while (path[0] !== fromId) {
    const back = previous.get(path[0]!);
    if (!back) return [];
    path.unshift(back);
  }
  return path;
}

/** Every route, solved once. Keyed `from>to`. */
const ROUTES = new Map<string, Point[]>();
for (const from of STATIONS) {
  for (const to of STATIONS) {
    if (from.id === to.id) continue;
    const ids = shortest(from.id, to.id);
    // The first node is where the familiar already is, so it is not a step.
    ROUTES.set(`${from.id}>${to.id}`, ids.slice(1).map((id) => NODE_AT.get(id)!));
  }
}

/**
 * The waypoints to walk from one station to another, ending at the destination's approach.
 *
 * The familiar's own slot is not in here: where it stands when it arrives depends on who else is
 * already there, which is not a property of the room.
 */
export function route(fromId: string, toId: string): Point[] {
  if (fromId === toId) return [];
  return ROUTES.get(`${fromId}>${toId}`) ?? [approach(station(toId))];
}

/** The whole walk, including the slot it finishes in. */
export function walk(fromId: string, toId: string, finish: Point): Point[] {
  const legs = route(fromId, toId);
  const last = legs[legs.length - 1];
  // The approach and the slot can be the same point — a single familiar at the ward circle
  // stands exactly on it — and a zero-length final leg makes the tween divide by nothing.
  if (last && distance(last, finish) < 1) return legs;
  return [...legs, finish];
}

/** Exposed for the tests, which check that no route clips the ward circle or leaves the room. */
export const _graph = { NODES, EDGES, concourse };
