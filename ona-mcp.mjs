#!/usr/bin/env node
import { DEFAULT_WORKSPACE } from './lib/project.mjs';
import { createMotionServer } from './mcp/server.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('ona-motion MCP server\n  node ona-mcp.mjs [--workspace /absolute/path/to/ona-motion]\n  stdout carries MCP messages; diagnostics go to stderr.');
} else {
  let runtime;
  try {
    if (args.length && (args.length !== 2 || args[0] !== '--workspace')) throw new Error('usage: node ona-mcp.mjs [--workspace <checkout>]');
    runtime = createMotionServer(args[1] ?? DEFAULT_WORKSPACE);
    const stop = () => { void runtime.close().catch(error => { console.error(error.message); process.exitCode = 1; }); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop); process.stdin.once('end', stop);
    runtime.server.server.onclose = stop;
    runtime.server.server.onerror = error => console.error(error.message);
    await runtime.connect();
  } catch (error) {
    console.error(`${error.code ?? 'STARTUP_FAILED'}: ${error.message}`); process.exitCode = 1;
    await runtime?.close();
  }
}
