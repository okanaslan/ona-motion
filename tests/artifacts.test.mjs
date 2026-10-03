import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_WORKSPACE, createProject } from '../lib/project.mjs';
import { ArtifactStore, MAX_RESOURCE_BYTES, MAX_INLINE_BYTES, imageInspection } from '../mcp/artifacts.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGScAAAAASUVORK5CYII=', 'base64');

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

test('saved original images return native image content with exact dimensions after restart', t => {
  const { root, store } = fixture(t), id = randomUUID(), dir = path.join(root, 'examples/demo/out/mcp/frames', id);
  fs.mkdirSync(dir, { recursive: true });
  const filename = path.join(dir, 'f00000.png'); fs.writeFileSync(filename, PNG);
  store.saveFrames(id, { project: 'examples/demo', frames: [{ frame: 0, time: 0, path: filename }] });
  const restarted = new ArtifactStore(root, store.jobs), uri = `ona-motion://frames/${id}/f00000.png`;
  const { result, content } = restarted.get(uri);
  assert.deepEqual(result.image, { original: { width: 1, height: 1 }, displayed: { width: 1, height: 1 }, resized: false });
  assert.equal(content[1].type, 'image'); assert.equal(content[1].mimeType, 'image/png');
  assert.deepEqual(Buffer.from(content[1].data, 'base64'), PNG);
  assert.equal(restarted.read(uri, filename, 'image/png').contents[0].blob, content[1].data);
  assert.throws(() => restarted.get(`ona-motion://frames/${id}/../project.json`), { code: 'INVALID_ARTIFACT_URI' });
  assert.throws(() => restarted.get(`ona-motion://frames/${id}/f00000.png?secret=1`), { code: 'INVALID_ARTIFACT_URI' });
  assert.throws(() => restarted.get(`ona-motion://frames/${id}/missing.png`), { code: 'ARTIFACT_NOT_FOUND' });
  const fd = fs.openSync(filename, 'w'); fs.ftruncateSync(fd, Math.floor(MAX_INLINE_BYTES * 3 / 4) + 1); fs.closeSync(fd);
  assert.throws(() => restarted.get(uri), { code: 'ARTIFACT_TOO_LARGE' });
});

test('inspection metadata distinguishes resized previews and rejects invalid PNG headers', () => {
  const original = Buffer.from(PNG), preview = Buffer.from(PNG);
  original.writeUInt32BE(1080, 16); original.writeUInt32BE(1080, 20);
  preview.writeUInt32BE(1024, 16); preview.writeUInt32BE(1024, 20);
  assert.deepEqual(imageInspection(original, preview), { original: { width: 1080, height: 1080 }, displayed: { width: 1024, height: 1024 }, resized: true });
  assert.throws(() => imageInspection(Buffer.from('not png')), { code: 'INVALID_IMAGE' });
});
