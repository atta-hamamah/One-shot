// The whole game simulation: one ball, static walls, round bumpers, targets.
// Fixed timestep, no engine-specific math (see dmath.ts), so a Shot always
// produces the exact same trajectory on every device.

import { angleToDir } from './dmath';
import type { Room, Shot, SimEvent, WallKind } from './types';

export const WIDTH = 720;
export const HEIGHT = 1280;
export const TICK_HZ = 240;
export const DT = 1 / TICK_HZ;
export const BALL_R = 14;

const MIN_LAUNCH = 600;
const MAX_LAUNCH = 2700;
// Must stay below BALL_R * TICK_HZ so the ball can never tunnel through a wall in one tick.
const MAX_SPEED = 3000;
const DRAG = 0.9986; // per tick
const ROLL = 70; // constant deceleration, units/s^2
const STOP_SPEED = 30;
export const MAX_TICKS = TICK_HZ * 15;

const WALL_REST = 0.86;
const BOUNCY_REST = 1.12;
const BUMPER_KICK = 260;

export function launchSpeed(power: number): number {
  return MIN_LAUNCH + ((power - 1) * (MAX_LAUNCH - MIN_LAUNCH)) / 99;
}

interface CompiledWall {
  x1: number;
  y1: number;
  dx: number;
  dy: number;
  invLen2: number;
  rest: number;
  kind: WallKind;
}

function compileWalls(room: Room): CompiledWall[] {
  return room.walls.map((w) => {
    const dx = w.x2 - w.x1;
    const dy = w.y2 - w.y1;
    return {
      x1: w.x1,
      y1: w.y1,
      dx,
      dy,
      invLen2: 1 / (dx * dx + dy * dy),
      rest: w.kind === 'bouncy' ? BOUNCY_REST : WALL_REST,
      kind: w.kind,
    };
  });
}

export class Sim {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tick = 0;
  bounces = 0;
  readonly hit: boolean[];
  remaining: number;
  solved = false;
  /** Tick at which the last target was hit, or -1. */
  solvedTick = -1;
  done = false;

  private readonly walls: CompiledWall[];

  constructor(
    readonly room: Room,
    readonly shot: Shot,
  ) {
    this.walls = compileWalls(room);
    const dir = angleToDir(shot.angle);
    const speed = launchSpeed(shot.power);
    this.x = room.start.x;
    this.y = room.start.y;
    this.vx = dir.x * speed;
    this.vy = dir.y * speed;
    this.hit = room.targets.map(() => false);
    this.remaining = room.targets.length;
  }

  get speed(): number {
    return Math.sqrt(this.vx * this.vx + this.vy * this.vy);
  }

  /** Advances one tick. Pass an array to receive the events that happened during it. */
  step(events?: SimEvent[]): void {
    if (this.done) return;
    this.tick++;

    this.x += this.vx * DT;
    this.y += this.vy * DT;

    const R = BALL_R;
    const R2 = R * R;

    for (const w of this.walls) {
      let t = ((this.x - w.x1) * w.dx + (this.y - w.y1) * w.dy) * w.invLen2;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const cx = w.x1 + w.dx * t;
      const cy = w.y1 + w.dy * t;
      const ddx = this.x - cx;
      const ddy = this.y - cy;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 >= R2 || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const nx = ddx / d;
      const ny = ddy / d;
      this.x = cx + nx * R;
      this.y = cy + ny * R;
      const vn = this.vx * nx + this.vy * ny;
      if (vn < 0) {
        this.vx -= (1 + w.rest) * vn * nx;
        this.vy -= (1 + w.rest) * vn * ny;
        this.clampSpeed();
        this.bounces++;
        events?.push({ type: 'bounce', x: cx, y: cy, nx, ny, kind: w.kind, speed: -vn });
      }
    }

    const bumpers = this.room.bumpers;
    for (let i = 0; i < bumpers.length; i++) {
      const b = bumpers[i];
      const ddx = this.x - b.x;
      const ddy = this.y - b.y;
      const rr = R + b.r;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 >= rr * rr || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const nx = ddx / d;
      const ny = ddy / d;
      this.x = b.x + nx * rr;
      this.y = b.y + ny * rr;
      const vn = this.vx * nx + this.vy * ny;
      if (vn < 0) {
        this.vx += (-2 * vn + BUMPER_KICK) * nx;
        this.vy += (-2 * vn + BUMPER_KICK) * ny;
        this.clampSpeed();
        this.bounces++;
        events?.push({ type: 'bumper', x: b.x + nx * b.r, y: b.y + ny * b.r, nx, ny, index: i, speed: -vn });
      }
    }

    const targets = this.room.targets;
    for (let i = 0; i < targets.length; i++) {
      if (this.hit[i]) continue;
      const tg = targets[i];
      const ddx = this.x - tg.x;
      const ddy = this.y - tg.y;
      const rr = R + tg.r;
      if (ddx * ddx + ddy * ddy < rr * rr) {
        this.hit[i] = true;
        this.remaining--;
        events?.push({ type: 'target', x: tg.x, y: tg.y, index: i, remaining: this.remaining });
        if (this.remaining === 0) {
          this.solved = true;
          this.solvedTick = this.tick;
          events?.push({ type: 'solved' });
        }
      }
    }

    // Drag + rolling resistance.
    this.vx *= DRAG;
    this.vy *= DRAG;
    const sp = this.speed;
    if (sp < STOP_SPEED || this.tick >= MAX_TICKS) {
      this.vx = 0;
      this.vy = 0;
      this.done = true;
      events?.push({ type: 'stopped', solved: this.solved });
      return;
    }
    const k = (sp - ROLL * DT) / sp;
    this.vx *= k;
    this.vy *= k;
  }

  private clampSpeed(): void {
    const sp = this.speed;
    if (sp > MAX_SPEED) {
      const k = MAX_SPEED / sp;
      this.vx *= k;
      this.vy *= k;
    }
  }
}

export interface SimResult {
  solved: boolean;
  ticks: number;
  /** Bounces taken by the moment the room was solved (or in total if unsolved). */
  bounces: number;
  hits: number;
  finalX: number;
  finalY: number;
}

export function simulate(room: Room, shot: Shot, stopOnSolve = true): SimResult {
  const sim = new Sim(room, shot);
  let bouncesAtSolve = -1;
  while (!sim.done) {
    sim.step();
    if (sim.solved && bouncesAtSolve < 0) {
      bouncesAtSolve = sim.bounces;
      if (stopOnSolve) break;
    }
  }
  return {
    solved: sim.solved,
    ticks: sim.tick,
    bounces: bouncesAtSolve >= 0 ? bouncesAtSolve : sim.bounces,
    hits: room.targets.length - sim.remaining,
    finalX: sim.x,
    finalY: sim.y,
  };
}
