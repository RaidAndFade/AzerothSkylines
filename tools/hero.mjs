/**
 * Grows a town and captures the README screenshot.
 *
 * `GROW_MS` sets how long the clock is left running at full speed — the
 * default is enough on a machine with a GPU; raise it where the browser is
 * falling back to software rendering and the simulation is being throttled
 * along with the frame rate.
 */
import { chromium } from 'playwright';
import path from 'node:path';
import { launchOptions } from './browser.mjs';
const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 1200, height: 760 }, deviceScaleFactor: 1.25 });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + path.resolve('dist/index.html'));
await page.waitForTimeout(500);
await page.fill('#title input', 'Goldshire');
await page.click('#title button');
await page.waitForTimeout(1400);
// A new city opens on the founding guide; dismiss it.
if (await page.locator('#panel.open').count()) {
  await page.locator('#panel .panel-head .icon-button').click();
  await page.waitForTimeout(250);
}

const owned = await page.evaluate(() => {
  const c = window.azerothSkylines.city;
  let x0 = 1e9, y0 = 1e9;
  for (const p of c.parcels) { if (!p.owned) continue; x0 = Math.min(x0, p.px * 8); y0 = Math.min(y0, p.py * 8); }
  return { x0, y0 };
});
const at = (x, y) => page.evaluate(([a, b]) => window.azerothSkylines.screenForTile(a, b), [x, y]);
async function drag(a, b) {
  const p0 = await at(a[0], a[1]); const p1 = await at(b[0], b[1]);
  await page.mouse.move(p0.x, p0.y); await page.mouse.down();
  for (let i = 1; i <= 6; i++) { await page.mouse.move(p0.x + (p1.x - p0.x) * i / 6, p0.y + (p1.y - p0.y) * i / 6); await page.waitForTimeout(8); }
  await page.mouse.up(); await page.waitForTimeout(60);
}
async function tap(x, y) { const p = await at(x, y); await page.mouse.click(p.x, p.y); await page.waitForTimeout(70); }
const tool = (l) => page.locator(`#toolbar .tool:has-text("${l}")`).first();
const close = async () => { if (await page.locator('#panel.open').count()) { await page.locator('#panel .panel-head .icon-button').click(); await page.waitForTimeout(100); } };
async function pick(name) {
  await tool('Build').click(); await page.waitForTimeout(160);
  await page.locator('#panel .card', { hasText: name }).first().click();
  await page.waitForTimeout(100); await close();
}

const { x0, y0 } = owned;
await page.evaluate(([a, b]) => {
  const c = window.azerothSkylines.camera;
  c.distance = 34; c.pitch = 1.3; c.yaw = 0; c.centreOnTile(a, b); c.update();
}, [x0 + 8, y0 + 8]);
await page.waitForTimeout(300);

await tool('Roads').click(); await page.waitForTimeout(150); await close();
for (const y of [2, 6, 10, 14]) await drag([x0 + 1, y0 + y], [x0 + 14, y0 + y]);
for (const x of [2, 6, 10, 14]) await drag([x0 + x, y0 + 1], [x0 + x, y0 + 14]);

await page.evaluate(() => { window.azerothSkylines.city.stats.population = 400; });
for (const [name, tiles] of [
  ['Village Well', [[x0 + 1, y0 + 1], [x0 + 9, y0 + 5], [x0 + 5, y0 + 13]]],
  ['Cesspit', [[x0 + 13, y0 + 13]]],
  ['Guard Post', [[x0 + 1, y0 + 5], [x0 + 13, y0 + 9]]],
  ["Herbalist's Garden", [[x0 + 5, y0 + 1], [x0 + 9, y0 + 9]]],
  ['Lion Fountain', [[x0 + 5, y0 + 5]]],
]) { await pick(name); for (const t of tiles) await tap(t[0], t[1]); }
await page.evaluate(() => { window.azerothSkylines.city.stats.population = 0; });

await tool('Dwellings').click(); await page.waitForTimeout(120);
await drag([x0 + 1, y0 + 3], [x0 + 14, y0 + 3]);
await drag([x0 + 1, y0 + 7], [x0 + 14, y0 + 7]);
await drag([x0 + 3, y0 + 11], [x0 + 14, y0 + 11]);
await tool('Trade').click(); await page.waitForTimeout(120);
await drag([x0 + 1, y0 + 9], [x0 + 14, y0 + 9]);
await tool('Crafting').click(); await page.waitForTimeout(120);
await drag([x0 + 1, y0 + 13], [x0 + 14, y0 + 13]);
await tool('Inspect').click(); await page.waitForTimeout(120);

await page.locator('#speed button').nth(3).click();
await page.waitForTimeout(Number(process.env.GROW_MS ?? 35000));
await page.locator('#speed button').nth(1).click();

// Down off the vertical and round to the south-west, so the shot shows the
// relief and the shadows rather than a plan of the streets.
await page.evaluate(([a, b]) => {
  const c = window.azerothSkylines.camera;
  c.distance = 30; c.pitch = 0.48; c.yaw = 0.62; c.centreOnTile(a, b); c.update();
}, [x0 + 8, y0 + 8]);
await page.waitForTimeout(Number(process.env.SETTLE_MS ?? 1200));
await page.screenshot({ path: 'docs/screenshot-valley.png' });
const stats = await page.evaluate(() => {
  const c = window.azerothSkylines.city;
  const counts = {};
  for (const b of c.buildings.values()) counts[b.defId] = (counts[b.defId] || 0) + 1;
  return { pop: c.stats.population, happy: +c.stats.happiness.toFixed(2), buildings: c.buildings.size, agents: c.agents.length, gold: Math.round(c.budget.gold), counts };
});
console.log(JSON.stringify(stats));
console.log('errors', errs.length ? errs : 'none');
await browser.close();
