import { chromium } from 'playwright';
import path from 'node:path';

const OUT = '/tmp/claude-0/-home-user-AzerothSkylines/9f80addc-118d-5987-851e-92fddca9dff8/scratchpad/shots';
const FILE = 'file://' + path.resolve('dist/index.html');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(FILE);
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/01-title.png` });

// Use a fixed valley name so runs are comparable.
await page.fill('#title input', 'Goldshire');
await page.click('#title button');
await page.waitForTimeout(2500);
await page.screenshot({ path: `${OUT}/02-start.png` });

// Zoom in a bit and look at the founding district.
await page.mouse.move(215, 420);
for (let i = 0; i < 5; i++) { await page.mouse.wheel(0, -120); await page.waitForTimeout(60); }
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/03-zoomed.png` });

console.log('ERRORS:', errors.length ? errors.slice(0, 10) : 'none');
await browser.close();
