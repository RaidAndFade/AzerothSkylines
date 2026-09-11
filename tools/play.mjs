import { chromium } from 'playwright';
import path from 'node:path';

const OUT = process.env.SHOTS || '/tmp/claude-0/-home-user-AzerothSkylines/9f80addc-118d-5987-851e-92fddca9dff8/scratchpad/shots';
const FILE = 'file://' + path.resolve('dist/index.html');
const W = 430, H = 932;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(FILE);
await page.waitForTimeout(600);
await page.fill('#title input', 'Goldshire');
await page.click('#title button');
await page.waitForTimeout(2000);

const tool = (label) => page.locator(`#toolbar .tool:has-text("${label}")`).first();
const closePanel = async () => {
  const btn = page.locator('#panel .panel-head .icon-button');
  if (await page.locator('#panel.open').count()) await btn.click();
  await page.waitForTimeout(150);
};

async function drag(x0, y0, x1, y1) {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
    await page.waitForTimeout(12);
  }
  await page.mouse.up();
  await page.waitForTimeout(120);
}

// Zoom out so a whole district fits on screen.
await page.mouse.move(W / 2, H / 2);
for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, 130); await page.waitForTimeout(50); }
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/10-before.png` });

// --- lay a street grid ------------------------------------------------------
await tool('Roads').click();
await page.waitForTimeout(200);
await closePanel();

const cx = W / 2, cy = H / 2 - 40;
// Streets running along both isometric axes, fanning out from the centre.
for (const off of [-110, -55, 0, 55, 110]) {
  await drag(cx - 150 + off, cy - 75 - off * 0.5, cx + 150 + off, cy + 75 - off * 0.5);
}
for (const off of [-110, -55, 0, 55, 110]) {
  await drag(cx - 150 + off, cy + 75 + off * 0.5, cx + 150 + off, cy - 75 + off * 0.5);
}
await page.screenshot({ path: `${OUT}/11-roads.png` });

// --- zone the land ----------------------------------------------------------
await tool('Dwellings').click();
await page.waitForTimeout(150);
await drag(cx - 120, cy - 90, cx + 40, cy + 10);
await drag(cx - 40, cy - 130, cx + 130, cy - 30);

await tool('Trade').click();
await page.waitForTimeout(150);
await drag(cx - 90, cy + 10, cx + 60, cy + 70);

await tool('Crafting').click();
await page.waitForTimeout(150);
await drag(cx - 30, cy + 60, cx + 140, cy + 130);

await tool('Inspect').click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${OUT}/12-zoned.png` });

// --- run the city -----------------------------------------------------------
await page.locator('#speed button').nth(3).click();
await page.waitForTimeout(20000);
await page.screenshot({ path: `${OUT}/13-grown.png` });

// Zoom in on the new streets.
await page.mouse.move(cx, cy);
for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(50); }
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}/14-close.png` });

// Report what the city actually became.
const readout = await page.evaluate(() => ({
  gold: document.querySelector('.stat.gold .value')?.textContent,
  pop: document.querySelectorAll('.stat .value')[1]?.textContent,
  happy: document.querySelectorAll('.stat .value')[2]?.textContent,
}));
console.log('READOUT', JSON.stringify(readout));
console.log('ERRORS:', errors.length ? errors.slice(0, 10) : 'none');
await browser.close();
