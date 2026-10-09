// PixiJS view of a room. Purely visual: it never decides anything about the game,
// it only draws the simulation state and plays "juice" (particles, shake, glow).

import { Application, BlurFilter, Container, Graphics } from 'pixi.js';
import type { Room, Shot, WallKind } from '../sim/types';
import { BALL_R, HEIGHT, WIDTH } from '../sim/world';

export const COLORS = {
  bg: 0x070a16,
  room: 0x0c1226,
  grid: 0x151d3b,
  wall: 0x4cc9f0,
  bouncy: 0xf72585,
  bumper: 0xffd166,
  target: 0xff9f1c,
  ball: 0xffffff,
  trail: 0x9be7ff,
  aim: 0xffffff,
};

const HUD_TOP = 64;
const HUD_BOTTOM = 12;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: number;
  size: number;
}

interface Ring {
  x: number;
  y: number;
  r: number;
  grow: number;
  life: number;
  max: number;
  color: number;
  width: number;
}

interface TargetView {
  sharp: Graphics;
  glow: Graphics;
  phase: number;
  /** <0: alive. >=0: seconds since it was hit. */
  hitT: number;
}

export class Renderer {
  readonly app = new Application();
  private readonly world = new Container();
  private readonly glowLayer = new Container();
  private readonly sharpLayer = new Container();
  private readonly roomG = new Graphics();
  private readonly glowStatic = new Graphics();
  private readonly sharpStatic = new Graphics();
  private readonly trailG = new Graphics();
  private readonly aimG = new Graphics();
  private readonly ballG = new Graphics();
  private readonly ballGlow = new Graphics();
  private readonly fxG = new Graphics();
  private readonly bumperFlash: number[] = [];
  private bumperG: Graphics[] = [];
  private targets: TargetView[] = [];
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private trail: { x: number; y: number }[] = [];
  private shakeAmt = 0;
  private time = 0;
  private baseX = 0;
  private baseY = 0;
  private lastW = 0;
  private lastH = 0;
  scale = 1;

  async init(parent: HTMLElement): Promise<void> {
    await this.app.init({
      resizeTo: parent,
      background: COLORS.bg,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
    });
    parent.appendChild(this.app.canvas);

    this.glowLayer.filters = [new BlurFilter({ strength: 12, quality: 3 })];
    this.glowLayer.blendMode = 'add';
    this.trailG.blendMode = 'add';
    this.fxG.blendMode = 'add';

    this.glowLayer.addChild(this.glowStatic, this.ballGlow);
    this.sharpLayer.addChild(this.sharpStatic, this.trailG, this.aimG, this.ballG, this.fxG);
    this.world.addChild(this.roomG, this.glowLayer, this.sharpLayer);
    this.app.stage.addChild(this.world);
    this.layout();
  }

  get canvas(): HTMLCanvasElement {
    return this.app.canvas;
  }

  /** Fits the 720x1280 room into the screen, leaving space for the HUD. */
  private layout(): void {
    const w = this.app.screen.width;
    const h = this.app.screen.height;
    if (w === this.lastW && h === this.lastH) return;
    this.lastW = w;
    this.lastH = h;
    const availH = Math.max(100, h - HUD_TOP - HUD_BOTTOM);
    this.scale = Math.min((w - 16) / WIDTH, availH / HEIGHT);
    this.world.scale.set(this.scale);
    this.baseX = (w - WIDTH * this.scale) / 2;
    this.baseY = HUD_TOP + (availH - HEIGHT * this.scale) / 2;
    this.world.position.set(this.baseX, this.baseY);
  }

  /** Converts a pointer position (client coords) to room coordinates. */
  toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.app.canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left - this.baseX) / this.scale,
      y: (clientY - rect.top - this.baseY) / this.scale,
    };
  }

  buildRoom(room: Room): void {
    const r = this.roomG.clear();
    r.roundRect(0, 0, WIDTH, HEIGHT, 6).fill({ color: COLORS.room });
    for (let x = 40; x < WIDTH; x += 40) r.moveTo(x, 0).lineTo(x, HEIGHT);
    for (let y = 40; y < HEIGHT; y += 40) r.moveTo(0, y).lineTo(WIDTH, y);
    r.stroke({ width: 1, color: COLORS.grid, alpha: 0.7 });

    const g = this.glowStatic.clear();
    const s = this.sharpStatic.clear();

    // Room border.
    g.rect(0, 0, WIDTH, HEIGHT).stroke({ width: 10, color: COLORS.wall, alpha: 0.35 });
    s.rect(0, 0, WIDTH, HEIGHT).stroke({ width: 4, color: COLORS.wall, alpha: 0.6 });

    // Start pad.
    s.circle(room.start.x, room.start.y, BALL_R + 10).stroke({ width: 2, color: COLORS.aim, alpha: 0.25 });

    for (const w of room.walls.slice(4)) {
      const color = wallColor(w.kind);
      g.moveTo(w.x1, w.y1).lineTo(w.x2, w.y2).stroke({ width: 18, color, alpha: 0.9, cap: 'round' });
      s.moveTo(w.x1, w.y1).lineTo(w.x2, w.y2).stroke({ width: 7, color, cap: 'round' });
      s.moveTo(w.x1, w.y1).lineTo(w.x2, w.y2).stroke({ width: 2, color: 0xffffff, alpha: 0.7, cap: 'round' });
    }

    for (const b of this.bumperG) b.destroy();
    this.bumperG = room.bumpers.map((b) => {
      g.circle(b.x, b.y, b.r).stroke({ width: 14, color: COLORS.bumper, alpha: 0.9 });
      const bg = new Graphics();
      bg.circle(0, 0, b.r).fill({ color: COLORS.bumper, alpha: 0.12 }).stroke({ width: 6, color: COLORS.bumper });
      bg.circle(0, 0, b.r * 0.35).fill({ color: COLORS.bumper, alpha: 0.8 });
      bg.position.set(b.x, b.y);
      this.sharpLayer.addChildAt(bg, 1);
      return bg;
    });
    this.bumperFlash.length = 0;
    room.bumpers.forEach(() => this.bumperFlash.push(0));

    for (const t of this.targets) {
      t.sharp.destroy();
      t.glow.destroy();
    }
    this.targets = room.targets.map((t, i) => {
      const glow = new Graphics();
      glow.circle(0, 0, t.r).stroke({ width: 14, color: COLORS.target, alpha: 0.9 });
      glow.position.set(t.x, t.y);
      this.glowLayer.addChild(glow);
      const sharp = new Graphics();
      sharp.circle(0, 0, t.r).fill({ color: COLORS.target, alpha: 0.18 }).stroke({ width: 5, color: COLORS.target });
      sharp.circle(0, 0, 6).fill({ color: 0xffffff });
      sharp.position.set(t.x, t.y);
      this.sharpLayer.addChildAt(sharp, 1);
      return { sharp, glow, phase: i * 1.7, hitT: -1 };
    });

    this.particles = [];
    this.rings = [];
    this.clearTrail();
    this.clearAim();
    this.setBall(room.start.x, room.start.y);
  }

  resetTargets(): void {
    for (const t of this.targets) {
      t.hitT = -1;
      t.sharp.visible = t.glow.visible = true;
      t.sharp.alpha = t.glow.alpha = 1;
    }
  }

  setBall(x: number, y: number, visible = true): void {
    this.ballG.clear();
    this.ballGlow.clear();
    if (!visible) return;
    this.ballGlow.circle(x, y, BALL_R + 4).fill({ color: COLORS.trail, alpha: 0.9 });
    this.ballG.circle(x, y, BALL_R).fill({ color: COLORS.ball }).stroke({ width: 3, color: COLORS.trail });
  }

  pushTrail(x: number, y: number): void {
    this.trail.push({ x, y });
    if (this.trail.length > 36) this.trail.shift();
  }

  clearTrail(): void {
    this.trail = [];
    this.trailG.clear();
  }

  private drawTrail(): void {
    const g = this.trailG.clear();
    const n = this.trail.length;
    for (let i = 1; i < n; i++) {
      const a = this.trail[i - 1];
      const b = this.trail[i];
      const k = i / n;
      g.moveTo(a.x, a.y)
        .lineTo(b.x, b.y)
        .stroke({ width: 2 + k * (BALL_R * 1.6), color: COLORS.trail, alpha: k * k * 0.55, cap: 'round' });
    }
  }

  /** Draws the aiming UI: preview dots up to the first bounce, a direction line and a power ring. */
  drawAim(from: { x: number; y: number }, preview: { x: number; y: number }[], shot: Shot | null): void {
    const g = this.aimG.clear();
    if (!shot) return;
    const p = shot.power / 100;
    for (let i = 0; i < preview.length; i++) {
      const pt = preview[i];
      const fade = 1 - i / preview.length;
      g.circle(pt.x, pt.y, 4.5 * fade + 1.5).fill({ color: COLORS.aim, alpha: 0.25 + fade * 0.6 });
    }
    const color = powerColor(p);
    g.circle(from.x, from.y, BALL_R + 16).stroke({ width: 3, color: 0xffffff, alpha: 0.12 });
    const R = BALL_R + 16;
    g.moveTo(from.x, from.y - R)
      .arc(from.x, from.y, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * p)
      .stroke({ width: 5, color, cap: 'round' });
  }

  clearAim(): void {
    this.aimG.clear();
  }

  // --- juice -------------------------------------------------------------------

  burst(x: number, y: number, color: number, count: number, speed: number, size = 4): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.3 + Math.random() * 0.7);
      const max = 0.35 + Math.random() * 0.45;
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: max, max, color, size: size * (0.5 + Math.random()) });
    }
  }

  /** Sparks sprayed along a surface normal. */
  sparks(x: number, y: number, nx: number, ny: number, color: number, count: number, speed: number): void {
    const base = Math.atan2(ny, nx);
    for (let i = 0; i < count; i++) {
      const a = base + (Math.random() - 0.5) * 2.2;
      const v = speed * (0.4 + Math.random() * 0.6);
      const max = 0.2 + Math.random() * 0.3;
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: max, max, color, size: 2 + Math.random() * 2.5 });
    }
  }

  ring(x: number, y: number, color: number, r0: number, grow: number, life: number, width = 4): void {
    this.rings.push({ x, y, r: r0, grow, life, max: life, color, width });
  }

  shake(amount: number): void {
    this.shakeAmt = Math.min(24, this.shakeAmt + amount);
  }

  flashBumper(i: number): void {
    this.bumperFlash[i] = 1;
  }

  hitTarget(i: number): void {
    const t = this.targets[i];
    if (t) t.hitT = 0;
  }

  confetti(): void {
    const colors = [COLORS.wall, COLORS.bouncy, COLORS.bumper, COLORS.target, 0xffffff];
    for (let i = 0; i < 140; i++) {
      const x = Math.random() * WIDTH;
      const max = 1.2 + Math.random() * 1.2;
      this.particles.push({
        x,
        y: -20 - Math.random() * 200,
        vx: (Math.random() - 0.5) * 200,
        vy: 300 + Math.random() * 500,
        life: max,
        max,
        color: colors[i % colors.length],
        size: 3 + Math.random() * 4,
      });
    }
  }

  /** Per-frame visual update (dt in real seconds). */
  update(dt: number): void {
    this.layout();
    this.time += dt;

    for (const t of this.targets) {
      if (t.hitT < 0) {
        const s = 1 + Math.sin(this.time * 4 + t.phase) * 0.07;
        t.sharp.scale.set(s);
        t.glow.scale.set(s);
        t.glow.alpha = 0.7 + Math.sin(this.time * 4 + t.phase) * 0.3;
      } else if (t.sharp.visible) {
        t.hitT += dt;
        const k = t.hitT / 0.3;
        t.sharp.scale.set(1 + k * 0.9);
        t.glow.scale.set(1 + k * 1.4);
        t.sharp.alpha = t.glow.alpha = Math.max(0, 1 - k);
        if (k >= 1) t.sharp.visible = t.glow.visible = false;
      }
    }

    this.bumperG.forEach((g, i) => {
      const f = this.bumperFlash[i];
      g.scale.set(1 + f * 0.25);
      g.alpha = 0.85 + f * 0.15;
      this.bumperFlash[i] = Math.max(0, f - dt * 5);
    });

    const fx = this.fxG.clear();
    this.particles = this.particles.filter((p) => (p.life -= dt) > 0);
    for (const p of this.particles) {
      p.vx *= 1 - dt * 2.5;
      p.vy *= 1 - dt * 2.5;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const k = p.life / p.max;
      fx.circle(p.x, p.y, p.size * (0.4 + k * 0.6)).fill({ color: p.color, alpha: k });
    }
    this.rings = this.rings.filter((r) => (r.life -= dt) > 0);
    for (const r of this.rings) {
      r.r += r.grow * dt;
      const k = r.life / r.max;
      fx.circle(r.x, r.y, r.r).stroke({ width: r.width * k + 0.5, color: r.color, alpha: k });
    }

    this.drawTrail();

    this.shakeAmt *= Math.pow(0.002, dt);
    const sx = (Math.random() - 0.5) * this.shakeAmt * this.scale;
    const sy = (Math.random() - 0.5) * this.shakeAmt * this.scale;
    this.world.position.set(this.baseX + sx, this.baseY + sy);
  }
}

export function wallColor(kind: WallKind): number {
  return kind === 'bouncy' ? COLORS.bouncy : COLORS.wall;
}

function powerColor(p: number): number {
  if (p < 0.4) return 0x4cc9f0;
  if (p < 0.75) return 0xffd166;
  return 0xf72585;
}
