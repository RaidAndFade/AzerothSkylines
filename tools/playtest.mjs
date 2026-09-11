/**
 * Drives the real interface to lay out and grow a town, then reports what
 * the city became. Used to check the whole loop end to end in a browser.
 */
import { chromium } from 'playwright';
import path from 'node:path';

const OUT = process.env.SHOTS || '/tmp/claude-0/-home-user-AzerothSkylines/9f80addc-118d-5987-851e-92fddca9dff8/scratchpad/shots';
const W = 430, H = 932;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto('file://' + path.resolve('dist/index.html'));
await page.waitForTimeout(500);
await page.fill('#title input', process.env.SEED || 'Goldshire');
await page.click('#title button');
await page.waitForTimeout(1800);

const at = (tx, ty) => page.evaluate(([x, y]) => window.azerothSkylines.screenForTile(x, y), [tx, ty]);
const info = () => page.evaluate(() => {
  const c = window.azerothSkylines.city;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of c.parcels) {
    if (!p.owned) continue;
    x0 = Math.min(x0, p.px * 8); y0 = Math.min(y0, p.py * 8);
    x1 = Math.max(x1, p.px * 8 + 7); y1 = Math.max(y1, p.py * 8 + 7);
  }
  const counts = {};
  for (const b of c.buildings.values()) counts[b.defId] = (counts[b.defId] || 0) + 1;
  return {
    owned: { x0, y0, x1, y1 },
    site: c.map.foundingSite,
    pop: c.stats.population, gold: Math.round(c.budget.gold),
    happy: +c.stats.happiness.toFixed(2), jobs: c.stats.jobs, employed: c.stats.employed,
    agents: c.agents.length, buildings: c.buildings.size,
    demand: { r: +c.demand.residential.toFixed(2), c: +c.demand.commercial.toFixed(2), i: +c.demand.industrial.toFixed(2) },
    services: Object.fromEntries(Object.entries(c.stats.services).map(([k, v]) => [k, +v.toFixed(2)])),
    counts,
  };
});

async function dragTiles(a, b) {
  const p0 = await at(a[0], a[1]);
  const p1 = await at(b[0], b[1]);
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) {
    await page.mouse.move(p0.x + ((p1.x - p0.x) * i) / 8, p0.y + ((p1.y - p0.y) * i) / 8);
    await page.waitForTimeout(10);
  }
  await page.mouse.up();
  await page.waitForTimeout(80);
}
const failures = [];
async function tapTile(tx, ty, label) {
  const p = await at(tx, ty);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(90);
  const toast = await page.locator('#toast').evaluate((n) => ({ text: n.textContent, cls: n.className }));
  if (label && toast.cls.includes('bad')) failures.push(`${label} @${tx},${ty}: ${toast.text}`);
}
const tool = (label) => page.locator(`#toolbar .tool:has-text("${label}")`).first();
async function closePanel() {
  if (await page.locator('#panel.open').count()) {
    await page.locator('#panel .panel-head .icon-button').click();
    await page.waitForTimeout(120);
  }
}
async function pickBuilding(name) {
  await tool('Build').click();
  await page.waitForTimeout(180);
  const card = page.locator('#panel .card', { hasText: name }).first();
  if ((await card.count()) === 0) {
    failures.push(`no card for ${name}`);
    await closePanel();
    return;
  }
  await card.click();
  await page.waitForTimeout(120);
  await closePanel();
}

let state = await info();
console.log('START', JSON.stringify({ owned: state.owned, site: state.site }));
const { x0, y0, x1, y1 } = state.owned;

// Frame the whole district, then keep the camera still for the rest of the run.
await page.evaluate(([cx, cy]) => {
  const cam = window.azerothSkylines.camera;
  cam.zoom = 0.62;
  cam.centreOnTile(cx, cy, 0);
}, [(x0 + x1) / 2, (y0 + y1) / 2]);
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/20-empty.png` });

// --- streets ----------------------------------------------------------------
await tool('Roads').click();
await page.waitForTimeout(200);
await closePanel();
for (let y = y0 + 2; y <= y1 - 1; y += 4) await dragTiles([x0 + 1, y], [x1 - 1, y]);
for (let x = x0 + 2; x <= x1 - 1; x += 4) await dragTiles([x, y0 + 1], [x, y1 - 1]);
await page.screenshot({ path: `${OUT}/21-streets.png` });

// --- civic buildings, before the zoned land takes the plots ------------------
for (const [name, tiles] of [
  ['Village Well', [[x0 + 1, y0 + 1], [x0 + 9, y0 + 5], [x0 + 5, y0 + 9], [x0 + 13, y0 + 9]]],
  ['Cesspit', [[x0 + 3, y0 + 1], [x0 + 11, y0 + 5], [x0 + 7, y0 + 13]]],
  ['Guard Post', [[x0 + 1, y0 + 5], [x0 + 9, y0 + 13]]],
  ['Wayside Shrine', [[x0 + 5, y0 + 1], [x0 + 13, y0 + 5]]],
  ["Herbalist's Garden", [[x0 + 1, y0 + 9], [x0 + 11, y0 + 13]]],
]) {
  await pickBuilding(name);
  for (const t of tiles) await tapTile(t[0], t[1], name);
}

// --- zoning -----------------------------------------------------------------
await tool('Dwellings').click();
await page.waitForTimeout(150);
await dragTiles([x0 + 3, y0 + 3], [x0 + 7, y0 + 5]);
await dragTiles([x0 + 9, y0 + 1], [x0 + 13, y0 + 3]);
await dragTiles([x0 + 3, y0 + 7], [x0 + 7, y0 + 9]);

await tool('Trade').click();
await page.waitForTimeout(150);
await dragTiles([x0 + 9, y0 + 7], [x0 + 13, y0 + 9]);

await tool('Crafting').click();
await page.waitForTimeout(150);
await dragTiles([x0 + 3, y0 + 11], [x0 + 13, y0 + 13]);

await tool('Inspect').click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/22-zoned.png` });

// --- run --------------------------------------------------------------------
await page.locator('#speed button').nth(3).click();
for (const seconds of [15, 15, 15]) {
  await page.waitForTimeout(seconds * 1000);
  state = await info();
  console.log('TICK', JSON.stringify({ pop: state.pop, gold: state.gold, happy: state.happy, b: state.buildings, agents: state.agents, demand: state.demand }));
}
await page.screenshot({ path: `${OUT}/23-town.png` });

// A closer look at a street of the grown town.
await page.evaluate(([cx, cy]) => {
  const cam = window.azerothSkylines.camera;
  cam.zoom = 1.5;
  cam.centreOnTile(cx, cy, 0);
}, [x0 + 6, y0 + 6]);
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/24-street.png` });

state = await info();
console.log('FINAL', JSON.stringify(state, null, 1));
console.log('PLACEMENT FAILURES:', failures.length ? failures : 'none');
console.log('ERRORS:', errors.length ? errors.slice(0, 8) : 'none');
await browser.close();
