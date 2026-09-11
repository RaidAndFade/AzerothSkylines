/** Screenshots the sprite contact sheet, one image per section. */
import { chromium } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { launchOptions } from './browser.mjs';
const OUT = process.env.SHOTS ?? fs.mkdtempSync(path.join(os.tmpdir(), 'azeroth-shots-'));
const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('file://' + path.resolve('dist/sheet.html'));
await page.waitForTimeout(900);
const sections = await page.$$('h2');
for (let i = 0; i < sections.length; i++) {
  const title = (await sections[i].textContent()).toLowerCase().replace(/[^a-z]+/g, '-').slice(0, 24);
  const box = await page.evaluate((idx) => {
    const h = document.querySelectorAll('h2')[idx];
    const rowEl = h.nextElementSibling;
    const a = h.getBoundingClientRect();
    const b = rowEl.getBoundingClientRect();
    return { x: 0, y: a.top + window.scrollY - 6, width: document.body.scrollWidth, height: b.bottom - a.top + 14 };
  }, i);
  if (box.height < 4 || box.width < 4) continue;
  await page.screenshot({ path: `${OUT}/sheet-${i}-${title}.png`, clip: box, fullPage: true });
}
console.log('sections', sections.length, 'errors', errs.length ? errs : 'none');
await browser.close();
console.log('screenshots ->', OUT);
