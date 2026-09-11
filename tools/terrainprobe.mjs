import { chromium } from 'playwright';
import path from 'node:path';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
await page.goto('file://' + path.resolve('dist/index.html'));
await page.waitForTimeout(400);
await page.fill('#title input', process.env.SEED || 'Goldshire');
await page.click('#title button');
await page.waitForTimeout(1500);
const out = await page.evaluate(() => {
  const c = window.azerothSkylines.city;
  const names = ['DeepWater','ShallowWater','Sand','Grass','Meadow','Forest','Rock','Snow'];
  let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
  for (const p of c.parcels) { if(!p.owned) continue;
    x0=Math.min(x0,p.px*8); y0=Math.min(y0,p.py*8); x1=Math.max(x1,p.px*8+7); y1=Math.max(y1,p.py*8+7); }
  const counts = {};
  const rows = [];
  for (let y=y0;y<=y1;y++){ let row='';
    for (let x=x0;x<=x1;x++){ const t=c.map.terrain[y*c.width+x]; counts[names[t]]=(counts[names[t]]||0)+1;
      row += 'DSsGMFRw'[t]; }
    rows.push(row); }
  // Whole-map water fraction, for comparison.
  let water=0; for (const t of c.map.terrain) if (t<2) water++;
  return { owned:{x0,y0,x1,y1}, site:c.map.foundingSite, counts, rows, waterFracMap:+(water/c.map.terrain.length).toFixed(3) };
});
console.log(JSON.stringify(out.owned), 'site', JSON.stringify(out.site), 'mapWater', out.waterFracMap);
console.log('district terrain counts', JSON.stringify(out.counts));
console.log(out.rows.join('\n'));
await browser.close();
