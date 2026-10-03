import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHttpServer } from '../mcp/http.mjs';
import { createMotionServer } from '../mcp/server.mjs';
import { DEFAULT_WORKSPACE } from '../lib/project.mjs';

async function fixture(t, options = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ona-http-')));
  fs.mkdirSync(path.join(root, 'examples'));
  fs.mkdirSync(path.join(root, 'engine')); fs.writeFileSync(path.join(root, 'engine/player.html'), '');
  fs.cpSync(path.join(DEFAULT_WORKSPACE, 'templates'), path.join(root, 'templates'), { recursive: true });
  const logs = [], host = await startHttpServer(root, { port: 0, logger: record => logs.push(record), ...options });
  t.after(async () => { await host.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, logs, host };
}
async function connect(t, url) {
  const transport = new StreamableHTTPClientTransport(new URL(url));
  const client = new Client({ name: 'http-contract-check', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(transport);
  return { client, transport };
}

test('HTTP clients share authoring and jobs without acquiring another workspace lock', async t => {
  const { root, host, logs } = await fixture(t);
  const [a, b] = await Promise.all([connect(t, host.url), connect(t, host.url)]);
  assert.notEqual(a.transport.sessionId, b.transport.sessionId);
  assert.equal((await a.client.listTools()).tools.length, 14);
  const created = await a.client.callTool({ name: 'create_project', arguments: { name: 'demo', duration: 1 } });
  assert.equal(created.structuredContent.ok, true);
  const scene = await b.client.callTool({ name: 'read_scene', arguments: { project: 'examples/demo' } });
  const updated = await a.client.callTool({ name: 'update_scene', arguments: { project: 'examples/demo', source: 'export default { draw() {} };', expectedRevision: scene.structuredContent.result.revision } });
  assert.equal(updated.structuredContent.ok, true);
  const stale = await b.client.callTool({ name: 'update_scene', arguments: { project: 'examples/demo', source: 'export default {};', expectedRevision: scene.structuredContent.result.revision } });
  assert.equal(stale.structuredContent.error.code, 'REVISION_CONFLICT');
  assert.throws(() => createMotionServer(root), { code: 'WORKSPACE_BUSY' });
  const guide = await b.client.readResource({ uri: 'ona-motion://scene-guide' });
  assert.match(guide.contents[0].text, /draw/);
  // Hold a fake render open to check disconnect/shutdown semantics without Chrome.
  let started, finished;
  const running = new Promise(resolve => { started = resolve; });
  host.runtime.jobs.render = async (_root, _project, { signal }) => {
    started(); await new Promise(resolve => { finished = resolve; signal.addEventListener('abort', resolve, { once: true }); });
    return {};
  };
  const job = host.runtime.jobs.submit('examples/demo');
  await running;
  await a.transport.terminateSession(); await a.client.close();
  assert.equal(host.runtime.jobs.get(job.id).status, 'running');
  const observed = await b.client.callTool({ name: 'get_job', arguments: { jobId: job.id } });
  assert.equal(observed.structuredContent.result.status, 'running');
  assert.equal(fs.existsSync(path.join(root, 'out/.ona-motion/server.lock')), true);
  await host.close(); finished();
  assert.equal(host.runtime.jobs.get(job.id).status, 'cancelled');
  assert.equal(fs.existsSync(path.join(root, 'out/.ona-motion/server.lock')), false);
  assert(logs.some(record => record.tool === 'update_scene'));
  assert(logs.every(record => !Object.hasOwn(record, 'arguments') && !Object.hasOwn(record, 'source')));
});

test('HTTP rejects malformed requests, unknown sessions and nonlocal hosts/origins', async t => {
  const { host } = await fixture(t, { maxRequestBytes: 1024 });
  const request = async (method, body, headers = {}) => fetch(host.url, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body }) });
  assert.equal((await request('POST', '{')).status, 400);
  assert.equal((await request('POST', ' '.repeat(1025))).status, 413);
  assert.equal((await request('POST', '{}')).status, 400);
  assert.equal((await request('GET', undefined, { 'mcp-session-id': 'unknown' })).status, 404);
  assert.equal((await request('GET', undefined, { Origin: 'https://example.com' })).status, 403);
  assert.equal((await request('PUT', '{}')).status, 405);
  const denied = await new Promise(resolve => {
    const req = http.request(host.url, { headers: { Host: 'example.com' } }, res => { res.resume(); resolve(res.statusCode); }); req.end();
  });
  assert.equal(denied, 403);
  assert.equal((await fetch(host.url.replace('/mcp', '/health'))).status, 200);
  assert.equal((await fetch(host.url.replace('/mcp', '/missing'))).status, 404);
});

test('HTTP session capacity is reclaimed on DELETE; bind errors release the workspace', async t => {
  const { root, host } = await fixture(t, { maxSessions: 1 });
  const a = await connect(t, host.url);
  const second = new Client({ name: 'capacity-check', version: '1.0.0' });
  t.after(() => second.close());
  await assert.rejects(second.connect(new StreamableHTTPClientTransport(new URL(host.url))), /Session capacity reached/);
  await a.transport.terminateSession(); await a.client.close();
  const b = await connect(t, host.url);
  assert.equal((await b.client.listTools()).tools.length, 14);
  await host.close();
  const blocker = http.createServer();
  await new Promise(resolve => blocker.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => blocker.close(resolve)));
  await assert.rejects(startHttpServer(root, { port: blocker.address().port, logger() {} }), { code: 'EADDRINUSE' });
  assert.equal(fs.existsSync(path.join(root, 'out/.ona-motion/server.lock')), false);
});

test('idle sessions expire without closing the workspace runtime', async t => {
  const { host, root } = await fixture(t, { sessionIdleMs: 30 });
  const a = await connect(t, host.url);
  const oldId = a.transport.sessionId;
  await a.client.close();
  const deadline = Date.now() + 2000;
  let active = 1;
  do {
    await new Promise(resolve => setTimeout(resolve, 20));
    active = (await (await fetch(host.url.replace('/mcp', '/health'))).json()).sessions;
  } while (active && Date.now() < deadline);
  assert.equal(active, 0);
  const response = await fetch(host.url, { method: 'DELETE', headers: { 'mcp-session-id': oldId } });
  assert.equal(response.status, 404);
  assert.equal(fs.existsSync(path.join(root, 'out/.ona-motion/server.lock')), true);
  const b = await connect(t, host.url);
  assert.equal((await b.client.listTools()).tools.length, 14);
});

test('chunked bodies are bounded and interrupted/slow bodies do not hang the host', async t => {
  const { host } = await fixture(t, { maxRequestBytes: 1024, requestBodyTimeoutMs: 50 });
  const send = async (write, end = true) => new Promise((resolve, reject) => {
    const req = http.request(host.url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
      res.resume(); res.once('end', () => { req.destroy(); resolve(res.statusCode); });
    });
    req.on('error', reject); req.write(write); if (end) req.end();
  });
  assert.equal(await send(' '.repeat(1025)), 413);
  assert.equal(await send('{', false), 408);
  assert.equal((await fetch(host.url.replace('/mcp', '/health'))).status, 200);
});
