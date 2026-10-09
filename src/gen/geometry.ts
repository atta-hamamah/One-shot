import type { Wall } from '../sim/types';

export function pointSegDist(px: number, py: number, w: Wall): number {
  const dx = w.x2 - w.x1;
  const dy = w.y2 - w.y1;
  let t = ((px - w.x1) * dx + (py - w.y1) * dy) / (dx * dx + dy * dy);
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const ex = px - (w.x1 + dx * t);
  const ey = py - (w.y1 + dy * t);
  return Math.sqrt(ex * ex + ey * ey);
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

export function segmentsIntersect(a: Wall, b: Wall): boolean {
  const o1 = orient(a.x1, a.y1, a.x2, a.y2, b.x1, b.y1);
  const o2 = orient(a.x1, a.y1, a.x2, a.y2, b.x2, b.y2);
  const o3 = orient(b.x1, b.y1, b.x2, b.y2, a.x1, a.y1);
  const o4 = orient(b.x1, b.y1, b.x2, b.y2, a.x2, a.y2);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

export function segSegDist(a: Wall, b: Wall): number {
  if (segmentsIntersect(a, b)) return 0;
  return Math.min(pointSegDist(a.x1, a.y1, b), pointSegDist(a.x2, a.y2, b), pointSegDist(b.x1, b.y1, a), pointSegDist(b.x2, b.y2, a));
}

export function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}
