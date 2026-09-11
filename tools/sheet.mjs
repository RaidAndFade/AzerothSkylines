import { chromium } from 'playwright';
import path from 'node:path';
const OUT = process.env.SHOTS || '/tmp/claude-0/-home-user-AzerothSkylines/9f80addc-118d-5987-851e-92fddca9dff8/scratchpad/shots';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
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
