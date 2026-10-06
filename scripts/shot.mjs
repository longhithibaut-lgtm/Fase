// Usage: node scripts/shot.mjs <url> <out.png> [waitMs] [width] [height] [js]
// URL params: ?site=<id> jumps to a site (earlier ones count as automated), ?demo=1 builds its reference factory.
// Opens the game in Chromium, fails on page errors, saves a screenshot.
import { chromium } from '@playwright/test';

const [url = 'http://127.0.0.1:5173/', out = 'shot.png', wait = '4000', w = '1600', h = '900', js] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(url);
await page.waitForFunction(() => window.__factory?.scene?.campaign && window.__factory.scene.hud, null, { timeout: 30000 });
// Fast-forward the simulation: FF=<seconds> runs the world headlessly before the capture.
if (process.env.FF) await page.evaluate((sec) => { const c = window.__factory.campaign; for (let i = 0; i < sec * 60; i++) c.update(1 / 60); }, +process.env.FF);
if (js) await page.evaluate(js);
await page.waitForTimeout(+wait);
await page.screenshot({ path: out });
const info = await page.evaluate(() => {
  const c = window.__factory.campaign;
  const w = c.world;
  return { site: c.current, entities: w.entities.size, rate: w.rate(), automated: [...c.automated], credits: Math.floor(c.credits), fps: Math.round(window.__factory.game.loop.actualFps) };
});
console.log(JSON.stringify(info));
await browser.close();
if (errors.length) {
  console.error('PAGE ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
