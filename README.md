# One Shot

**One shot. Every target. Make it bounce.**

A trick-shot puzzle game: aim once, release, and watch the ball bounce off walls and bumpers. Hit every target with that single shot to clear the room.

## Play it locally

```bash
npm install
npm run dev        # http://localhost:5173
```

Drag anywhere on the screen to aim (slingshot: pull back, the ball flies the other way). Release to shoot. The dotted line only shows the path up to the first bounce, so the rest is up to you.

## Scripts

| Command            | What it does                                                            |
| ------------------ | ----------------------------------------------------------------------- |
| `npm run dev`      | Dev server with hot reload                                              |
| `npm run build`    | Type-check and build the static site into `dist/` (deployable anywhere) |
| `npm test`         | Unit tests: physics determinism, generator, all levels solvable         |
| `npm run test:e2e` | Playwright: plays every level in a real browser and saves screenshots   |
| `npm run gen`      | Regenerates the 20-level campaign (`src/levels/campaign.json`)          |
| `npm run lint`     | Prettier check                                                          |

In cloud containers that ship a pre-installed Chromium, run e2e with `PW_CHROMIUM=/path/to/chrome npm run test:e2e`.

## How it works

```
src/
  sim/     The game itself: deterministic physics. No rendering, no DOM.
  gen/     Procedural room generator + brute-force solver.
  game/    Browser client: PixiJS renderer, input, synthesized audio, menus.
  levels/  Generated campaign (JSON).
scripts/   Level generation CLI.
tests/     unit (Vitest) and e2e (Playwright).
```

### Deterministic physics

A shot is just two integers: `angle` (tenths of a degree) and `power` (1–100). The simulation uses a fixed 240 Hz timestep and only IEEE-754 operations that are bit-identical on every JS engine (`+ - * /` and `Math.sqrt`); trig goes through our own `dsin`/`dcos` (see `src/sim/dmath.ts`). So the same shot gives exactly the same result on every phone and browser. That is what makes these possible:

- **Fair daily rooms**: everyone plays the exact same puzzle.
- **Tiny replays**: a replay is 2 numbers.
- **Anti-cheat**: a server can re-simulate a submitted shot to verify a score.
- **Trustworthy solver**: if the solver says a room is solvable, it is.

A golden-trajectory snapshot test fails if physics changes by accident. If you change physics on purpose, update the snapshot (`npx vitest run -u`) and regenerate the levels (`npm run gen`).

### Level generator

1. Scatter walls (some bouncy) and round bumpers.
2. Fire a random shot and record its path.
3. Place targets on that path after N bounces, so a solution is guaranteed.
4. Run the solver (≈5,000 sampled shots) to measure the solve rate and the fewest bounces needed. Reject rooms that are too easy or too hard for their place in the difficulty curve.
5. Store the most forgiving solution, so neighbouring shots also work. That means no pixel-perfect rooms.

## Roadmap

1. ✅ **Prototype**: physics, aiming, 20 generated rooms, juice and sound, tests.
2. **Daily room + sharing + analytics**: same room for everyone each day, Wordle-style share text, challenge links, PostHog. Launch on CrazyGames / Poki.
3. **If the numbers are good**: endless mode with modifiers, cosmetics, leaderboards (Cloudflare Workers + D1, server-side replay verification), Capacitor builds for the App Store and Google Play.
