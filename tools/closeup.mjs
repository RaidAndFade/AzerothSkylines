import { chromium } from 'playwright';
import path from 'node:path';
const OUT = '/tmp/claude-0/-home-user-AzerothSkylines/9f80addc-118d-5987-851e-92fddca9dff8/scratchpad/shots';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 520, height: 700 }, deviceScaleFactor: 3 });
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
  for (let i = 1; i <= 6; i++) { await page.mouse.move(p0.x + (p1.x - p0.x) * i / 6, p0.y + (p1.y - p0.y) * i / 6); await page.waitForTimeout(10); }
  await page.mouse.up(); await page.waitForTimeout(80);
}
const tool = (l) => page.locator(`#toolbar .tool:has-text("${l}")`).first();
const close = async () => { if (await page.locator('#panel.open').count()) { await page.locator('#panel .panel-head .icon-button').click(); await page.waitForTimeout(120); } };

const { x0, y0 } = owned;
await page.evaluate(([a, b]) => { const c = window.azerothSkylines.camera; c.zoom = 0.8; c.centreOnTile(a, b, 0); }, [x0 + 6, y0 + 6]);
await page.waitForTimeout(300);

await tool('Roads').click(); await page.waitForTimeout(180); await close();
await drag([x0 + 1, y0 + 4], [x0 + 13, y0 + 4]);
await drag([x0 + 1, y0 + 8], [x0 + 13, y0 + 8]);
await tool('Dwellings').click(); await page.waitForTimeout(150);
await drag([x0 + 2, y0 + 5], [x0 + 12, y0 + 7]);
await drag([x0 + 2, y0 + 3], [x0 + 12, y0 + 3]);
await tool('Inspect').click(); await page.waitForTimeout(150);
await page.locator('#speed button').nth(3).click();
await page.waitForTimeout(14000);

await page.evaluate(([a, b]) => { const c = window.azerothSkylines.camera; c.zoom = 2.4; c.centreOnTile(a, b, 0); }, [x0 + 6, y0 + 6]);
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/30-closeup.png` });
const n = await page.evaluate(() => { const c = window.azerothSkylines.city; const o = {}; for (const b of c.buildings.values()) o[b.defId] = (o[b.defId] || 0) + 1; return { o, pop: c.stats.population }; });
console.log(JSON.stringify(n));
await browser.close();
