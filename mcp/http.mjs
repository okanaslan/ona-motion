import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { createMotionRuntime } from './server.mjs';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
function reply(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message } }));
}
function readBody(req, maxBytes, timeoutMs) {
  return new Promise((resolve, reject) => {
    const chunks = []; let bytes = 0;
    const fail = (status, message) => finish(Object.assign(new Error(message), { status }));
    const timer = setTimeout(() => fail(408, 'Request body timed out'), timeoutMs);
    timer.unref();
    function finish(error, value) {
      clearTimeout(timer);
      req.removeListener('data', data); req.removeListener('end', end); req.removeListener('error', interrupted); req.removeListener('aborted', interrupted);
      if (error) { req.resume(); reject(error); } else resolve(value);
    }
    function data(chunk) {
      bytes += chunk.length;
      if (bytes > maxBytes) fail(413, 'Request exceeds the body-size limit'); else chunks.push(chunk);
    }
    function end() {
      try { finish(null, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))); }
      catch { fail(400, 'Invalid JSON request'); }
    }
    function interrupted() { fail(400, 'Request body interrupted'); }
    req.on('data', data); req.once('end', end); req.once('error', interrupted); req.once('aborted', interrupted);
    if (req.headers['content-length'] && (!/^\d+$/.test(req.headers['content-length']) || Number(req.headers['content-length']) > maxBytes)) fail(413, 'Request exceeds the body-size limit');
  });
}

// One runtime owns the workspace; each HTTP client gets its own protocol server.
export async function startHttpServer(workspace, {
  host = '127.0.0.1', port = 8766, maxSessions = 64,
  maxRequestBytes = 4 * 1024 * 1024, sessionIdleMs = 30 * 60 * 1000,
  requestBodyTimeoutMs = 15000, logger = record => console.error(JSON.stringify(record)),
} = {}) {
  if (!['127.0.0.1', '::1'].includes(host)) throw new Error('HTTP host must be a loopback address (127.0.0.1 or ::1).');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid HTTP port.');
  for (const limit of [maxSessions, maxRequestBytes, sessionIdleMs, requestBodyTimeoutMs]) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('HTTP limits must be positive safe integers.');
  }
  const runtime = createMotionRuntime(workspace), sessions = new Map();
  let initializing = 0, stopping = false, closing;
  const log = record => logger({ time: new Date().toISOString(), ...record });
  const server = http.createServer((req, res) => {
    void handle(req, res).catch(error => {
      log({ event: 'http_error', message: error.message });
      if (!res.headersSent && !res.destroyed) reply(res, error.status ?? 500, error.status ? error.message : 'Internal server error');
      else res.destroy();
    });
  });
  server.headersTimeout = 15000; server.requestTimeout = requestBodyTimeoutMs;
  async function handle(req, res) {
    const started = Date.now(); let rpcMethod, tool;
    res.once('finish', () => log({ event: 'http_request', method: req.method, status: res.statusCode, durationMs: Date.now() - started, ...(rpcMethod ? { rpcMethod } : {}), ...(tool ? { tool } : {}) }));
    let url, authority;
    try { authority = new URL(`http://${req.headers.host}`); url = new URL(req.url, authority); }
    catch { return reply(res, 403, 'Forbidden host'); }
    const expectedPort = String(server.address().port);
    if (!LOOPBACK.has(authority.hostname) || (authority.port || '80') !== expectedPort || url.origin !== authority.origin) return reply(res, 403, 'Forbidden host');
    if (req.headers.origin && req.headers.origin !== authority.origin) return reply(res, 403, 'Forbidden origin');
    if (stopping) return reply(res, 503, 'Server is shutting down');
    if (url.pathname === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, server: 'ona-motion', transport: 'http', sessions: sessions.size }));
    }
    if (url.pathname !== '/mcp') return reply(res, 404, 'Not found');
    if (!['POST', 'GET', 'DELETE'].includes(req.method)) {
      res.setHeader('Allow', 'POST, GET, DELETE'); return reply(res, 405, 'Method not allowed');
    }
    const body = req.method === 'POST' ? await readBody(req, maxRequestBytes, requestBodyTimeoutMs) : undefined;
    if (stopping) return reply(res, 503, 'Server is shutting down');
    if (typeof body?.method === 'string') rpcMethod = body.method;
    if (rpcMethod === 'tools/call' && typeof body.params?.name === 'string') tool = body.params.name;
    const id = req.headers['mcp-session-id'];
    let session = id ? sessions.get(id) : undefined;
    if (id && !session) return reply(res, 404, 'Session not found; initialize a new connection');
    let fresh = false;
    if (!session) {
      if (req.method !== 'POST' || !isInitializeRequest(body)) return reply(res, 400, 'Initialize required without a session id');
      if (sessions.size + initializing >= maxSessions) return reply(res, 503, 'Session capacity reached');
      initializing++; fresh = true;
      const protocol = runtime.createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(), enableJsonResponse: true,
        onsessioninitialized: sessionId => {
          sessions.set(sessionId, session);
          log({ event: 'session_open', sessions: sessions.size });
        },
      });
      session = { protocol, transport, open: 0, lastUsed: Date.now() };
      // Compose the runtime's cleanup callback rather than replacing it.
      const onclose = protocol.server.onclose;
      protocol.server.onclose = () => {
        onclose?.();
        if (transport.sessionId) sessions.delete(transport.sessionId);
        log({ event: 'session_close', sessions: sessions.size });
      };
      try { await protocol.connect(transport); }
      catch (error) { initializing--; await protocol.close(); throw error; }
    }
    session.open++; session.lastUsed = Date.now();
    res.once('close', () => { session.open--; session.lastUsed = Date.now(); });
    try { await session.transport.handleRequest(req, res, body); }
    finally {
      if (fresh) {
        initializing--;
        if (!session.transport.sessionId || !sessions.has(session.transport.sessionId)) await session.protocol.close();
      }
    }
  }
  const reaper = setInterval(() => {
    for (const session of sessions.values()) {
      if (!session.open && Date.now() - session.lastUsed >= sessionIdleMs) void session.protocol.close().catch(error => log({ event: 'session_error', message: error.message }));
    }
  }, Math.min(sessionIdleMs, 60000));
  reaper.unref();
  const close = () => closing ??= (async () => {
    stopping = true; clearInterval(reaper);
    const stopped = new Promise(resolve => server.close(resolve));
    await runtime.close();
    server.closeAllConnections(); await stopped;
    log({ event: 'server_stop' });
  })();
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => { server.removeListener('error', reject); resolve(); });
    });
  } catch (error) { await close(); throw error; }
  const address = server.address(), url = `http://${host === '::1' ? '[::1]' : host}:${address.port}/mcp`;
  log({ event: 'server_start', url });
  return { server, runtime, url, close };
}
