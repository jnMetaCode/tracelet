// Record the UI segment of the hero GIF: two runs stream in, then Compare.
//
//   node docs/record-ui.mjs [playwright-dir] [out-dir]
//
// Expects a tracelet server on :4318/:4321 (start it yourself, --no-open).
// Playwright is not a dependency of this repo; pass the directory of an
// existing install as argv[2] (default: resolves 'playwright' normally).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pwDir = process.argv[2];
const outDir = process.argv[3] || join(here, 'video');
const { chromium } = await import(pwDir ? join(pwDir, 'index.mjs') : 'playwright');

const UI = 'http://127.0.0.1:4321';
const DEMO = join(here, '..', 'examples', 'demo.js');

await fetch(`${UI}/api/clear`, { method: 'POST' });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1100, height: 620 },
  recordVideo: { dir: outDir, size: { width: 1100, height: 620 } },
});
const page = await ctx.newPage();
await page.goto(UI);
await page.waitForTimeout(1200); // empty state: "waiting for traces"

// two runs of the agent stream in live (before / after)
spawn(process.execPath, [DEMO, '--compare'], { stdio: 'ignore' });
await page.waitForTimeout(2200);

// open run A (the older, errored one) and glance at the waterfall
const items = page.locator('.trace-item');
await items.nth(1).click();
await page.waitForTimeout(1600);
await page.getByText('get_calendar').first().click();
await page.waitForTimeout(1800);

// Compare → pick run B
await page.click('#compare');
await page.waitForTimeout(900);
await items.nth(0).click();
await page.waitForTimeout(3200); // headline deltas + aligned steps, first diff selected

// the model swap + prompt diff on the last step
await page.locator('.drow:not(.head)').last().click();
await page.waitForTimeout(3600);

await ctx.close();
await browser.close();
console.log(`recorded → ${outDir}`);
