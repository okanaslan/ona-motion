import fs from 'node:fs';
import path from 'node:path';
import { MotionError, loadProject, scopedPath, within } from '../lib/project.mjs';
import { validId, writeJson } from './jobs.mjs';

export const MAX_INLINE_BYTES = 6 * 1024 * 1024;
// Base64 expands binary data: keep resource messages below the SDK's 10 MiB stdio buffer.
export const MAX_RESOURCE_BYTES = 6 * 1024 * 1024;
export class ArtifactStore {
  constructor(root, jobs) {
    this.root = root; this.jobs = jobs;
    this.dir = scopedPath(root, 'out/.ona-motion/frames'); fs.mkdirSync(this.dir, { recursive: true });
  }
  saveFrames(id, result) {
    const manifest = { id, project: result.project, ...(result.source ? { source: result.source } : {}), frames: result.frames.map(({ frame, time, requestedTime, path: file }) => ({ frame, time, ...(requestedTime !== undefined ? { requestedTime } : {}), path: file })), ...(result.sheet ? { sheet: { path: result.sheet.path } } : {}) };
    writeJson(scopedPath(this.root, path.join(this.dir, `${validId(id)}.json`)), manifest);
    return manifest;
  }
  frame(id, filename) {
    const manifestPath = scopedPath(this.root, path.join(this.dir, `${validId(id)}.json`));
    if (!fs.existsSync(manifestPath)) throw new MotionError('ARTIFACT_NOT_FOUND', 'No frame render with this ID exists.');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const files = [...manifest.frames, ...(manifest.sheet ? [manifest.sheet] : [])];
    const artifact = files.find(f => path.basename(f.path) === filename);
    if (!artifact) throw new MotionError('ARTIFACT_NOT_FOUND', 'No matching frame artifact exists.');
    const p = loadProject(this.root, manifest.project);
    return this.checkedFile(artifact.path, path.join(p.out, 'mcp', 'frames', id));
  }
  video(id) {
    const job = this.jobs.get(id);
    if (job.status !== 'completed' || !job.result) throw new MotionError('ARTIFACT_NOT_READY', 'The video is available after the job completes.');
    const p = loadProject(this.root, job.project);
    return this.checkedFile(job.result.path, path.join(p.out, 'mcp', 'jobs', id));
  }
  videoTarget({ jobId, project, video }) {
    if (jobId && project === undefined && video === undefined) {
      const job = this.jobs.get(jobId);
      return { project: job.project, path: this.video(jobId), jobId };
    }
    if (jobId || !project || !video || path.isAbsolute(video) || video.split(/[\\/]/).includes('..') || !video.toLowerCase().endsWith('.mp4')) throw new MotionError('INVALID_VIDEO_REFERENCE', 'Provide jobId alone, or project plus an MP4 path relative to its out/ folder.');
    const p = loadProject(this.root, project), filename = this.checkedFile(path.join(p.out, video), p.out);
    if (!fs.statSync(filename).isFile()) throw new MotionError('INVALID_VIDEO_REFERENCE', 'Choose a regular MP4 file in the project output folder.');
    return { project: p.relative, path: filename };
  }
  checkedFile(filename, directory) {
    const candidate = scopedPath(this.root, filename), allowed = scopedPath(this.root, directory);
    if (!within(allowed, candidate) || !within(fs.realpathSync(allowed), fs.realpathSync(candidate))) throw new MotionError('INVALID_ARTIFACT_PATH', 'Artifact must remain in its render output directory.');
    return candidate;
  }
  read(uri, filename, mimeType) {
    const bytes = fs.statSync(filename).size;
    if (bytes > MAX_RESOURCE_BYTES) throw new MotionError('ARTIFACT_TOO_LARGE', `Artifact is ${bytes} bytes. Open the local file at ${filename}; MCP reads are limited to ${MAX_RESOURCE_BYTES} bytes.`);
    return { contents: [{ uri: String(uri), mimeType, blob: fs.readFileSync(filename).toString('base64') }] };
  }
}
export function link(uri, filename, mimeType) {
  return { type: 'resource_link', uri, name: path.basename(filename), mimeType, size: fs.statSync(filename).size };
}
