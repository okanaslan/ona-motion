import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { MotionError, loadProject, scopedPath, workspaceRoot } from '../lib/project.mjs';
import { renderVideo } from '../lib/render.mjs';

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function validId(id) {
  if (!UUID.test(id)) throw new MotionError('INVALID_ID', 'Expected an ona-motion job or artifact UUID.');
  return id;
}
export function writeJson(filename, value) {
  const temp = filename + `.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, JSON.stringify(value, null, 2), { flag: 'wx' }); fs.renameSync(temp, filename); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}

// One server owns a workspace's queue. Records survive reconnects and server restarts.
export class JobManager {
  constructor(workspace, { render = renderVideo, maxJobs = 200, timeoutMs = 30 * 60 * 1000 } = {}) {
    this.root = workspaceRoot(workspace); this.render = render; this.maxJobs = maxJobs; this.timeoutMs = timeoutMs;
    this.dir = scopedPath(this.root, 'out/.ona-motion/jobs'); fs.mkdirSync(this.dir, { recursive: true });
    this.lock = scopedPath(this.root, 'out/.ona-motion/server.lock');
    this.acquireLock();
    this.records = new Map(); this.queue = []; this.active = null; this.closed = false; this.running = null;
    try {
      for (const filename of fs.readdirSync(this.dir).filter(name => name.endsWith('.json'))) {
        const record = JSON.parse(fs.readFileSync(scopedPath(this.root, path.join(this.dir, filename)), 'utf8'));
        validId(record.id);
        if (!TERMINAL.has(record.status)) {
          record.status = 'failed'; record.error = { code: 'INTERRUPTED', message: 'Server stopped before this job completed. Submit a new render.' }; record.updatedAt = new Date().toISOString();
          this.persist(record);
        }
        this.records.set(record.id, record);
      }
    } catch (error) { this.releaseLock(); throw error; }
  }
  acquireLock() {
    if (fs.existsSync(this.lock)) {
      const previous = JSON.parse(fs.readFileSync(this.lock, 'utf8'));
      let alive = true;
      try { process.kill(previous.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; }
      if (alive) throw new MotionError('WORKSPACE_BUSY', 'Another ona-motion MCP server owns this workspace. Close it before starting another.');
      fs.unlinkSync(this.lock);
    }
    this.lockToken = randomUUID();
    fs.writeFileSync(this.lock, JSON.stringify({ pid: process.pid, token: this.lockToken }), { flag: 'wx' });
  }
  releaseLock() {
    if (fs.existsSync(this.lock) && JSON.parse(fs.readFileSync(this.lock, 'utf8')).token === this.lockToken) fs.unlinkSync(this.lock);
  }
  persist(record) { writeJson(scopedPath(this.root, path.join(this.dir, `${validId(record.id)}.json`)), record); }
  get(id) {
    const record = this.records.get(validId(id));
    if (!record) throw new MotionError('JOB_NOT_FOUND', 'No render job with this ID exists in this workspace.');
    return structuredClone(record);
  }
  list(limit = 10) { return [...this.records.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit).map(r => structuredClone(r)); }
  submit(project, options = {}) {
    if (this.closed) throw new MotionError('SERVER_STOPPING', 'The server is shutting down.');
    if (this.records.size >= this.maxJobs) throw new MotionError('JOB_LIMIT', `The workspace already has ${this.maxJobs} job records. Archive old generated records before submitting more.`);
    const p = loadProject(this.root, project), id = randomUUID(), now = new Date().toISOString();
    const record = { id, project: p.relative, status: 'queued', createdAt: now, updatedAt: now, progress: { completed: 0, total: p.frames }, options };
    this.persist(record); this.records.set(id, record); this.queue.push(id);
    // Start after returning the durable job handle to the caller.
    setImmediate(() => {
      if (!this.running) this.running = this.drain().catch(error => {
        this.closed = true; console.error(`JOB_STORAGE_FAILED: ${error.message}`);
      }).finally(() => { this.running = null; });
    });
    return this.get(id);
  }
  async drain() {
    while (this.queue.length && !this.closed) {
      const record = this.records.get(this.queue.shift());
      if (TERMINAL.has(record.status)) continue;
      const controller = new AbortController(); this.active = { id: record.id, controller };
      record.status = 'running'; record.updatedAt = new Date().toISOString(); this.persist(record);
      const timer = setTimeout(() => { this.active.timeout = true; controller.abort(); }, this.timeoutMs); timer.unref();
      let lastWrite = 0;
      try {
        const p = loadProject(this.root, record.project);
        const output = scopedPath(this.root, path.join(p.out, 'mcp', 'jobs', record.id, 'video.mp4'));
        const result = await this.render(this.root, record.project, { ...record.options, output, signal: controller.signal,
          onProgress: progress => {
            record.progress = progress; record.updatedAt = new Date().toISOString();
            if (Date.now() - lastWrite >= 1000) { this.persist(record); lastWrite = Date.now(); }
          } });
        if (controller.signal.aborted) throw new MotionError('CANCELLED', 'Rendering was cancelled.');
        record.status = 'completed'; record.result = result;
      } catch (error) {
        record.status = controller.signal.aborted && !this.active.timeout ? 'cancelled' : 'failed';
        record.error = { code: this.active.timeout ? 'TIMEOUT' : error.code ?? 'RENDER_FAILED', message: this.active.timeout ? 'Rendering exceeded the job deadline.' : error.message };
      } finally {
        clearTimeout(timer); record.updatedAt = new Date().toISOString(); this.persist(record); this.active = null;
      }
    }
  }
  cancel(id) {
    const record = this.records.get(validId(id));
    if (!record) throw new MotionError('JOB_NOT_FOUND', 'No render job with this ID exists.');
    if (TERMINAL.has(record.status)) return this.get(id);
    if (record.status === 'queued') record.status = 'cancelled';
    else { record.status = 'cancelling'; this.active?.controller.abort(); }
    record.updatedAt = new Date().toISOString(); this.persist(record);
    return this.get(id);
  }
  async close() {
    this.closed = true;
    for (const record of this.records.values()) if (!TERMINAL.has(record.status)) this.cancel(record.id);
    try { await this.running; } finally { this.releaseLock(); }
  }
}
