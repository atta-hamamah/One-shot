// Procedural room generator.
//
// 1. Scatter walls and bumpers.
// 2. Fire a random shot and record its path.
// 3. Drop targets onto that path after N bounces, so a solution is guaranteed.
// 4. Run the solver to rate the room and reject ones that are too easy/hard.

import { dcos, dsin, PI } from '../sim/dmath';
import { Rng } from '../sim/rng';
import type { Circle, Room, Wall } from '../sim/types';
import { BALL_R, HEIGHT, Sim, WIDTH } from '../sim/world';
import { dist, pointSegDist, segSegDist } from './geometry';
import { solve } from './solver';

export interface GenParams {
  targets: number;
  walls: [number, number];
  bumpers: [number, number];
  bouncyChance: number;
  /** The easiest solution must need at least this many bounces. */
  minBounces: number;
  /** Accepted range of solver solve rate. */
  solveRate: [number, number];
}

const TARGET_R = 22;
const START_Y = 1160;

function borderWalls(): Wall[] {
  const w = WIDTH;
  const h = HEIGHT;
  return [
    { x1: 0, y1: 0, x2: w, y2: 0, kind: 'wall' },
    { x1: w, y1: 0, x2: w, y2: h, kind: 'wall' },
    { x1: w, y1: h, x2: 0, y2: h, kind: 'wall' },
    { x1: 0, y1: h, x2: 0, y2: 0, kind: 'wall' },
  ];
}

interface PathPoint {
  x: number;
  y: number;
  tick: number;
  bounces: number;
}

function layout(rng: Rng, p: GenParams): Omit<Room, 'targets' | 'solution' | 'solveRate' | 'minBounces' | 'id' | 'seed'> | null {
  const start = { x: Math.round(rng.range(200, 520)), y: START_Y };
  const interior: Wall[] = [];
  const wallCount = rng.int(p.walls[0], p.walls[1]);
  for (let tries = 0; interior.length < wallCount && tries < 200; tries++) {
    const deg = rng.int(0, 11) * 15;
    const len = rng.range(120, 320);
    const cx = rng.range(60, WIDTH - 60);
    const cy = rng.range(160, 1000);
    const rad = (deg / 180) * PI;
    const hx = (dcos(rad) * len) / 2;
    const hy = (dsin(rad) * len) / 2;
    const w: Wall = {
      x1: Math.round(cx - hx),
      y1: Math.round(cy - hy),
      x2: Math.round(cx + hx),
      y2: Math.round(cy + hy),
      kind: rng.chance(p.bouncyChance) ? 'bouncy' : 'wall',
    };
    const inBounds = [w.x1, w.x2].every((x) => x >= 40 && x <= WIDTH - 40) && [w.y1, w.y2].every((y) => y >= 80 && y <= 1060);
    if (!inBounds) continue;
    if (pointSegDist(start.x, start.y, w) < 160) continue;
    if (interior.some((o) => segSegDist(o, w) < 56)) continue;
    interior.push(w);
  }
  if (interior.length < p.walls[0]) return null;

  const bumpers: Circle[] = [];
  const bumperCount = rng.int(p.bumpers[0], p.bumpers[1]);
  for (let tries = 0; bumpers.length < bumperCount && tries < 200; tries++) {
    const b: Circle = { x: Math.round(rng.range(90, WIDTH - 90)), y: Math.round(rng.range(160, 980)), r: Math.round(rng.range(24, 38)) };
    if (dist(b.x, b.y, start.x, start.y) < 200) continue;
    if (interior.some((w) => pointSegDist(b.x, b.y, w) < b.r + 44)) continue;
    if (bumpers.some((o) => dist(o.x, o.y, b.x, b.y) < o.r + b.r + 44)) continue;
    bumpers.push(b);
  }
  if (bumpers.length < p.bumpers[0]) return null;

  return { width: WIDTH, height: HEIGHT, start, walls: [...borderWalls(), ...interior], bumpers };
}

function recordPath(room: Room, angle: number, power: number): PathPoint[] {
  const sim = new Sim(room, { angle, power });
  const path: PathPoint[] = [];
  while (!sim.done) {
    sim.step();
    path.push({ x: sim.x, y: sim.y, tick: sim.tick, bounces: sim.bounces });
  }
  return path;
}

function targetFits(room: Room, placed: Circle[], x: number, y: number): boolean {
  if (x < 50 || x > WIDTH - 50 || y < 90 || y > 1080) return false;
  if (dist(x, y, room.start.x, room.start.y) < 240) return false;
  if (room.walls.some((w) => pointSegDist(x, y, w) < TARGET_R + BALL_R + 6)) return false;
  if (room.bumpers.some((b) => dist(x, y, b.x, b.y) < b.r + TARGET_R + 24)) return false;
  if (placed.some((t) => dist(x, y, t.x, t.y) < 120)) return false;
  return true;
}

function placeTargets(rng: Rng, room: Room, p: GenParams): Circle[] | null {
  const path = recordPath(room, rng.int(150, 1650), rng.int(55, 100));
  const total = path.length ? path[path.length - 1].bounces : 0;
  const lastBounce = p.minBounces + rng.int(0, 1);
  if (total < lastBounce) return null;

  // Bounce index for each target: the last one after `lastBounce` bounces, the rest earlier or equal.
  const slots: number[] = [];
  for (let i = 0; i < p.targets - 1; i++) slots.push(rng.int(0, lastBounce));
  slots.sort((a, b) => a - b);
  slots.push(lastBounce);

  const targets: Circle[] = [];
  for (const b of slots) {
    const segment = path.filter((pt) => pt.bounces === b && pt.tick > 40);
    if (segment.length < 20) return null;
    let placed = false;
    for (let tries = 0; tries < 30 && !placed; tries++) {
      const pt = segment[Math.floor(rng.range(0.15, 0.85) * segment.length)];
      const x = Math.round(pt.x);
      const y = Math.round(pt.y);
      if (targetFits(room, targets, x, y)) {
        targets.push({ x, y, r: TARGET_R });
        placed = true;
      }
    }
    if (!placed) return null;
  }
  return targets;
}

function lineBlocked(room: Room, t: Circle): boolean {
  const sight: Wall = { x1: room.start.x, y1: room.start.y, x2: t.x, y2: t.y, kind: 'wall' };
  return room.walls.slice(4).some((w) => segSegDist(sight, w) < BALL_R + t.r);
}

/** Rejection counters, handy when tuning the difficulty curve. */
export const genStats = { layout: 0, targets: 0, sight: 0, unsolved: 0, tooFewBounces: 0, tooHard: 0, tooEasy: 0 };

/** Generates a room from a seed. Deterministic: same seed + params, same room. */
export function generateRoom(id: string, seed: number, p: GenParams, maxAttempts = 400): Room | null {
  const rng = new Rng(seed);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const base = layout(rng, p);
    if (!base) {
      genStats.layout++;
      continue;
    }
    const draft: Room = { id, seed, ...base, targets: [], solution: { angle: 900, power: 50 }, solveRate: 0, minBounces: 0 };
    const targets = placeTargets(rng, draft, p);
    if (!targets) {
      genStats.targets++;
      continue;
    }
    draft.targets = targets;
    // Cheap pre-check before the expensive solver: a lone target that needs a bounce
    // must not be in direct line of sight of the start.
    if (p.targets === 1 && p.minBounces > 0 && !lineBlocked(draft, targets[0])) {
      genStats.sight++;
      continue;
    }
    const report = solve(draft);
    if (!report.best) {
      genStats.unsolved++;
      continue;
    }
    if (report.minBounces < p.minBounces) {
      genStats.tooFewBounces++;
      continue;
    }
    if (report.solveRate < p.solveRate[0]) {
      genStats.tooHard++;
      continue;
    }
    if (report.solveRate > p.solveRate[1]) {
      genStats.tooEasy++;
      continue;
    }
    draft.solution = report.best;
    draft.solveRate = Math.round(report.solveRate * 10000) / 10000;
    draft.minBounces = report.minBounces;
    return draft;
  }
  return null;
}

/** Difficulty curve for the 20-level campaign. */
export function campaignParams(i: number): GenParams {
  return {
    targets: i < 2 ? 1 : i < 9 ? 2 : 3,
    walls: [Math.min(1 + Math.floor(i / 4), 5), Math.min(2 + Math.floor(i / 4), 6)],
    bumpers: i < 4 ? [0, 0] : i < 10 ? [0, 1] : [1, 2],
    bouncyChance: i < 5 ? 0 : 0.3,
    minBounces: i === 0 ? 0 : i < 6 ? 1 : i < 14 ? 2 : 3,
    solveRate: i === 0 ? [0.01, 0.3] : i < 3 ? [0.002, 0.15] : [0.002, Math.max(0.02, 0.08 - i * 0.003)],
  };
}
