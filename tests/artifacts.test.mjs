import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_WORKSPACE, createProject } from '../lib/project.mjs';
import { ArtifactStore, MAX_RESOURCE_BYTES } from '../mcp/artifacts.mjs';

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ona-motion-artifacts-')));
  fs.mkdirSync(path.join(root, 'engine')); fs.writeFileSync(path.join(root, 'engine/player.html'), '');
  fs.mkdirSync(path.join(root, 'examples'));
  fs.cpSync(path.join(DEFAULT_WORKSPACE, 'templates'), path.join(root, 'templates'), { recursive: true });
  createProject(root, 'demo');
  const store = new ArtifactStore(fs.realpathSync(root), { get: () => ({ status: 'running' }) });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, store };
}

test('artifact manifests survive a restart and only expose files from their render directory', t => {
  const { root, store } = fixture(t), id = randomUUID();
  const dir = path.join(root, 'examples/demo/out/mcp/frames', id);
  fs.mkdirSync(dir, { recursive: true });
  const filename = path.join(dir, 'f00000.png'); fs.writeFileSync(filename, 'png');
  store.saveFrames(id, { project: 'examples/demo', frames: [{ frame: 0, time: 0, path: filename }] });
  const restarted = new ArtifactStore(fs.realpathSync(root), store.jobs);
  assert.equal(restarted.frame(id, 'f00000.png'), filename);
  assert.equal(restarted.read('ona-motion://test', filename, 'image/png').contents[0].blob, Buffer.from('png').toString('base64'));
  assert.throws(() => restarted.frame(id, '../../project.json'), { code: 'ARTIFACT_NOT_FOUND' });
  const other = path.join(root, 'private.png'); fs.writeFileSync(other, 'not an artifact');
  store.saveFrames(id, { project: 'examples/demo', frames: [{ path: other }] });
  assert.throws(() => store.frame(id, 'private.png'), { code: 'INVALID_ARTIFACT_PATH' });
});

test('symlinks cannot redirect artifacts to other workspace files', t => {
  const { root, store } = fixture(t), id = randomUUID(), dir = path.join(root, 'examples/demo/out/mcp/frames', id);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(root, 'secret.png'); fs.writeFileSync(target, 'private');
  const filename = path.join(dir, 'f00000.png'); fs.symlinkSync(target, filename);
  store.saveFrames(id, { project: 'examples/demo', frames: [{ path: filename }] });
  assert.throws(() => store.frame(id, 'f00000.png'), { code: 'INVALID_ARTIFACT_PATH' });
});

test('large resources require opening the local artifact and unfinished videos are unavailable', t => {
  const { root, store } = fixture(t), filename = path.join(root, 'large.mp4');
  const fd = fs.openSync(filename, 'w'); fs.ftruncateSync(fd, MAX_RESOURCE_BYTES + 1); fs.closeSync(fd);
  assert.throws(() => store.read('ona-motion://test', filename, 'video/mp4'), { code: 'ARTIFACT_TOO_LARGE' });
  assert.throws(() => store.video(randomUUID()), { code: 'ARTIFACT_NOT_READY' });
});
