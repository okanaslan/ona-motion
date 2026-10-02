import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { DEFAULT_WORKSPACE, createProject } from '../lib/project.mjs';
import { JobManager, writeJson } from '../mcp/jobs.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ona-motion-jobs-'));
  fs.mkdirSync(path.join(root, 'engine')); fs.writeFileSync(path.join(root, 'engine/player.html'), '');
  fs.mkdirSync(path.join(root, 'examples'));
  fs.cpSync(path.join(DEFAULT_WORKSPACE, 'templates'), path.join(root, 'templates'), { recursive: true });
  createProject(root, 'demo');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return fs.realpathSync(root);
}

test('jobs execute sequentially, persist progress/results and survive a restart', async t => {
  const root = fixture(t), started = [], releases = [];
  const render = async (_root, _project, options) => {
    started.push(options.output); options.onProgress({ completed: 20, total: 900 });
    await new Promise(resolve => releases.push(resolve));
    return { path: options.output, frames: 900 };
  };
  const jobs = new JobManager(root, { render }); t.after(() => jobs.close());
  const first = jobs.submit('examples/demo'), second = jobs.submit('examples/demo');
  assert.equal(jobs.get(first.id).status, 'queued');
  await nextTurn(); assert.equal(started.length, 1);
  assert.equal(jobs.get(first.id).progress.completed, 20); assert.equal(jobs.get(second.id).status, 'queued');
  releases.shift()(); await nextTurn(); assert.equal(started.length, 2);
  releases.shift()(); await jobs.running;
  assert.equal(jobs.get(first.id).status, 'completed'); assert.notEqual(started[0], started[1]);
  await jobs.close();
  const restarted = new JobManager(root, { render }); t.after(() => restarted.close());
  assert.equal(restarted.get(second.id).status, 'completed');
});

test('queued cancellation prevents execution and running cancellation waits for cleanup', async t => {
  const root = fixture(t); let cleaned = false, release;
  const jobs = new JobManager(root, { render: async (_root, _project, { signal }) => {
    await new Promise(resolve => { signal.addEventListener('abort', resolve, { once: true }); });
    await new Promise(resolve => { release = resolve; }); cleaned = true;
    throw new Error('cancelled');
  } }); t.after(() => jobs.close());
  const first = jobs.submit('examples/demo'), second = jobs.submit('examples/demo');
  assert.equal(jobs.cancel(second.id).status, 'cancelled');
  await nextTurn(); assert.equal(jobs.cancel(first.id).status, 'cancelling');
  await nextTurn(); assert.equal(cleaned, false); release(); await jobs.running;
  assert.equal(jobs.get(first.id).status, 'cancelled'); assert.equal(cleaned, true);
  assert.equal(jobs.cancel(first.id).status, 'cancelled');
});

test('job deadlines abort work and report a failure rather than user cancellation', async t => {
  const root = fixture(t);
  const jobs = new JobManager(root, { timeoutMs: 10, render: async (_root, _project, { signal }) => {
    await new Promise(resolve => { const hold = setTimeout(resolve, 1000); signal.addEventListener('abort', () => { clearTimeout(hold); resolve(); }, { once: true }); });
    throw new Error('stopped');
  } }); t.after(() => jobs.close());
  const job = jobs.submit('examples/demo'); await nextTurn(); await jobs.running;
  assert.equal(jobs.get(job.id).status, 'failed'); assert.equal(jobs.get(job.id).error.code, 'TIMEOUT');
});

test('restart marks unfinished persisted work interrupted and does not replay it', async t => {
  const root = fixture(t), jobs = new JobManager(root);
  const job = jobs.submit('examples/demo'); await jobs.close();
  const record = { ...jobs.get(job.id), status: 'running' };
  writeJson(path.join(root, 'out/.ona-motion/jobs', job.id + '.json'), record);
  const restarted = new JobManager(root, { render: () => { throw new Error('must not run'); } }); t.after(() => restarted.close());
  assert.equal(restarted.get(job.id).status, 'failed'); assert.equal(restarted.get(job.id).error.code, 'INTERRUPTED');
});

test('workspace ownership and record limits prevent conflicting execution', async t => {
  const root = fixture(t), jobs = new JobManager(root, { maxJobs: 1 }); t.after(() => jobs.close());
  assert.throws(() => new JobManager(root), { code: 'WORKSPACE_BUSY' });
  const job = jobs.submit('examples/demo'); jobs.cancel(job.id);
  assert.throws(() => jobs.submit('examples/demo'), { code: 'JOB_LIMIT' });
  assert.throws(() => jobs.get('../../outside'), { code: 'INVALID_ID' });
});
