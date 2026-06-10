// Record the tracelet hero demo as video: live trace streaming in + inspection.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const UI = 'http://127.0.0.1:4321';
const DEMO = process.argv[2]; // path to examples/demo.js

await fetch(UI.replace('4321', '4321') + '/api/clear', { method: 'POST' }).catch(() => {});
await fetch('http://127.0.0.1:4321/api/clear', { method: 'POST' });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1100, height: 620 },
  recordVideo: { dir: 'video', size: { width: 1100, height: 620 } },
});
const page = await ctx.newPage();
await page.goto(UI);
await page.waitForTimeout(1800); // empty state: "waiting for traces"

// the agent runs → trace streams in live
spawn(process.execPath, [DEMO], { stdio: 'ignore' });
await page.waitForTimeout(2600);

// open the trace
await page.getByText('agent.run', { exact: false }).first().click();
await page.waitForTimeout(2200);

// inspect the LLM call: prompt, completion, tokens
await page.getByText('claude-sonnet', { exact: false }).first().click();
await page.waitForTimeout(3400);

// inspect the errored tool call
await page.locator('.span-row, [class*=span]', { hasText: 'get_calendar' }).first().click().catch(async () => {
  await page.getByText('get_calendar', { exact: false }).first().click();
});
await page.waitForTimeout(3400);

await ctx.close();
await browser.close();
console.log('recorded');
