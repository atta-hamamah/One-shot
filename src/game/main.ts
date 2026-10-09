import campaign from '../levels/campaign.json';
import type { Room, Shot, SimEvent } from '../sim/types';
import { Sim, TICK_HZ } from '../sim/world';
import { haptic, Sfx } from './audio';
import { loadProgress, saveProgress } from './progress';
import { COLORS, Renderer, wallColor } from './renderer';
import './style.css';

const LEVELS = campaign as Room[];
/** Finger travel (screen px) for a full-power shot. */
const FULL_PULL_PX = 190;
const MIN_POWER = 4;

type Mode = 'menu' | 'aim' | 'fly' | 'missed' | 'won';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

class Game {
  private readonly renderer = new Renderer();
  private readonly sfx = new Sfx();
  private readonly progress = loadProgress();
  /** Test/debug speed multiplier, e.g. ?speed=8. Never changes results, only playback speed. */
  private readonly speed = Math.max(1, Number(new URLSearchParams(location.search).get('speed')) || 1);

  mode: Mode = 'menu';
  levelIndex = 0;
  tries = 1;
  private room: Room = LEVELS[0];
  private sim: Sim | null = null;
  private acc = 0;
  private timeScale = 1;
  private prevX = 0;
  private prevY = 0;
  private bounceCount = 0;
  private targetsHit = 0;
  private sinceSolved = -1;
  private sinceStopped = -1;

  private aimOrigin: { x: number; y: number } | null = null;
  private aimShot: Shot | null = null;
  private lastAimStep = -1;

  async start(): Promise<void> {
    await this.renderer.init($('stage'));
    this.sfx.setMuted(this.progress.muted);
    this.bindInput();
    this.bindUi();
    this.renderer.app.ticker.add((t) => this.frame(Math.min(0.05, t.deltaMS / 1000)));
    this.loadLevel(Math.min(this.progress.unlocked, LEVELS.length - 1));
    this.showMenu();
  }

  // --- flow ----------------------------------------------------------------------

  loadLevel(i: number): void {
    this.levelIndex = i;
    this.room = LEVELS[i];
    this.tries = 1;
    this.renderer.buildRoom(this.room);
    this.resetShot();
    $('hud-level').textContent = `LEVEL ${i + 1}`;
    $('hint').classList.toggle('hidden', i > 1);
  }

  private resetShot(): void {
    this.sim = null;
    this.acc = 0;
    this.timeScale = 1;
    this.bounceCount = 0;
    this.targetsHit = 0;
    this.sinceSolved = -1;
    this.sinceStopped = -1;
    this.renderer.resetTargets();
    this.renderer.clearTrail();
    this.renderer.clearAim();
    this.renderer.setBall(this.room.start.x, this.room.start.y);
    $('hud-try').textContent = `TRY ${this.tries}`;
    $('toast').classList.remove('show');
    this.mode = 'aim';
  }

  private retry(): void {
    if (this.mode === 'fly' || this.mode === 'missed') this.tries++;
    this.resetShot();
  }

  fire(shot: Shot): void {
    if (this.mode !== 'aim') return;
    this.sfx.unlock();
    this.renderer.clearAim();
    this.sim = new Sim(this.room, shot);
    this.prevX = this.sim.x;
    this.prevY = this.sim.y;
    this.mode = 'fly';
    this.sfx.launch(shot.power);
    this.renderer.ring(this.room.start.x, this.room.start.y, COLORS.trail, 18, 260, 0.35, 5);
    this.renderer.shake(2 + shot.power / 25);
    haptic(12);
    $('hint').classList.add('hidden');
  }

  private onMissed(): void {
    this.mode = 'missed';
    this.sfx.miss();
    const t = $('toast');
    t.textContent =
      this.targetsHit > 0 ? `${this.targetsHit}/${this.room.targets.length} — so close! Tap to retry` : 'Missed — tap to retry';
    t.classList.add('show');
  }

  private onWon(): void {
    this.mode = 'won';
    const id = this.room.id;
    const prev = this.progress.best[id];
    if (!prev || this.tries < prev) this.progress.best[id] = this.tries;
    this.progress.unlocked = Math.max(this.progress.unlocked, Math.min(this.levelIndex + 1, LEVELS.length - 1));
    saveProgress(this.progress);
    this.sfx.win();
    this.renderer.confetti();
    haptic(40);
    $('win-title').textContent = this.tries === 1 ? 'ONE SHOT!' : this.tries <= 3 ? 'GREAT!' : 'SOLVED!';
    $('win-sub').textContent = this.tries === 1 ? 'First try. Unreal.' : `Solved in ${this.tries} tries`;
    $('btn-next').textContent = this.levelIndex + 1 < LEVELS.length ? 'Next level' : 'Menu';
    $('panel-win').classList.remove('hidden');
  }

  // --- per-frame -----------------------------------------------------------------

  private frame(dt: number): void {
    const sim = this.sim;
    if (sim && (this.mode === 'fly' || this.mode === 'won' || this.mode === 'missed')) {
      this.timeScale += (this.desiredTimeScale(sim) - this.timeScale) * Math.min(1, dt * 10);
      if (!sim.done) {
        this.acc += dt * TICK_HZ * this.timeScale * this.speed;
        const events: SimEvent[] = [];
        while (this.acc >= 1 && !sim.done) {
          this.prevX = sim.x;
          this.prevY = sim.y;
          sim.step(events);
          this.acc -= 1;
        }
        for (const e of events) this.onEvent(e);
      }
      const f = sim.done ? 1 : this.acc;
      const x = this.prevX + (sim.x - this.prevX) * f;
      const y = this.prevY + (sim.y - this.prevY) * f;
      this.renderer.setBall(x, y);
      this.renderer.pushTrail(x, y);

      if (this.sinceSolved >= 0) {
        this.sinceSolved += dt * this.speed;
        if (this.mode === 'fly' && this.sinceSolved > 1.1) this.onWon();
      }
      if (this.sinceStopped >= 0 && this.mode === 'fly' && !sim.solved) {
        this.sinceStopped += dt * this.speed;
        if (this.sinceStopped > 0.25) this.onMissed();
      }
    }
    this.renderer.update(dt);
  }

  /** Slow motion when the ball is about to hit the final target, and right after it does. */
  private desiredTimeScale(sim: Sim): number {
    if (this.sinceSolved >= 0) return this.sinceSolved < 0.45 ? 0.2 : 1;
    if (sim.remaining !== 1) return 1;
    const i = sim.hit.indexOf(false);
    const t = this.room.targets[i];
    const dx = t.x - sim.x;
    const dy = t.y - sim.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const approaching = dx * sim.vx + dy * sim.vy > 0;
    if (!approaching || d > 170) return 1;
    // Only if it's actually going to connect: aim within the target's angular size.
    const sp = sim.speed || 1;
    const cross = Math.abs(dx * sim.vy - dy * sim.vx) / sp;
    return cross < t.r + 18 ? 0.3 : 1;
  }

  private onEvent(e: SimEvent): void {
    const r = this.renderer;
    switch (e.type) {
      case 'bounce': {
        this.bounceCount++;
        const color = wallColor(e.kind);
        this.sfx.bounce(this.bounceCount, e.speed, e.kind === 'bouncy');
        r.sparks(e.x, e.y, e.nx, e.ny, color, 6 + Math.min(14, e.speed / 120), 160 + e.speed * 0.25);
        r.ring(e.x, e.y, color, 6, 220, 0.25, 3);
        r.shake(Math.min(7, e.speed / 350));
        if (e.speed > 400) haptic(6);
        break;
      }
      case 'bumper':
        this.bounceCount++;
        this.sfx.bumper();
        r.flashBumper(e.index);
        r.sparks(e.x, e.y, e.nx, e.ny, COLORS.bumper, 14, 420);
        r.ring(this.room.bumpers[e.index].x, this.room.bumpers[e.index].y, COLORS.bumper, this.room.bumpers[e.index].r, 260, 0.3, 5);
        r.shake(6);
        haptic(10);
        break;
      case 'target':
        this.targetsHit++;
        this.sfx.target(this.targetsHit - 1, e.remaining === 0);
        r.hitTarget(e.index);
        r.burst(e.x, e.y, COLORS.target, e.remaining === 0 ? 60 : 28, e.remaining === 0 ? 700 : 420, 5);
        r.ring(e.x, e.y, COLORS.target, 20, e.remaining === 0 ? 700 : 400, 0.5, 6);
        r.shake(e.remaining === 0 ? 16 : 8);
        haptic(e.remaining === 0 ? 30 : 15);
        break;
      case 'solved':
        this.sinceSolved = 0;
        break;
      case 'stopped':
        this.sinceStopped = 0;
        break;
    }
  }

  // --- input ---------------------------------------------------------------------

  private bindInput(): void {
    const canvas = this.renderer.canvas;
    canvas.style.touchAction = 'none';

    canvas.addEventListener('pointerdown', (ev) => {
      this.sfx.unlock();
      if (this.mode === 'missed') {
        this.retry();
      }
      if (this.mode !== 'aim') return;
      canvas.setPointerCapture(ev.pointerId);
      this.aimOrigin = { x: ev.clientX, y: ev.clientY };
      this.aimShot = null;
      this.lastAimStep = -1;
    });

    canvas.addEventListener('pointermove', (ev) => {
      if (!this.aimOrigin || this.mode !== 'aim') return;
      // Slingshot: pull back, ball flies the opposite way.
      const px = this.aimOrigin.x - ev.clientX;
      const py = this.aimOrigin.y - ev.clientY;
      const len = Math.sqrt(px * px + py * py);
      const power = Math.min(100, Math.round((len / FULL_PULL_PX) * 100));
      if (power < MIN_POWER) {
        this.aimShot = null;
        this.renderer.clearAim();
        return;
      }
      let angle = Math.round((Math.atan2(-py, px) * 1800) / Math.PI);
      angle = ((angle % 3600) + 3600) % 3600;
      this.setAim({ angle, power });
    });

    const release = (fire: boolean) => {
      if (!this.aimOrigin) return;
      this.aimOrigin = null;
      const shot = this.aimShot;
      this.aimShot = null;
      if (fire && shot) this.fire(shot);
      else this.renderer.clearAim();
    };
    canvas.addEventListener('pointerup', () => release(true));
    canvas.addEventListener('pointercancel', () => release(false));
  }

  private setAim(shot: Shot): void {
    this.aimShot = shot;
    const step = Math.floor(shot.power / 10);
    if (step !== this.lastAimStep) {
      this.lastAimStep = step;
      this.sfx.aimTick(shot.power);
    }
    this.renderer.drawAim(this.room.start, previewPath(this.room, shot), shot);
  }

  // --- menus ---------------------------------------------------------------------

  private bindUi(): void {
    $('btn-retry').addEventListener('click', () => {
      this.sfx.click();
      if (this.mode !== 'menu') {
        $('panel-win').classList.add('hidden');
        this.retry();
      }
    });
    $('btn-menu').addEventListener('click', () => {
      this.sfx.click();
      this.showMenu();
    });
    $('btn-sound').addEventListener('click', () => {
      this.sfx.unlock();
      this.sfx.setMuted(!this.sfx.muted);
      this.progress.muted = this.sfx.muted;
      saveProgress(this.progress);
      this.syncSoundIcon();
      this.sfx.click();
    });
    $('btn-next').addEventListener('click', () => {
      this.sfx.click();
      $('panel-win').classList.add('hidden');
      if (this.levelIndex + 1 < LEVELS.length) this.loadLevel(this.levelIndex + 1);
      else this.showMenu();
    });
    $('btn-again').addEventListener('click', () => {
      this.sfx.click();
      $('panel-win').classList.add('hidden');
      this.tries = 1;
      this.resetShot();
    });
    $('btn-play').addEventListener('click', () => {
      this.sfx.unlock();
      this.sfx.click();
      this.hideMenu();
      this.loadLevel(Math.min(this.progress.unlocked, LEVELS.length - 1));
    });
    this.syncSoundIcon();
  }

  private syncSoundIcon(): void {
    $('btn-sound').classList.toggle('muted', this.sfx.muted);
  }

  showMenu(): void {
    this.mode = 'menu';
    $('panel-win').classList.add('hidden');
    $('toast').classList.remove('show');
    const grid = $('level-grid');
    grid.innerHTML = '';
    LEVELS.forEach((room, i) => {
      const b = document.createElement('button');
      const locked = i > this.progress.unlocked;
      const best = this.progress.best[room.id];
      b.className = 'level' + (locked ? ' locked' : '') + (best ? ' done' : '') + (best === 1 ? ' perfect' : '');
      b.textContent = String(i + 1);
      b.disabled = locked;
      b.title = best ? `Best: ${best} ${best === 1 ? 'try' : 'tries'}` : '';
      b.addEventListener('click', () => {
        this.sfx.unlock();
        this.sfx.click();
        this.hideMenu();
        this.loadLevel(i);
      });
      grid.appendChild(b);
    });
    $('btn-play').textContent = this.progress.unlocked > 0 ? `Continue · Level ${this.progress.unlocked + 1}` : 'Play';
    $('menu').classList.remove('hidden');
  }

  private hideMenu(): void {
    $('menu').classList.add('hidden');
  }
}

/** Dotted aim preview: the path up to (and just past) the first bounce. */
function previewPath(room: Room, shot: Shot): { x: number; y: number }[] {
  const sim = new Sim(room, shot);
  const pts: { x: number; y: number }[] = [];
  const events: SimEvent[] = [];
  let after = -1;
  while (!sim.done && pts.length < 80) {
    sim.step(events);
    if (after < 0 && events.some((e) => e.type === 'bounce' || e.type === 'bumper')) after = 0;
    if (sim.tick % 6 === 0) pts.push({ x: sim.x, y: sim.y });
    if (after >= 0 && ++after > 10) break;
  }
  return pts;
}

const game = new Game();
void game.start();

// Hook for automated tests (Playwright) and debugging.
declare global {
  interface Window {
    __oneShot: unknown;
  }
}
window.__oneShot = {
  get mode() {
    return game.mode;
  },
  get level() {
    return game.levelIndex;
  },
  get tries() {
    return game.tries;
  },
  levelCount: LEVELS.length,
  solution: (i: number) => LEVELS[i].solution,
  load: (i: number) => {
    document.getElementById('menu')?.classList.add('hidden');
    game.loadLevel(i);
  },
  shoot: (shot: Shot) => game.fire(shot),
};
