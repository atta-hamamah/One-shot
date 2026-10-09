// Brute-force solver: samples a grid of shots and reports how many solve the room.
// Used by the generator to guarantee every room is solvable and to rate difficulty.

import { simulate } from '../sim/world';
import type { Room, Shot } from '../sim/types';

export const ANGLE_MIN = 50; // 5 degrees
export const ANGLE_MAX = 1750; // 175 degrees
export const ANGLE_STEP = 5; // 0.5 degrees
export const POWER_MIN = 30;
export const POWER_MAX = 100;
export const POWER_STEP = 5;

export interface SolveReport {
  samples: number;
  solutions: number;
  solveRate: number;
  /** Fewest bounces among solutions, or -1 if unsolved. */
  minBounces: number;
  /** The most forgiving solution found (most solving neighbours), or null. */
  best: Shot | null;
}

export function solve(room: Room): SolveReport {
  const angles: number[] = [];
  for (let a = ANGLE_MIN; a <= ANGLE_MAX; a += ANGLE_STEP) angles.push(a);
  const powers: number[] = [];
  for (let p = POWER_MIN; p <= POWER_MAX; p += POWER_STEP) powers.push(p);

  // grid[ai][pi] = bounces needed, or -1 if the shot fails.
  const grid: number[][] = angles.map((angle) =>
    powers.map((power) => {
      const r = simulate(room, { angle, power });
      return r.solved ? r.bounces : -1;
    }),
  );

  let solutions = 0;
  let minBounces = -1;
  let best: Shot | null = null;
  let bestScore = -1;
  for (let ai = 0; ai < angles.length; ai++) {
    for (let pi = 0; pi < powers.length; pi++) {
      const b = grid[ai][pi];
      if (b < 0) continue;
      solutions++;
      if (minBounces < 0 || b < minBounces) minBounces = b;
      let neighbours = 0;
      for (let da = -1; da <= 1; da++) {
        for (let dp = -1; dp <= 1; dp++) {
          if ((da || dp) && (grid[ai + da]?.[pi + dp] ?? -1) >= 0) neighbours++;
        }
      }
      // Prefer forgiving shots; break ties towards fewer bounces.
      const score = neighbours * 100 - b;
      if (score > bestScore) {
        bestScore = score;
        best = { angle: angles[ai], power: powers[pi] };
      }
    }
  }

  const samples = angles.length * powers.length;
  return { samples, solutions, solveRate: solutions / samples, minBounces, best };
}
