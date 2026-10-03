import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHttpServer } from '../mcp/http.mjs';
import { createMotionServer } from '../mcp/server.mjs';
import { DEFAULT_WORKSPACE, createProject } from '../lib/project.mjs';
import { MAX_RESOURCE_BYTES } from '../mcp/artifacts.mjs';
import { byteRange } from '../mcp/downloads.mjs';

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

test('saved PNGs and large videos download over HTTP with HEAD and byte-range seeking', async t => {
  const { root, host } = await fixture(t);
  createProject(root, 'demo');
  const { client } = await connect(t, host.url);
  const id = randomUUID(), dir = path.join(root, 'examples/demo/out/mcp/frames', id);
  fs.mkdirSync(dir, { recursive: true });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGScAAAAASUVORK5CYII=', 'base64');
  const filename = path.join(dir, 'f00000.png'); fs.writeFileSync(filename, png);
  host.runtime.artifacts.saveFrames(id, { project: 'examples/demo', frames: [{ frame: 0, time: 0, path: filename }] });
  const image = await client.callTool({ name: 'get_artifact', arguments: { uri: `ona-motion://frames/${id}/f00000.png` } });
  assert.equal(image.structuredContent.ok, true);
  const imageUrl = image.structuredContent.result.downloadUrl;
  assert.equal(new URL(imageUrl).origin, new URL(host.url).origin);
  assert.deepEqual(Buffer.from(await (await fetch(imageUrl)).arrayBuffer()), png);
  const imageHead = await fetch(imageUrl, { method: 'HEAD' });
  assert.equal(imageHead.headers.get('Content-Type'), 'image/png');
  assert.equal(Number(imageHead.headers.get('Content-Length')), png.length);
  assert.equal((await imageHead.arrayBuffer()).byteLength, 0);
  assert.match((await fetch(imageUrl + '?download=1')).headers.get('Content-Disposition'), /^attachment/);
  const imageFd = fs.openSync(filename, 'r+'); fs.ftruncateSync(imageFd, MAX_RESOURCE_BYTES + 1); fs.closeSync(imageFd);
  const oversized = await client.callTool({ name: 'get_artifact', arguments: { uri: image.structuredContent.result.uri } });
  assert.equal(oversized.structuredContent.error.code, 'ARTIFACT_TOO_LARGE');
  assert.equal(oversized.structuredContent.error.details.downloadUrl, imageUrl);
  assert.equal(Number((await fetch(imageUrl, { method: 'HEAD' })).headers.get('Content-Length')), MAX_RESOURCE_BYTES + 1);
  const videoId = randomUUID(), videoDir = path.join(root, 'examples/demo/out/mcp/jobs', videoId);
  fs.mkdirSync(videoDir, { recursive: true });
  const video = path.join(videoDir, 'video.mp4'), size = MAX_RESOURCE_BYTES + 1024;
  fs.writeFileSync(video, 'test-video-header');
  const fd = fs.openSync(video, 'r+'); fs.ftruncateSync(fd, size); fs.closeSync(fd);
  const record = { id: videoId, project: 'examples/demo', status: 'completed', createdAt: new Date().toISOString(), result: { path: video } };
  host.runtime.jobs.records.set(videoId, record); host.runtime.jobs.persist(record);
  const job = await client.callTool({ name: 'get_job', arguments: { jobId: videoId } });
  const videoUrl = job.structuredContent.result.artifact.downloadUrl;
  const meta = await client.callTool({ name: 'get_artifact', arguments: { uri: `ona-motion://jobs/${videoId}/video` } });
  assert.equal(meta.structuredContent.result.downloadUrl, videoUrl);
  assert.equal(meta.content.some(c => c.type === 'image'), false);
  await assert.rejects(client.readResource({ uri: `ona-motion://jobs/${videoId}/video` }), /MCP reads are limited/);
  const download = await fetch(videoUrl);
  assert.equal(download.status, 200); assert.equal(download.headers.get('Content-Type'), 'video/mp4');
  assert.equal((await download.arrayBuffer()).byteLength, size);
  for (const [range, start, end] of [['bytes=0-3', 0, 3], ['bytes=5-', 5, size - 1], ['bytes=-4', size - 4, size - 1], ['bytes=0-99999999', 0, size - 1]]) {
    const res = await fetch(videoUrl, { headers: { Range: range } });
    assert.equal(res.status, 206); assert.equal(res.headers.get('Content-Range'), `bytes ${start}-${end}/${size}`);
    assert.equal((await res.arrayBuffer()).byteLength, end - start + 1);
  }
  const badRange = await fetch(videoUrl, { headers: { Range: `bytes=${size}-` } });
  assert.equal(badRange.status, 416); assert.equal(badRange.headers.get('Content-Range'), `bytes */${size}`);
  const unchanged = await fetch(videoUrl, { headers: { Range: 'bytes=0-3', 'If-Range': 'Thu, 01 Jan 1970 00:00:00 GMT' } });
  assert.equal(unchanged.status, 200); await unchanged.body.cancel();
  const head = await fetch(videoUrl, { method: 'HEAD', headers: { Range: 'bytes=0-3' } });
  assert.equal(head.status, 200); assert.equal(Number(head.headers.get('Content-Length')), size);
  assert.equal((await fetch(videoUrl, { method: 'POST' })).status, 405);
  const matching = await fetch(videoUrl, { headers: { Range: 'bytes=0-3', 'If-Range': head.headers.get('Last-Modified') } });
  assert.equal(matching.status, 206); assert.equal(Buffer.from(await matching.arrayBuffer()).toString(), 'test');
  const unmatchedTag = await fetch(videoUrl, { headers: { Range: 'bytes=0-3', 'If-Range': '"9999"' } });
  assert.equal(unmatchedTag.status, 200); await unmatchedTag.body.cancel();
  record.status = 'running';
  assert.equal((await fetch(videoUrl)).status, 404);
  record.status = 'completed';
});

test('download routes reject unknown artifacts, traversal, symlinks and cross-origin requests', async t => {
  const { root, host } = await fixture(t); createProject(root, 'demo');
  const id = randomUUID(), dir = path.join(root, 'examples/demo/out/mcp/frames', id);
  fs.mkdirSync(dir, { recursive: true });
  const filename = path.join(dir, 'f00000.png');
  const secret = path.join(root, 'private.png'); fs.writeFileSync(secret, 'private'); fs.symlinkSync(secret, filename);
  host.runtime.artifacts.saveFrames(id, { project: 'examples/demo', frames: [{ path: filename }] });
  const base = new URL('/artifacts/', host.url).href;
  for (const suffix of [`frames/${id}/f00000.png`, `frames/${id}/missing.png`, `frames/${id}/%2Fprivate.png`, `frames/${id}/%252e%252e`, `jobs/${randomUUID()}/video`, '%zz']) {
    assert.equal((await fetch(base + suffix)).status, 404);
  }
  assert.equal((await fetch(base + `frames/${id}/f00000.png`, { headers: { Origin: 'https://example.com' } })).status, 403);
  const denied = await new Promise(resolve => {
    const req = http.request(base + `frames/${id}/f00000.png`, { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.end();
  });
  assert.equal(denied, 403);
});

test('single-range parsing rejects malformed or unsafe ranges', () => {
  for (const value of ['bytes=', 'bytes=-0', 'bytes=4-2', 'bytes=100-', 'bytes=0-1,2-3', 'bytes=9007199254740992-', 'items=0-1']) assert.equal(byteRange(value, 100), null);
  assert.deepEqual(byteRange('bytes=-200', 100), { start: 0, end: 99 });
  assert.equal(byteRange('bytes=0-', 0), null);
});
