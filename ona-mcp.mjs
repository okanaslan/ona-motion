#!/usr/bin/env node
import { DEFAULT_WORKSPACE } from './lib/project.mjs';
import { createMotionServer } from './mcp/server.mjs';
import { startHttpServer } from './mcp/http.mjs';

const args = process.argv.slice(2);
const usage = 'node ona-mcp.mjs [--workspace <checkout>] [--transport stdio|http] [--host 127.0.0.1|::1] [--port 8766]';
if (args.includes('--help')) {
  console.log(`ona-motion MCP server\n  ${usage}\n  stdio is the default; HTTP exposes /mcp and /health. Diagnostics go to stderr.`);
} else {
  let runtime;
  try {
    const options = { workspace: DEFAULT_WORKSPACE, transport: 'stdio', host: '127.0.0.1', port: 8766 }, seen = new Set();
    for (let i = 0; i < args.length; i += 2) {
      const key = args[i].slice(2), value = args[i + 1];
      if (!args[i].startsWith('--') || !Object.hasOwn(options, key) || !value || seen.has(key)) throw new Error(`usage: ${usage}`);
      options[key] = key === 'port' ? Number(value) : value; seen.add(key);
    }
    if (!['stdio', 'http'].includes(options.transport)) throw new Error('Transport must be stdio or http.');
    if (options.transport === 'stdio' && (seen.has('host') || seen.has('port'))) throw new Error('--host and --port require --transport http.');
    if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error('Port must be between 1 and 65535.');
    runtime = options.transport === 'http'
      ? await startHttpServer(options.workspace, options)
      : createMotionServer(options.workspace);
    const stop = () => { void runtime.close().catch(error => { console.error(error.message); process.exitCode = 1; }); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    if (options.transport === 'stdio') {
      process.stdin.once('end', stop);
      runtime.server.server.onclose = stop;
      runtime.server.server.onerror = error => console.error(error.message);
      await runtime.connect();
    }
  } catch (error) {
    console.error(`${error.code ?? 'STARTUP_FAILED'}: ${error.message}`); process.exitCode = 1;
    await runtime?.close();
  }
}
