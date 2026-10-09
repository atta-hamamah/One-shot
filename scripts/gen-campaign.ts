// Generates the 20-level campaign into src/levels/campaign.json.
// Usage: npm run gen [-- --only 3]

import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { campaignParams, generateRoom, genStats } from '../src/gen/generate';
import { hashSeed } from '../src/sim/rng';
import type { Room } from '../src/sim/types';

const LEVELS = 20;
const out = fileURLToPath(new URL('../src/levels/campaign.json', import.meta.url));

const onlyArg = process.argv.indexOf('--only');
const only = onlyArg >= 0 ? Number(process.argv[onlyArg + 1]) : -1;

const rooms: Room[] = existsSync(out) && only >= 0 ? JSON.parse(readFileSync(out, 'utf8')) : [];

for (let i = 0; i < LEVELS; i++) {
  if (only >= 0 && i !== only) continue;
  const t0 = performance.now();
  // Bump the salt if a level ever fails to generate.
  let room: Room | null = null;
  for (let salt = 0; !room && salt < 10; salt++) {
    room = generateRoom(`c${i + 1}`, hashSeed(`campaign-${i}-${salt}`), campaignParams(i));
  }
  if (process.env.GEN_STATS) console.log(genStats);
  if (!room) throw new Error(`level ${i + 1}: generation failed`);
  rooms[i] = room;
  const ms = Math.round(performance.now() - t0);
  console.log(
    `level ${String(i + 1).padStart(2)}: ${room.targets.length} targets, ${room.walls.length - 4} walls, ${room.bumpers.length} bumpers, ` +
      `solveRate ${(room.solveRate * 100).toFixed(2)}%, minBounces ${room.minBounces}  (${ms} ms)`,
  );
}

writeFileSync(out, JSON.stringify(rooms) + '\n');
console.log(`wrote ${out}`);
