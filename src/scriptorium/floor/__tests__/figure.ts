// What a familiar standing somewhere covers, shared by the plan and wander tests.

import { FIGURE_HALF_WIDTH, FIGURE_REACH, ORDERS, SIGIL_SIZE, deskCorners, station } from "../plan";

/**
 * Whether a familiar standing at `p` covers any desk: its figure, as a box from just below its
 * feet up to the top of its head and a body's width across.
 */
export function reachesDesk(p: { x: number; y: number }): boolean {
  for (const o of ORDERS) {
    const [a, b, , d] = deskCorners(station(`desk-${o}`));
    const along = { x: b.x - a.x, y: b.y - a.y };
    const across = { x: d.x - a.x, y: d.y - a.y };
    const onDesk = (q: { x: number; y: number }) => {
      const u = ((q.x - a.x) * along.x + (q.y - a.y) * along.y) / (along.x ** 2 + along.y ** 2);
      const v = ((q.x - a.x) * across.x + (q.y - a.y) * across.y) / (across.x ** 2 + across.y ** 2);
      return u > 0 && u < 1 && v > 0 && v < 1;
    };
    for (let dx = -FIGURE_HALF_WIDTH; dx <= FIGURE_HALF_WIDTH; dx += 5) {
      for (let up = -SIGIL_SIZE / 2; up <= FIGURE_REACH; up += 4) {
        if (onDesk({ x: p.x + dx, y: p.y - up })) return true;
      }
    }
  }
  return false;
}
