#!/usr/bin/env node
import { startServer } from './server.js';

function parseArgs(argv) {
  const args = { port: 4318, uiPort: 4321, open: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' || a === '-p') args.port = Number(argv[++i]);
    else if (a === '--ui-port') args.uiPort = Number(argv[++i]);
    else if (a === '--no-open') args.open = false;
    else if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--version' || a === '-v') args.version = true;
  }
  return args;
}

const HELP = `
tracelet — local-first DevTools for AI agents

Usage:
  npx tracelet [options]

Options:
  -p, --port <n>      OTLP/HTTP ingest port (default: 4318)
      --ui-port <n>   Web UI port (default: 4321)
      --no-open       Do not auto-open the browser
  -h, --help          Show this help
  -v, --version       Show version

Point any OpenTelemetry exporter at:
  http://localhost:4318/v1/traces

Then open the UI:
  http://localhost:4321
`;

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(HELP);
  process.exit(0);
}
if (args.version) {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const pkg = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8')
  );
  console.log(pkg.version);
  process.exit(0);
}

startServer(args);
