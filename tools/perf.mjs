/** Grows a city, then measures frame pacing at a few zoom levels. */
import { chromium } from 'playwright';
import path from 'node:path';
import { launchOptions } from './browser.mjs';
const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('file://' + path.resolve('dist/index.html'));
await page.waitForTimeout(400);
await page.fill('#title input', 'Goldshire');
await page.click('#title button');
await page.waitForTimeout(1200);

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
const tool = (l) => page.locator(`#toolbar .tool:has-text("${l}")`).first();
const close = async () => { if (await page.locator('#panel.open').count()) { await page.locator('#panel .panel-head .icon-button').click(); await page.waitForTimeout(100); } };

const { x0, y0 } = owned;
await page.evaluate(([a, b]) => { const c = window.azerothSkylines.camera; c.zoom = 0.6; c.centreOnTile(a, b, 0); }, [x0 + 8, y0 + 8]);
await tool('Roads').click(); await page.waitForTimeout(150); await close();
for (const y of [2, 6, 10, 14]) await drag([x0 + 1, y0 + y], [x0 + 14, y0 + y]);
for (const x of [2, 6, 10, 14]) await drag([x0 + x, y0 + 1], [x0 + x, y0 + 14]);
await tool('Dwellings').click(); await page.waitForTimeout(120);
await drag([x0 + 1, y0 + 1], [x0 + 14, y0 + 9]);
await tool('Crafting').click(); await page.waitForTimeout(120);
await drag([x0 + 1, y0 + 11], [x0 + 14, y0 + 14]);
await tool('Inspect').click(); await page.waitForTimeout(120);
await page.locator('#speed button').nth(3).click();
await page.waitForTimeout(22000);

async function measure(zoom, label) {
  await page.evaluate(([z, a, b]) => { const c = window.azerothSkylines.camera; c.zoom = z; c.centreOnTile(a, b, 0); }, [zoom, x0 + 8, y0 + 8]);
  await page.waitForTimeout(700);
  const r = await page.evaluate(() => new Promise((resolve) => {
    const times = [];
    let last = performance.now();
    let n = 0;
    const tick = () => {
      const now = performance.now();
      times.push(now - last);
      last = now;
      if (++n < 90) requestAnimationFrame(tick);
      else {
        times.sort((a, b) => a - b);
        resolve({ median: +times[Math.floor(times.length / 2)].toFixed(2), p95: +times[Math.floor(times.length * 0.95)].toFixed(2) });
      }
    };
    requestAnimationFrame(tick);
  }));
  console.log(`${label} zoom=${zoom} medianFrame=${r.median}ms p95=${r.p95}ms`);
}
const stats = await page.evaluate(() => {
  const c = window.azerothSkylines.city;
  return { pop: c.stats.population, buildings: c.buildings.size, agents: c.agents.length };
});
console.log('city', JSON.stringify(stats));
await measure(0.35, 'far ');
await measure(0.85, 'mid ');
await measure(1.80, 'near');
await browser.close();
