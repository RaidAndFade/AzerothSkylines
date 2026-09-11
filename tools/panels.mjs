/** Screenshots each interface panel at phone width. */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { launchOptions } from './browser.mjs';
const OUT = process.env.SHOTS ?? fs.mkdtempSync(path.join(os.tmpdir(), 'azeroth-shots-'));
const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + path.resolve('dist/index.html'));
await page.waitForTimeout(400);
await page.fill('#title input', 'Goldshire');
await page.click('#title button');
await page.waitForTimeout(1500);
// A new city opens on the founding guide; dismiss it.
if (await page.locator('#panel.open').count()) {
  await page.locator('#panel .panel-head .icon-button').click();
  await page.waitForTimeout(250);
}

// Give the city some population so unlocks and readouts have content.
await page.evaluate(() => { window.azerothSkylines.city.stats.population = 3200; });
await page.waitForTimeout(300);

const shots = [
  ['Build', 'build'],
  ['Treasury', 'treasury'],
  ['Chronicle', 'chronicle'],
  ['Views', 'views'],
];
for (const [label, name] of shots) {
  await page.locator(`#toolbar .tool:has-text("${label}")`).first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/40-panel-${name}.png` });
  await page.locator('#panel .panel-head .icon-button').click();
  await page.waitForTimeout(300);
}
// The city report hangs off the demand meter.
await page.locator('#demand').click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/40-panel-city.png` });
await page.locator('#panel .panel-head .icon-button').click();
await page.waitForTimeout(250);

// The menu.
await page.locator('#topbar .icon-button').click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/40-panel-menu.png` });

console.log('errors', errs.length ? errs : 'none');
await browser.close();
console.log('screenshots ->', OUT);
