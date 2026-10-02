import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_WORKSPACE, createProject, inspectProject, scopedPath } from '../lib/project.mjs';
import { selectFrames } from '../lib/render.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ona-motion-project-'));
  fs.mkdirSync(path.join(root, 'engine')); fs.writeFileSync(path.join(root, 'engine/player.html'), '');
  fs.mkdirSync(path.join(root, 'examples'));
  fs.cpSync(path.join(DEFAULT_WORKSPACE, 'templates'), path.join(root, 'templates'), { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return fs.realpathSync(root);
}

test('scaffolding uses the template, honors timing and refuses to replace a project', t => {
  const root = fixture(t);
  const p = createProject(root, 'demo', { duration: 20, fps: 30, speed: 0.75 });
  assert.equal(p.frames, 600); assert.equal(p.sceneDuration, 15); assert.equal(p.playbackDuration, 20);
  assert.ok(fs.existsSync(path.join(root, 'examples/demo/scene.js')));
  assert.throws(() => createProject(root, 'demo'), { code: 'PROJECT_EXISTS' });
  assert.throws(() => createProject(root, '../escape'), { code: 'INVALID_NAME' });
});

test('invalid configuration fails before creating a project', t => {
  const root = fixture(t);
  assert.throws(() => createProject(root, 'invalid', { fps: 0 }), { code: 'INVALID_PROJECT' });
  assert.equal(fs.existsSync(path.join(root, 'examples/invalid')), false);
});

test('workspace containment rejects traversal, prefix siblings and external symlinks', t => {
  const root = fixture(t);
  assert.throws(() => scopedPath(root, '../escape'), { code: 'PATH_OUTSIDE_WORKSPACE' });
  assert.throws(() => scopedPath(root, root + '-sibling/file'), { code: 'PATH_OUTSIDE_WORKSPACE' });
  fs.symlinkSync(os.tmpdir(), path.join(root, 'external'));
  assert.throws(() => scopedPath(root, 'external/new-output/file.png'), { code: 'PATH_OUTSIDE_WORKSPACE' });
  fs.symlinkSync(path.join(os.tmpdir(), 'ona-motion-missing-' + process.pid), path.join(root, 'dangling'));
  assert.throws(() => scopedPath(root, 'dangling'), { code: 'PATH_OUTSIDE_WORKSPACE' });
});

test('inspection reports missing fonts and rejects escaping scene paths', t => {
  const root = fixture(t);
  const p = createProject(root, 'demo');
  assert.ok(p.warnings.length > 0);
  const configPath = path.join(root, 'examples/demo/project.json');
  fs.writeFileSync(configPath, JSON.stringify({ ...p.config, scene: '../../outside.js' }));
  assert.throws(() => inspectProject(root, 'examples/demo'), { code: 'INVALID_PROJECT' });
});

test('frame selection uses playback seconds and checks boundaries and limits', () => {
  const p = { fps: 60, frames: 900, cfg: { duration: 15 } };
  assert.deepEqual(selectFrames(p, { times: [0, 1.5, 14.9] }), [0, 90, 894]);
  assert.deepEqual(selectFrames(p, { count: 3 }), [150, 450, 750]);
  for (const options of [{ frames: [-1] }, { frames: [900] }, { times: [-0.001] }, { times: [15] }, { count: 0 }, { count: 100000 }, { times: [1], frames: [60] }]) {
    assert.throws(() => selectFrames(p, options), { code: 'INVALID_FRAMES' });
  }
});
