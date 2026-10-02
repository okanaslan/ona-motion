import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const DEFAULT_WORKSPACE = fileURLToPath(new URL('../', import.meta.url));
export class MotionError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'MotionError'; this.code = code; this.details = details; }
}
export function within(root, candidate) {
  const rel = path.relative(root, candidate);
  return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`));
}
export function workspaceRoot(workspace = DEFAULT_WORKSPACE) {
  const root = fs.realpathSync(workspace);
  if (!fs.existsSync(path.join(root, 'engine/player.html')) || !fs.existsSync(path.join(root, 'templates/blank/project.json'))) {
    throw new MotionError('INVALID_WORKSPACE', 'Workspace must be an ona-motion checkout with engine/ and templates/.');
  }
  return root;
}
// Check ancestors too: symlinks must not redirect new outputs outside the workspace.
export function scopedPath(root, input) {
  const candidate = path.resolve(root, input);
  if (!within(root, candidate)) throw new MotionError('PATH_OUTSIDE_WORKSPACE', 'Path must stay inside the configured workspace.');
  let ancestor = candidate;
  for (;;) {
    try { fs.lstatSync(ancestor); break; }
    catch (error) { if (error.code !== 'ENOENT') throw error; ancestor = path.dirname(ancestor); }
  }
  let real;
  try { real = fs.realpathSync(ancestor); }
  catch { throw new MotionError('PATH_OUTSIDE_WORKSPACE', 'Path contains a dangling or invalid symlink.'); }
  if (!within(root, real)) throw new MotionError('PATH_OUTSIDE_WORKSPACE', 'Symlink points outside the configured workspace.');
  return candidate;
}
export function validateConfig(cfg) {
  const problems = [];
  for (const key of ['width', 'height', 'duration']) if (!Number.isFinite(cfg[key]) || cfg[key] <= 0) problems.push(`${key} must be a positive number`);
  for (const key of ['width', 'height']) if (!Number.isInteger(cfg[key]) || cfg[key] > 8192) problems.push(`${key} must be an integer no greater than 8192`);
  for (const [key, fallback] of [['fps', 60], ['bpm', 160], ['speed', 1], ['subframes', 6]]) {
    if (!Number.isFinite(cfg[key] ?? fallback) || (cfg[key] ?? fallback) <= 0) problems.push(`${key} must be a positive number`);
  }
  if (!Number.isInteger(cfg.fps ?? 60) || (cfg.fps ?? 60) > 240) problems.push('fps must be an integer from 1 to 240');
  if (!Number.isInteger(cfg.subframes ?? 6) || (cfg.subframes ?? 6) > 64) problems.push('subframes must be an integer from 1 to 64');
  if (Math.round(cfg.duration * (cfg.fps ?? 60)) < 1) problems.push('duration must include at least one frame');
  if (cfg.fonts !== undefined && (typeof cfg.fonts !== 'object' || cfg.fonts === null || Array.isArray(cfg.fonts))) problems.push('fonts must be an object');
  for (const key of ['css', 'preload']) if (cfg.fonts?.[key] !== undefined && (!Array.isArray(cfg.fonts[key]) || cfg.fonts[key].some(s => typeof s !== 'string'))) problems.push(`fonts.${key} must be an array of strings`);
  for (const key of ['scene', 'audio']) if (cfg[key] !== undefined && (typeof cfg[key] !== 'string' || !cfg[key] || path.isAbsolute(cfg[key]) || cfg[key].split(/[\\/]/).includes('..'))) problems.push(`${key} must be a relative path inside the project`);
  return problems;
}
export function loadProject(workspace, project) {
  const root = workspaceRoot(workspace), dir = scopedPath(root, project);
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(scopedPath(root, path.join(dir, 'project.json')), 'utf8')); }
  catch (error) { throw new MotionError('INVALID_PROJECT', `Cannot read ${project}/project.json: ${error.message}`); }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new MotionError('INVALID_PROJECT', 'project.json must contain an object.');
  const problems = validateConfig(cfg);
  if (problems.length) throw new MotionError('INVALID_PROJECT', problems.join('; '), { problems });
  const scene = scopedPath(root, path.join(dir, cfg.scene ?? 'scene.js'));
  if (!fs.existsSync(scene)) throw new MotionError('MISSING_SCENE', `Scene file not found: ${cfg.scene ?? 'scene.js'}`);
  const fps = cfg.fps ?? 60;
  return { root, dir, cfg, scene, fps, frames: Math.round(cfg.duration * fps), out: scopedPath(root, path.join(dir, 'out')), relative: path.relative(root, dir).split(path.sep).join('/') };
}
export function inspectProject(workspace, project) {
  const p = loadProject(workspace, project);
  const fonts = (p.cfg.fonts?.css ?? []).map(file => ({ file, available: fs.existsSync(scopedPath(p.root, file.startsWith('@') ? path.join('node_modules', file) : path.join(p.dir, file))) }));
  return { project: p.relative, config: p.cfg, configRevision: createHash('sha256').update(fs.readFileSync(scopedPath(p.root, path.join(p.dir, 'project.json')))).digest('hex'), frames: p.frames, sceneDuration: p.cfg.duration * (p.cfg.speed ?? 1), playbackDuration: p.cfg.duration,
    fonts, soundScript: fs.existsSync(path.join(p.dir, 'sound.py')), audioAvailable: fs.existsSync(scopedPath(p.root, path.join(p.out, p.cfg.audio ?? 'audio.wav'))),
    warnings: fonts.filter(f => !f.available).map(f => `Missing font CSS: ${f.file}`) };
}
export function createProject(workspace, name, config = {}) {
  const root = workspaceRoot(workspace);
  if (!/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(name)) throw new MotionError('INVALID_NAME', 'Use letters, digits, hyphens or underscores (1–80 characters).');
  const destination = scopedPath(root, path.join('examples', name));
  if (fs.existsSync(destination)) throw new MotionError('PROJECT_EXISTS', `examples/${name} already exists.`);
  const template = scopedPath(root, 'templates/blank');
  const cfg = { ...JSON.parse(fs.readFileSync(path.join(template, 'project.json'), 'utf8')), ...config, name };
  const problems = validateConfig(cfg);
  if (problems.length) throw new MotionError('INVALID_PROJECT', problems.join('; '));
  fs.mkdirSync(destination, { recursive: false }); fs.cpSync(template, destination, { recursive: true });
  fs.writeFileSync(path.join(destination, 'project.json'), `${JSON.stringify(cfg, null, 2)}\n`);
  return inspectProject(root, path.relative(root, destination));
}
