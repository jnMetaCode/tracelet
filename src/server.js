import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';
import { store } from './store.js';
import { parseOtlp } from './otlp.js';
import { decodeTraces } from './otlp-protobuf.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

function readBody(req, limitBytes = 50 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

// ---- OTLP ingest handler (shared by ingest + UI servers) -----------------
async function handleTraces(req, res) {
  try {
    const buf = await readBody(req);
    const ct = req.headers['content-type'] || '';
    // Accept both OTLP/HTTP encodings: protobuf (the exporter default) and JSON.
    const json = ct.includes('protobuf') ? decodeTraces(buf) : JSON.parse(buf.toString('utf8') || '{}');
    const spans = parseOtlp(json);
    if (spans.length) store.addSpans(spans);
    // OTLP expects an ExportTraceServiceResponse (empty object = success).
    return send(res, 200, {});
  } catch (err) {
    return send(res, 400, { error: String(err && err.message) });
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

function handleUi(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  if (req.method === 'OPTIONS') return send(res, 204, '');

  // Allow the UI server to also receive traces (some exporters hit one port).
  if (req.method === 'POST' && path === '/v1/traces') return handleTraces(req, res);

  if (req.method === 'GET' && path === '/api/traces') return send(res, 200, store.list());
  if (req.method === 'GET' && path.startsWith('/api/traces/')) {
    const id = decodeURIComponent(path.slice('/api/traces/'.length));
    const d = store.detail(id);
    return d ? send(res, 200, d) : send(res, 404, { error: 'not found' });
  }
  if (req.method === 'POST' && path === '/api/clear') {
    store.clear();
    return send(res, 200, { ok: true });
  }
  if (req.method === 'GET' && path === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('retry: 2000\n\n');
    store.subscribe(res);
    req.on('close', () => store.unsubscribe(res));
    return;
  }
  if (req.method === 'GET') return serveStatic(res, path);
  return send(res, 405, { error: 'method not allowed' });
}

export function startServer({ port = 4318, uiPort = 4321, open = true } = {}) {
  // Ingest server: bare OTLP endpoint on the conventional 4318.
  const ingest = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'OPTIONS') return send(res, 204, '');
    if (req.method === 'POST' && url.pathname === '/v1/traces') return handleTraces(req, res);
    return send(res, 404, { error: 'POST OTLP traces to /v1/traces' });
  });

  const ui = http.createServer(handleUi);

  ingest.listen(port, () => {
    ui.listen(uiPort, () => {
      const uiUrl = `http://localhost:${uiPort}`;
      console.log(`\n  tracelet — local DevTools for AI agents\n`);
      console.log(`  ▸ OTLP ingest   http://localhost:${port}/v1/traces`);
      console.log(`  ▸ Web UI        ${uiUrl}\n`);
      console.log(`  Point your agent's OTel exporter at the ingest URL above.`);
      console.log(`  Nothing leaves this machine.\n`);
      if (open) openBrowser(uiUrl);
    });
  });

  const bye = () => {
    ingest.close();
    ui.close();
    process.exit(0);
  };
  process.on('SIGINT', bye);
  process.on('SIGTERM', bye);
  return { ingest, ui };
}

function openBrowser(url) {
  const cmd =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  import('node:child_process')
    .then(({ spawn }) => spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref())
    .catch(() => {});
}
