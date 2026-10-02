import fs from 'node:fs';
import path from 'node:path';
import { MotionError, scopedPath, workspaceRoot } from './project.mjs';

export const MEDIA_CONFIG = '.ona-motion.local.json';
export function mediaTool(workspace, name) {
  if (!['ffmpeg', 'ffprobe'].includes(name)) throw new MotionError('INVALID_MEDIA_TOOL', 'Choose ffmpeg or ffprobe.');
  const root = workspaceRoot(workspace), override = process.env[name === 'ffmpeg' ? 'FFMPEG_PATH' : 'FFPROBE_PATH'];
  if (override) return { command: override, source: 'environment' };
  const filename = scopedPath(root, MEDIA_CONFIG);
  if (fs.existsSync(filename)) {
    let config;
    try { config = JSON.parse(fs.readFileSync(filename, 'utf8')); }
    catch { throw new MotionError('INVALID_MEDIA_CONFIG', `Cannot parse ${MEDIA_CONFIG}.`); }
    if (!config || typeof config !== 'object' || Array.isArray(config) || Object.keys(config).some(key => !['ffmpeg', 'ffprobe'].includes(key)) || Object.values(config).some(value => typeof value !== 'string' || !value.trim())) {
      throw new MotionError('INVALID_MEDIA_CONFIG', `${MEDIA_CONFIG} must contain ffmpeg/ffprobe executable paths.`);
    }
    if (config[name]) return { command: path.resolve(root, config[name]), source: 'workspace' };
  }
  return { command: name, source: 'PATH' };
}
