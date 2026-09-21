import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { gunzipSync, inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';
import { store } from './store.js';
import { parseOtlp } from './otlp.js';
import { decodeTraces } from './otlp-protobuf.js';
import { diffTraces } from './diff.js';
import { demoPair } from './demo.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

// Bounds on what one request may make us hold in memory. OTLP batches are
// normally kilobytes; these are generous for a local dev tool and small enough
// that a bad batch can't take the process down.
export const MAX_BODY_BYTES = 50 * 1024 * 1024;
export const MAX_INFLATED_BYTES = 64 * 1024 * 1024;

class TooLarge extends Error {
  constructor(what) {
    super(`${what} exceeds the limit`);
    this.status = 413;
  }
}

function readBody(req, limitBytes = MAX_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const declared = Number(req.headers['content-length']);
    if (declared > limitBytes) return reject(new TooLarge(`body (${declared} bytes)`));
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new TooLarge('body'));
        req.pause(); // stop reading; the 413 goes out before the socket closes
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// CORS is granted ONLY to the OTLP ingest path: browser-side OTel exporters
// POST cross-origin and need it. The UI API (/api/*) deliberately sends no
// Access-Control-* headers — otherwise any web page open in the same browser
// could fetch http://localhost:4321/api/traces and read every prompt.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
};

function send(res, code, body, type = 'application/json', extraHeaders = {}) {
  res.writeHead(code, { 'Content-Type': type, ...extraHeaders });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

// State-changing UI endpoints require a custom header. Cross-origin, a custom
// header forces a CORS preflight, which fails (no CORS on /api), so a hostile
// page can't e.g. POST /api/clear as a "simple request".
const UI_HEADER = 'x-tracelet-ui';
// What the UI needs to show accurate wiring instructions (set by startServer).
const CONFIG = { ingestPort: 4318, host: '127.0.0.1' };
const fromUi = (req) => req.headers[UI_HEADER] === '1';

// DNS rebinding: a hostile site can re-point its own name at 127.0.0.1, and the
// browser then treats http://evil.example:4321 as same-origin — CORS and the
// custom header above no longer help. What it cannot fake is the Host header,
// so a loopback-bound UI only answers to loopback names. With `--host` set to a
// non-loopback address you have exposed the UI on purpose and any name goes.
const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const isLoopback = (host) => host === 'localhost' || host === '::1' || /^127\./.test(host);
function hostAllowed(req, bindHost) {
  if (!isLoopback(bindHost)) return true;
  const name = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  return LOOPBACK_NAMES.has(name) || /^127\.\d+\.\d+\.\d+$/.test(name);
}

// ---- OTLP ingest handler (shared by ingest + UI servers) -----------------
async function handleTraces(req, res) {
  try {
    let buf = await readBody(req);
    const ct = req.headers['content-type'] || '';
    // OTel exporters / the Collector commonly gzip the body — decompress first.
    const enc = (req.headers['content-encoding'] || '').toLowerCase();
    // A 4 MB gzip of zeros inflates to 4 GB — cap the inflated size or a
    // single hostile/buggy batch OOMs the process.
    try {
      if (enc.includes('gzip')) buf = gunzipSync(buf, { maxOutputLength: MAX_INFLATED_BYTES });
      else if (enc.includes('deflate')) buf = inflateSync(buf, { maxOutputLength: MAX_INFLATED_BYTES });
    } catch (e) {
      if (e.code === 'ERR_BUFFER_TOO_LARGE') throw new TooLarge('inflated body');
      throw e;
    }
    // Accept both OTLP/HTTP encodings: protobuf (the exporter default) and JSON.
    const json = ct.includes('protobuf') ? decodeTraces(buf) : JSON.parse(buf.toString('utf8') || '{}');
    const spans = parseOtlp(json);
    if (spans.length) store.addSpans(spans);
    // OTLP expects an ExportTraceServiceResponse (empty object = success).
    return send(res, 200, {}, 'application/json', CORS);
  } catch (err) {
    const status = err && err.status === 413 ? 413 : 400;
    send(res, status, { error: String(err && err.message) }, 'application/json', { ...CORS, Connection: 'close' });
    if (status === 413) req.destroy(); // don't keep draining an oversized upload
    return undefined;
  }
}

// ---- UI / API server ------------------------------------------------------
async function serveStatic(res, urlPath) {
  const rel = urlPath === '/' ? '/index.html' : urlPath;
  const filePath = normalize(join(PUBLIC, rel));
  if (!filePath.startsWith(PUBLIC)) return send(res, 403, 'forbidden', 'text/plain');
  try {
    const data = await readFile(filePath);
    const ext = filePath.slice(filePath.lastIndexOf('.'));
    return send(res, 200, data, MIME[ext] || 'application/octet-stream');
  } catch {
    return send(res, 404, 'not found', 'text/plain');
  }
}

function handleUi(req, res, bindHost = CONFIG.host) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  // Allow the UI server to also receive traces (some exporters hit one port).
  // Ingest is exempt from the Host check: containers reach it by service name.
  if (path === '/v1/traces') {
    if (req.method === 'OPTIONS') return send(res, 204, '', 'text/plain', CORS);
    if (req.method === 'POST') return handleTraces(req, res);
  }
  if (!hostAllowed(req, bindHost)) {
    return send(res, 403, 'tracelet only answers to localhost / 127.0.0.1. Open it at http://localhost:<ui-port>, or start it with --host to expose it.\n', 'text/plain');
  }
  if (req.method === 'OPTIONS') return send(res, 204, ''); // no CORS grant

  if (req.method === 'GET' && path === '/api/config') return send(res, 200, CONFIG);
  if (req.method === 'GET' && path === '/api/traces') return send(res, 200, store.list());
  // Full-text search over prompts, completions, tool payloads, models, names.
  if (req.method === 'GET' && path === '/api/search') return send(res, 200, store.search((url.searchParams.get('q') || '').slice(0, 500)));
  // Compare two runs step by step: /api/diff?a=<traceId>&b=<traceId>
  if (req.method === 'GET' && path === '/api/diff') {
    const a = store.detail(url.searchParams.get('a') || '');
    const b = store.detail(url.searchParams.get('b') || '');
    if (!a || !b) return send(res, 404, { error: 'both a and b must be known trace ids' });
    return send(res, 200, diffTraces(a, b));
  }
  if (req.method === 'GET' && path.startsWith('/api/traces/')) {
    const id = decodeURIComponent(path.slice('/api/traces/'.length));
    const d = store.detail(id);
    return d ? send(res, 200, d) : send(res, 404, { error: 'not found' });
  }
  // First-run demo: two synthetic runs of one agent, no clone or script needed.
  if (req.method === 'POST' && path === '/api/demo') {
    if (!fromUi(req)) return send(res, 403, { error: `missing ${UI_HEADER}: 1 header` });
    for (const run of demoPair()) store.addSpans(parseOtlp(run));
    return send(res, 200, { ok: true });
  }
  if (req.method === 'POST' && path === '/api/clear') {
    if (!fromUi(req)) return send(res, 403, { error: `missing ${UI_HEADER}: 1 header` });
    store.clear();
    return send(res, 200, { ok: true });
  }
  if (req.method === 'GET' && path === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('retry: 2000\n\n');
    store.subscribe(res);
    req.on('close', () => store.unsubscribe(res));
    return;
  }
  if (req.method === 'GET') return serveStatic(res, path);
  return send(res, 405, { error: 'method not allowed' });
}

// Loopback by default: the UI holds your prompts, so it must not be reachable
// from the LAN unless you ask (`--host 0.0.0.0`, e.g. inside a container).
// Is something at this UI port already a tracelet? (The most common reason the
// ingest port is busy: you already started one in another terminal.)
async function isTracelet(host, uiPort) {
  try {
    const h = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
    const r = await fetch(`http://${h}:${uiPort}/api/traces`, { signal: AbortSignal.timeout(800) });
    return r.ok && Array.isArray(await r.json());
  } catch {
    return false;
  }
}

export function startServer({
  port = 4318,
  uiPort = 4321,
  host = '127.0.0.1',
  open = true,
  persist = null,
  demo = false,
  exitOnListenError = false,
} = {}) {
  if (persist) store.enablePersist(persist);
  if (demo) for (const run of demoPair()) store.addSpans(parseOtlp(run));
  CONFIG.ingestPort = port;
  CONFIG.host = host;
  // Ingest server: bare OTLP endpoint on the conventional 4318.
  const ingest = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/v1/traces') return send(res, 404, { error: 'POST OTLP traces to /v1/traces' });
    if (req.method === 'OPTIONS') return send(res, 204, '', 'text/plain', CORS);
    if (req.method === 'POST') return handleTraces(req, res);
    return send(res, 405, { error: 'POST OTLP traces to /v1/traces' }, 'application/json', CORS);
  });

  const ui = http.createServer((req, res) => handleUi(req, res, host));

  // A busy port must read as advice, not as a Node stack trace.
  const onListenError = (which, busyPort) => async (err) => {
    ingest.close();
    ui.close();
    const lines = [];
    if (err.code === 'EADDRINUSE') {
      if (await isTracelet(host, uiPort)) {
        lines.push(`tracelet is already running → http://localhost:${uiPort}`);
        lines.push(`(ingest on :${port}). Use that one, or stop it first.`);
      } else {
        lines.push(`Port ${busyPort} (${which}) is already in use by another program.`);
        if (which === 'OTLP ingest') lines.push(`An OpenTelemetry Collector or Jaeger often holds 4318.`);
        lines.push(`Pick free ports:  npx @jnmetacode/tracelet --port ${port + 1} --ui-port ${uiPort + 1}`);
        if (which === 'OTLP ingest') lines.push(`…and point your exporter at http://localhost:${port + 1}/v1/traces`);
      }
    } else if (err.code === 'EACCES') {
      lines.push(`Not allowed to listen on port ${busyPort} (${which}). Ports below 1024 need extra privileges — use a higher one.`);
    } else if (err.code === 'EADDRNOTAVAIL') {
      lines.push(`Cannot bind to --host ${host}: that address isn't on this machine.`);
    } else {
      lines.push(`Could not start the ${which} server on ${host}:${busyPort}: ${err.message}`);
    }
    console.error('\n  ' + lines.join('\n  ') + '\n');
    if (exitOnListenError) process.exit(1);
  };
  ingest.on('error', onListenError('OTLP ingest', port));
  ui.on('error', onListenError('web UI', uiPort));

  // Resolves once both ports are listening (never, if either fails to bind).
  let markReady;
  const ready = new Promise((resolve) => (markReady = resolve));

  const shown = host === '0.0.0.0' || host === '::' ? 'localhost' : host;
  ingest.listen(port, host, () => {
    ui.listen(uiPort, host, () => {
      const uiUrl = `http://${shown}:${uiPort}`;
      console.log(`\n  tracelet — local DevTools for AI agents\n`);
      console.log(`  ▸ OTLP ingest   http://${shown}:${port}/v1/traces`);
      console.log(`  ▸ Web UI        ${uiUrl}`);
      if (demo) console.log(`  ▸ Demo          two sample runs loaded — open the UI and press Compare`);
      if (persist) {
        const n = store.loadedBatches || 0;
        console.log(`  ▸ History       ${persist}${n ? ` (restored ${n} batch${n === 1 ? '' : 'es'})` : ''}`);
      }
      if (host === '0.0.0.0' || host === '::') console.log(`  ▸ Exposed on all interfaces (--host ${host}) — anyone on the network can read traces.`);
      console.log(`\n  Point your agent's OTel exporter at the ingest URL above.`);
      console.log(`  Nothing leaves this machine.\n`);
      markReady();
      if (open) openBrowser(uiUrl);
    });
  });

  // Signal handling (Ctrl+C → exit) belongs to the CLI, not here: startServer is
  // the package's main export, and a library must not take over a host
  // process's SIGINT or add listeners every time it's called.
  return { ingest, ui, ready };
}

function openBrowser(url) {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  import('node:child_process')
    .then(({ spawn }) => spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref())
    .catch(() => {});
}
