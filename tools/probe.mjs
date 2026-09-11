import { chromium } from 'playwright';
import path from 'node:path';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('file://' + path.resolve('dist/sheet.html'));
await page.waitForTimeout(600);
const info = await page.evaluate(() => {
  const out = [];
  document.querySelectorAll('canvas').forEach((c) => {
    const label = c.parentElement.parentElement.querySelector('span').textContent.replace(/\n/g, ' ');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let opaque = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) opaque++;
    out.push({ label, w: c.width, h: c.height, opaque, frac: +(opaque / (c.width * c.height)).toFixed(3) });
  });
  return out.filter((e) => e.frac < 0.02).slice(0, 30);
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
