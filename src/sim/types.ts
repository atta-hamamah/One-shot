export type WallKind = 'wall' | 'bouncy';

export interface Wall {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  kind: WallKind;
}

export interface Circle {
  x: number;
  y: number;
  r: number;
}

/** A shot is all a player ever sends: integers only, so it is trivially serialisable and replayable. */
export interface Shot {
  /** Tenths of a degree, 0..3599. 0 = right, 900 = straight up. */
  angle: number;
  /** 1..100 */
  power: number;
}

export interface Room {
  id: string;
  seed: number;
  width: number;
  height: number;
  start: { x: number; y: number };
  walls: Wall[];
  bumpers: Circle[];
  targets: Circle[];
  /** A known solving shot (guaranteed by the generator). */
  solution: Shot;
  /** Share of sampled shots that solve the room (lower = harder). */
  solveRate: number;
  /** Fewest wall/bumper bounces any sampled solution needed. */
  minBounces: number;
}

export type SimEvent =
  | { type: 'bounce'; x: number; y: number; nx: number; ny: number; kind: WallKind; speed: number }
  | { type: 'bumper'; x: number; y: number; nx: number; ny: number; index: number; speed: number }
  | { type: 'target'; x: number; y: number; index: number; remaining: number }
  | { type: 'solved' }
  | { type: 'stopped'; solved: boolean };
