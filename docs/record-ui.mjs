// Record the UI segment of the hero GIF: the two --demo runs, then Compare.
//
//   node src/cli.js --no-open --demo            # in another terminal
//   node docs/record-ui.mjs [playwright-dir] [out-dir]
//
// Playwright is not a dependency of this repo; pass the directory of an
// existing install as argv[2] (default: resolves 'playwright' normally).
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pwDir = process.argv[2];
const outDir = process.argv[3] || join(here, 'video');
const { chromium } = await import(pwDir ? join(pwDir, 'index.mjs') : 'playwright');

const UI = 'http://127.0.0.1:4321';
const runs = await (await fetch(`${UI}/api/traces`)).json();
if (runs.length !== 2) {
  console.error(`expected a fresh tracelet started with --demo (2 runs), found ${runs.length}`);
  process.exit(1);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1100, height: 620 },
  recordVideo: { dir: outDir, size: { width: 1100, height: 620 } },
});
const page = await ctx.newPage();
await page.goto(UI);
await page.waitForTimeout(1500); // the newest run opens on its own

// the run that went wrong: get_calendar errored
const items = page.locator('.trace-item');
await items.nth(1).click();
await page.waitForTimeout(1400);
await page.getByText('get_calendar').first().click();
await page.waitForTimeout(1900);

// Compare → pick the fixed run
await page.click('#compare');
await page.waitForTimeout(900);
await items.nth(0).click();
await page.waitForTimeout(3300); // headline deltas + aligned steps, first change selected

// the last step: model swap + prompt diff
await page.locator('.drow:not(.head)').last().click();
await page.waitForTimeout(3800);

await ctx.close();
await browser.close();
console.log(`recorded → ${outDir}`);
