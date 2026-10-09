// All sound effects are synthesised with Web Audio: zero asset files, zero licensing,
// and every sound can react to gameplay (pitch climbs with each bounce, etc).

const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31, 33, 36];

function noteHz(semitonesFromA4: number): number {
  return 440 * Math.pow(2, semitonesFromA4 / 12);
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  muted = false;

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 0.5;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, delay = 0, slideTo?: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  private whoosh(dur: number, from: number, to: number, vol: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || !this.noise || this.muted) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur);
  }

  launch(power: number): void {
    this.whoosh(0.35, 400, 2400 + power * 20, 0.35);
    this.tone(180, 0.12, 'sine', 0.25, 0, 90);
  }

  /** Pitch climbs with each bounce of the shot, so a long trick shot "plays a melody". */
  bounce(n: number, speed: number, bouncy: boolean): void {
    const step = PENTATONIC[Math.min(n, PENTATONIC.length - 1)];
    const vol = Math.min(0.35, 0.08 + speed / 6000);
    this.tone(noteHz(step - 9), 0.09, 'triangle', vol);
    if (bouncy) this.tone(noteHz(step + 3), 0.18, 'sine', vol * 0.7, 0, noteHz(step + 15));
  }

  bumper(): void {
    this.tone(520, 0.16, 'square', 0.12, 0, 260);
    this.tone(1040, 0.08, 'sine', 0.15);
  }

  target(i: number, last: boolean): void {
    const base = 3 + i * 4;
    this.tone(noteHz(base), 0.35, 'sine', 0.3);
    this.tone(noteHz(base + 12), 0.25, 'sine', 0.12, 0.02);
    if (last) [0, 4, 7, 12].forEach((s, k) => this.tone(noteHz(base + 12 + s), 0.4, 'triangle', 0.18, 0.08 + k * 0.07));
  }

  miss(): void {
    this.tone(220, 0.35, 'sine', 0.2, 0, 110);
  }

  win(): void {
    [0, 4, 7, 12, 16, 19, 24].forEach((s, k) => this.tone(noteHz(3 + s), 0.5, 'triangle', 0.16, k * 0.06));
  }

  click(): void {
    this.tone(880, 0.04, 'sine', 0.08);
  }

  /** Called while dragging; quiet tick whenever power crosses a step. */
  aimTick(power: number): void {
    this.tone(300 + power * 6, 0.03, 'sine', 0.04);
  }
}

export function haptic(ms: number): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // not supported
  }
}
