#!/usr/bin/env node
// Send a realistic synthetic agent trace to a running tracelet over OTLP/HTTP,
// exactly as a real exporter would. Zero dependencies (Node 18+ global fetch).
//
//   1. npx @jnmetacode/tracelet             # in one terminal
//   2. node examples/demo.js                # in another (from a clone)
//
//   node examples/demo.js --compare
//
// sends TWO runs of the same agent — "before" (a tool call fails) and "after"
// (the tool is fixed, the summariser moved to a cheaper model) — to try Compare.
//
// No clone? `npx @jnmetacode/tracelet --demo`, or the "Load demo runs" button
// on the empty screen, loads the same runs without this script.

import { demoRun, demoPair } from '../src/demo.js';

const ENDPOINT = process.env.TRACELET_URL || 'http://localhost:4318/v1/traces';
const COMPARE = process.argv.includes('--compare');

async function send(payload, label) {
  const spans = payload.resourceSpans[0].scopeSpans[0].spans;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch((e) => {
    console.error(`\n✖ Could not reach Tracelet at ${ENDPOINT}`);
    console.error(`  Is it running? Start it with:  npx @jnmetacode/tracelet\n`);
    console.error(`  (${e.message})`);
    process.exit(1);
  });
  if (!res.ok) {
    console.error(`✖ Tracelet returned ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  console.log(`✓ Sent ${label} (${spans.length} spans) to ${ENDPOINT}`);
}

console.log();
if (COMPARE) {
  const [before, after] = demoPair();
  await send(before, 'run A — before (get_calendar fails)');
  await send(after, 'run B — after (tool fixed, summariser on haiku)');
  console.log(`\n  Open http://localhost:4321, select run A, press Compare, then click run B.\n`);
} else {
  await send(demoRun(), 'a demo agent trace');
  console.log(`  Open http://localhost:4321 to inspect it.  (--compare sends two runs to diff)\n`);
}
