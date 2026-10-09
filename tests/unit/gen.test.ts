import { describe, expect, it } from 'vitest';
import { campaignParams, generateRoom } from '../../src/gen/generate';
import { solve } from '../../src/gen/solver';
import { simulate } from '../../src/sim/world';

describe('generator', () => {
  it('is deterministic: same seed, same room', () => {
    const p = campaignParams(3);
    const a = generateRoom('t', 777, p);
    const b = generateRoom('t', 777, p);
    expect(a).not.toBeNull();
    expect(b).toEqual(a);
  });

  it('only produces solvable rooms within the requested difficulty', () => {
    const p = campaignParams(6);
    const room = generateRoom('t', 2024, p)!;
    expect(room).not.toBeNull();
    expect(room.targets).toHaveLength(p.targets);
    expect(simulate(room, room.solution).solved).toBe(true);
    const report = solve(room);
    expect(report.solveRate).toBeGreaterThanOrEqual(p.solveRate[0]);
    expect(report.solveRate).toBeLessThanOrEqual(p.solveRate[1]);
    expect(report.minBounces).toBeGreaterThanOrEqual(p.minBounces);
  });
});
