import { expect, test, type Page } from '@playwright/test';

interface Hook {
  mode: string;
  level: number;
  tries: number;
  levelCount: number;
  solution(i: number): { angle: number; power: number };
  load(i: number): void;
  shoot(shot: { angle: number; power: number }): void;
}

const hook = (page: Page) => page.evaluateHandle(() => (window as unknown as { __oneShot: Hook }).__oneShot);

async function ready(page: Page) {
  await page.goto('/?speed=6');
  await page.waitForFunction(() => (window as unknown as { __oneShot?: Hook }).__oneShot?.mode === 'menu');
}

test('menu shows and play opens level 1', async ({ page }) => {
  await ready(page);
  await expect(page.locator('#menu h1')).toContainText('ONE');
  await expect(page.locator('#level-grid .level')).toHaveCount(20);
  await page.screenshot({ path: 'test-results/menu.png' });
  await page.click('#btn-play');
  await expect(page.locator('#menu')).toBeHidden();
  await expect(page.locator('#hud-level')).toHaveText('LEVEL 1');
  await page.screenshot({ path: 'test-results/level1.png' });
});

test('dragging on the canvas aims and fires a shot', async ({ page }) => {
  await ready(page);
  await page.click('#btn-play');
  const box = (await page.locator('canvas').boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 20, y + 80, { steps: 5 });
  await page.screenshot({ path: 'test-results/aiming.png' });
  await page.mouse.up();
  await expect.poll(async () => (await hook(page)).evaluate((h) => h.mode)).not.toBe('aim');
});

test('every level is solved by its stored solution in the real game', async ({ page }) => {
  await ready(page);
  const count = await (await hook(page)).evaluate((h) => h.levelCount);
  for (let i = 0; i < count; i++) {
    await (await hook(page)).evaluate((h, i) => h.load(i), i);
    await (await hook(page)).evaluate((h, i) => h.shoot(h.solution(i)), i);
    await expect.poll(async () => (await hook(page)).evaluate((h) => h.mode), { timeout: 15_000 }).toBe('won');
    if (i === 0 || i === count - 1) await page.screenshot({ path: `test-results/won-${i + 1}.png` });
  }
  await expect(page.locator('#panel-win')).toBeVisible();
});

test('a missed shot can be retried and counts a try', async ({ page }) => {
  await ready(page);
  await (await hook(page)).evaluate((h) => h.load(4));
  // Straight down into the floor: never solves.
  await (await hook(page)).evaluate((h) => h.shoot({ angle: 2700, power: 10 }));
  await expect.poll(async () => (await hook(page)).evaluate((h) => h.mode), { timeout: 15_000 }).toBe('missed');
  await expect(page.locator('#toast')).toHaveClass(/show/);
  await page.click('#btn-retry');
  expect(await (await hook(page)).evaluate((h) => h.tries)).toBe(2);
  await expect(page.locator('#hud-try')).toHaveText('TRY 2');
});
