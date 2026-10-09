import { describe, expect, it } from 'vitest';
import campaign from '../../src/levels/campaign.json';
import { angleToDir, dcos, dsin } from '../../src/sim/dmath';
import { Rng } from '../../src/sim/rng';
import type { Room } from '../../src/sim/types';
import { Sim, simulate } from '../../src/sim/world';

const LEVELS = campaign as Room[];

describe('deterministic math', () => {
  it('dsin/dcos match Math.sin/cos closely', () => {
    for (let i = -2000; i <= 2000; i++) {
      const x = i * 0.0137;
      expect(Math.abs(dsin(x) - Math.sin(x))).toBeLessThan(1e-13);
      expect(Math.abs(dcos(x) - Math.cos(x))).toBeLessThan(1e-13);
    }
  });

  it('angle convention: 0 = right, 900 = up (screen y grows down)', () => {
    const right = angleToDir(0);
    const up = angleToDir(900);
    expect(right.x).toBeCloseTo(1, 12);
    expect(right.y).toBeCloseTo(0, 12);
    expect(up.x).toBeCloseTo(0, 12);
    expect(up.y).toBeCloseTo(-1, 12);
  });
});

describe('rng', () => {
  it('is reproducible from a seed', () => {
    const a = new Rng(1234);
    const b = new Rng(1234);
    for (let i = 0; i < 100; i++) expect(a.nextU32()).toBe(b.nextU32());
  });

  it('pins the sequence (changing it would change every generated room)', () => {
    const r = new Rng(42);
    expect([r.nextU32(), r.nextU32(), r.nextU32()]).toMatchInlineSnapshot(`
      [
        2852766471,
        4136168353,
        1126838629,
      ]
    `);
  });
});

describe('simulation', () => {
  it('is deterministic: the same shot gives bit-identical results', () => {
    const room = LEVELS[10];
    const shot = { angle: 1234, power: 77 };
    const a = new Sim(room, shot);
    const b = new Sim(room, shot);
    while (!a.done) {
      a.step();
      b.step();
      expect(b.x).toBe(a.x);
      expect(b.y).toBe(a.y);
    }
    expect(b.done).toBe(true);
  });

  it('always stops', () => {
    for (const room of LEVELS.slice(0, 5)) {
      for (let angle = 100; angle < 1800; angle += 157) {
        const r = simulate(room, { angle, power: 100 }, false);
        expect(r.ticks).toBeGreaterThan(0);
        expect(r.ticks).toBeLessThanOrEqual(240 * 15);
      }
    }
  });

  it('never lets the ball escape the room', () => {
    for (const room of LEVELS) {
      for (let angle = 0; angle < 3600; angle += 211) {
        const sim = new Sim(room, { angle, power: 100 });
        let escaped = false;
        while (!sim.done) {
          sim.step();
          if (sim.x <= 0 || sim.x >= room.width || sim.y <= 0 || sim.y >= room.height) escaped = true;
        }
        expect(escaped, `${room.id} angle ${angle}`).toBe(false);
      }
    }
  }, 30_000);

  it('golden trajectory: physics changes must be deliberate (regenerate levels if this changes)', () => {
    const r = simulate(LEVELS[0], { angle: 777, power: 64 }, false);
    expect([r.ticks, r.finalX, r.finalY]).toMatchSnapshot();
  });
});

describe('campaign', () => {
  it('has 20 levels', () => {
    expect(LEVELS).toHaveLength(20);
  });

  it.each(LEVELS.map((room, i) => [i + 1, room] as const))('level %i: stored solution solves it', (_n, room) => {
    const r = simulate(room, room.solution);
    expect(r.solved).toBe(true);
  });

  it.each(LEVELS.map((room, i) => [i + 1, room] as const))('level %i: solution is forgiving (neighbouring shots also work)', (_n, room) => {
    const { angle, power } = room.solution;
    let ok = 0;
    for (const [da, dp] of [
      [-2, 0],
      [2, 0],
      [0, -2],
      [0, 2],
    ]) {
      if (simulate(room, { angle: angle + da, power: power + dp }).solved) ok++;
    }
    expect(ok).toBeGreaterThanOrEqual(3);
  });
});
