import fs from 'node:fs';
import path from 'node:path';
import { MotionError, loadProject, scopedPath, within } from '../lib/project.mjs';
import { validId, writeJson } from './jobs.mjs';

export const MAX_INLINE_BYTES = 6 * 1024 * 1024;
// Base64 expands binary data: keep resource messages below the SDK's 10 MiB stdio buffer.
export const MAX_RESOURCE_BYTES = 6 * 1024 * 1024;
export function pngDimensions(buffer) {
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || buffer.subarray(12, 16).toString() !== 'IHDR') {
    throw new MotionError('INVALID_IMAGE', 'The registered artifact is not a PNG image.');
  }
  const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
  if (!width || !height) throw new MotionError('INVALID_IMAGE', 'PNG dimensions must be positive.');
  return { width, height };
}
export function imageInspection(original, displayed = original) {
  const originalDimensions = pngDimensions(original), displayedDimensions = pngDimensions(displayed);
  return { original: originalDimensions, displayed: displayedDimensions,
    resized: originalDimensions.width !== displayedDimensions.width || originalDimensions.height !== displayedDimensions.height };
}
export class ArtifactStore {
  constructor(root, jobs) {
    this.root = root; this.jobs = jobs;
    this.downloadBaseUrl = null;
    this.dir = scopedPath(root, 'out/.ona-motion/frames'); fs.mkdirSync(this.dir, { recursive: true });
  }
  downloads(uri) {
    return this.downloadBaseUrl ? { downloadUrl: new URL(`/artifacts/${uri.slice('ona-motion://'.length)}`, this.downloadBaseUrl).href } : {};
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
  resolve(uri) {
    let match, filename, mimeType;
    if ((match = /^ona-motion:\/\/frames\/([^/]+)\/([a-zA-Z0-9_-][a-zA-Z0-9_.-]*\.png)$/.exec(uri))) {
      filename = this.frame(match[1], match[2]); mimeType = 'image/png';
    } else if ((match = /^ona-motion:\/\/jobs\/([^/]+)\/video$/.exec(uri))) {
      filename = this.video(match[1]); mimeType = 'video/mp4';
    } else throw new MotionError('INVALID_ARTIFACT_URI', 'Choose a returned ona-motion frame or completed video artifact URI.');
    return { uri, path: filename, name: path.basename(filename), mimeType, bytes: fs.statSync(filename).size, ...this.downloads(uri) };
  }
  get(uri) {
    const result = this.resolve(uri);
    const content = [link(uri, result.path, result.mimeType)];
    if (result.mimeType === 'image/png') {
      // The limit includes base64 expansion, as it does for render tool responses.
      if (Math.ceil(result.bytes * 4 / 3) > MAX_INLINE_BYTES) {
        throw new MotionError('ARTIFACT_TOO_LARGE', 'Original PNG exceeds the MCP image-content limit. Use its download URL when HTTP hosting is available.', { uri, bytes: result.bytes, maxInlineBytes: MAX_INLINE_BYTES, ...this.downloads(uri) });
      }
      const buffer = fs.readFileSync(result.path);
      result.image = imageInspection(buffer);
      content.push({ type: 'image', data: buffer.toString('base64'), mimeType: 'image/png' });
    }
    return { result, content };
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
    if (!fs.statSync(candidate).isFile()) throw new MotionError('INVALID_ARTIFACT_PATH', 'Artifact must be a regular file.');
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
