import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { MotionError, inspectProject, loadProject, scopedPath, validateConfig, within } from './project.mjs';

export const MAX_SCENE_BYTES = 256 * 1024;
export const revision = bytes => createHash('sha256').update(bytes).digest('hex');
function projectFile(p, filename) {
  const file = scopedPath(p.root, filename);
  if (!within(fs.realpathSync(p.dir), fs.realpathSync(file))) throw new MotionError('INVALID_AUTHORING_PATH', 'Authoring files must remain inside their own project.');
  return file;
}
export function readScene(workspace, project) {
  const p = loadProject(workspace, project), file = projectFile(p, p.scene);
  if (fs.statSync(file).size > MAX_SCENE_BYTES) throw new MotionError('SCENE_TOO_LARGE', `Scene source is limited to ${MAX_SCENE_BYTES} bytes.`);
  const bytes = fs.readFileSync(file);
  return { project: p.relative, source: bytes.toString('utf8'), revision: revision(bytes), scene: path.relative(p.dir, file).split(path.sep).join('/') };
}
function checkRevision(file, expectedRevision) {
  const currentRevision = revision(fs.readFileSync(file));
  if (currentRevision !== expectedRevision) throw new MotionError('REVISION_CONFLICT', 'The file changed. Read it again and reconcile your changes before retrying.', { currentRevision });
}
function replaceFile(file, source) {
  const temp = file + `.${randomUUID()}.tmp`;
  try { fs.writeFileSync(temp, source, { flag: 'wx' }); fs.renameSync(temp, file); }
  finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
// Parse as an ES module without importing or executing user code.
function checkSyntax(source, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '--check'], { stdio: ['pipe', 'ignore', 'pipe'], timeout: 10000, signal });
    let stderr = '';
    child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-4000); });
    child.stdin.on('error', () => {});
    child.once('error', error => reject(new MotionError(signal?.aborted ? 'CANCELLED' : 'SYNTAX_CHECK_FAILED', error.message)));
    child.once('close', code => code === 0 ? resolve() : reject(new MotionError('INVALID_SCENE_SYNTAX', stderr || 'Scene syntax check failed.')));
    child.stdin.end(source);
  });
}
export async function updateScene(workspace, project, { source, expectedRevision, signal, beforeWrite = () => {} }) {
  if (typeof source !== 'string' || !source.trim() || Buffer.byteLength(source) > MAX_SCENE_BYTES) throw new MotionError('INVALID_SCENE', `Provide non-empty scene source up to ${MAX_SCENE_BYTES} bytes.`);
  let p = loadProject(workspace, project), file = projectFile(p, p.scene);
  checkRevision(file, expectedRevision);
  await checkSyntax(source, signal);
  if (signal?.aborted) throw new MotionError('CANCELLED', 'Scene update was cancelled.');
  // Recheck after the asynchronous parser: another request may have edited or started rendering.
  p = loadProject(workspace, project); file = projectFile(p, p.scene);
  beforeWrite(p.relative); checkRevision(file, expectedRevision);
  replaceFile(file, source);
  return { ...readScene(workspace, project), validation: 'syntax-only; preview frames to check imports and draw behavior' };
}
const CONFIG_KEYS = new Set(['width', 'height', 'fps', 'duration', 'bpm', 'speed', 'subframes', 'fonts']);
export function updateProject(workspace, project, { config, expectedRevision, beforeWrite = () => {} }) {
  const p = loadProject(workspace, project), file = projectFile(p, path.join(p.dir, 'project.json'));
  if (!config || Array.isArray(config) || typeof config !== 'object' || !Object.keys(config).length || Object.keys(config).some(key => !CONFIG_KEYS.has(key))) throw new MotionError('INVALID_CONFIG_UPDATE', 'Update timing, size, subframes or fonts; scene/audio paths and project identity cannot be changed.');
  const next = { ...p.cfg, ...config }, problems = validateConfig(next);
  if (problems.length) throw new MotionError('INVALID_PROJECT', problems.join('; '), { problems });
  beforeWrite(p.relative); checkRevision(file, expectedRevision);
  replaceFile(file, `${JSON.stringify(next, null, 2)}\n`);
  return inspectProject(workspace, project);
}
