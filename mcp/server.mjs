import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod/v4';
import { MotionError, createProject, inspectProject, loadProject, scopedPath, workspaceRoot } from '../lib/project.mjs';
import { checkEnvironment } from '../lib/environment.mjs';
import { renderFrames } from '../lib/render.mjs';
import { JobManager } from './jobs.mjs';
import { ArtifactStore, MAX_INLINE_BYTES, link } from './artifacts.mjs';

const projectSchema = z.string().min(1).max(1024).describe('Project folder relative to the configured workspace, e.g. examples/hello.');
const idSchema = z.string().uuid();
const commonRender = { project: projectSchema, lang: z.string().regex(/^[a-zA-Z0-9_-]{1,20}$/).optional(), subframes: z.number().int().min(1).max(64).optional() };
const outputSchema = {
  ok: z.boolean(), result: z.record(z.string(), z.unknown()).optional(),
  error: z.object({ code: z.string(), message: z.string(), details: z.record(z.string(), z.unknown()).optional() }).optional(),
};
const GUIDE = `ona-motion turns scene.js + project.json into deterministic frames and videos.
Use check_environment first. Create or inspect a project, then edit its scene.js using your client's filesystem tools.
Use render_frames to inspect a contact sheet or selected stills before exporting.
Run the project's sound.py locally to generate out/audio.wav if sound is wanted.
render_video returns a durable job ID immediately; poll get_job until completed, failed or cancelled.
Use cancel_job to stop a queued or running export. Use list_jobs to rediscover recent jobs after reconnecting.
Artifacts are local files and MCP resources. Large files can be opened using the returned local path.
Only trusted local projects should be rendered: their scene code runs in the browser and may access the network.
One server owns the configured workspace at a time. Jobs run sequentially; stopped jobs are not resumed automatically.`;

export function createMotionServer(workspace) {
  const root = workspaceRoot(workspace);
  const version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  const server = new McpServer({ name: 'ona-motion', version }, { instructions: GUIDE });
  const jobs = new JobManager(root);
  let artifacts;
  try { artifacts = new ArtifactStore(root, jobs); } catch (error) { jobs.releaseLock(); throw error; }
  const calls = new Set(); let shuttingDown = false, closing;
  function tool(name, description, inputSchema, readOnlyHint, handler) {
    server.registerTool(name, { description, inputSchema: z.object(inputSchema).strict(), outputSchema,
      annotations: { readOnlyHint, destructiveHint: false, openWorldHint: ['render_frames', 'render_video'].includes(name), idempotentHint: readOnlyHint } }, async (args, extra) => {
      try {
        if (shuttingDown) throw new MotionError('SERVER_STOPPING', 'The server is shutting down.');
        const { result, content = [] } = await handler(args, extra);
        const structuredContent = { ok: true, result };
        return { structuredContent, content: [{ type: 'text', text: JSON.stringify(structuredContent) }, ...content] };
      } catch (error) {
        const structuredContent = { ok: false, error: { code: error.code ?? 'OPERATION_FAILED', message: error.message, details: error.details ?? {} } };
        return { isError: true, structuredContent, content: [{ type: 'text', text: JSON.stringify(structuredContent) }] };
      }
    });
  }
  tool('check_environment', 'Check the configured workspace, browser, Node dependencies, fonts, ffmpeg and Python audio prerequisites. Does not install anything.', {}, true,
    async () => ({ result: await checkEnvironment(root) }));
  tool('create_project', 'Create examples/<name> from the blank template. Refuses to overwrite an existing project. Edit scene.js afterward using local filesystem tools.', {
    name: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/i),
    width: z.number().int().min(2).max(8192).optional(), height: z.number().int().min(2).max(8192).optional(),
    fps: z.number().int().min(1).max(240).optional(), duration: z.number().positive().max(3600).optional(),
    bpm: z.number().positive().max(1000).optional(), speed: z.number().positive().max(10).optional(),
  }, false, async ({ name, ...config }) => ({ result: createProject(root, name, config) }));
  tool('inspect_project', 'Read project configuration, timing, font availability, scene and soundtrack presence. Reports invalid configurations as structured errors.', { project: projectSchema }, true,
    async ({ project }) => ({ result: inspectProject(root, project) }));
  tool('render_frames', 'Render up to 12 stills or an evenly spaced contact sheet. Returns PNG image content for visual inspection and resource links to full artifacts. Frame times are playback seconds. Writes unique output files; requires a browser and installed project dependencies.', {
    ...commonRender, frames: z.array(z.number().int().nonnegative()).min(1).max(12).optional(),
    times: z.array(z.number().nonnegative()).min(1).max(12).optional(), count: z.number().int().min(1).max(12).default(12), sheet: z.boolean().default(true),
  }, false, async (args, extra) => {
    if (calls.size) throw new MotionError('RENDER_BUSY', 'Another frame request is running. Wait for it or cancel that request.');
    const p = loadProject(root, args.project), id = randomUUID();
    const outputDir = scopedPath(root, path.join(p.out, 'mcp', 'frames', id));
    const controller = new AbortController(), abort = () => controller.abort();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; abort(); }, 120000); timer.unref();
    extra.signal.addEventListener('abort', abort, { once: true });
    if (extra.signal.aborted) abort();
    let done;
    const finished = new Promise(resolve => { done = resolve; });
    const call = { controller, finished }; calls.add(call);
    try {
      let lastProgress = 0;
      const rendered = await renderFrames(root, args.project, { ...args, imagePreview: true, outputDir, sheetPath: path.join(outputDir, 'sheet.png'), signal: controller.signal,
        onProgress: ({ completed, total }) => {
          if (extra._meta?.progressToken !== undefined && (completed === total || Date.now() - lastProgress >= 1000)) {
            lastProgress = Date.now();
            void extra.sendNotification({ method: 'notifications/progress', params: { progressToken: extra._meta.progressToken, progress: completed, total } }).catch(() => {});
          }
        } });
      const manifest = artifacts.saveFrames(id, rendered);
      const content = [], entries = rendered.sheet ? [rendered.sheet, ...rendered.frames] : rendered.frames;
      let inlineBytes = 0;
      for (const entry of entries) {
        const uri = `ona-motion://frames/${id}/${path.basename(entry.path)}`;
        content.push(link(uri, entry.path, 'image/png'));
        const imageBuffer = entry.previewBuffer ?? entry.buffer;
        // With a sheet, embed that one overview; every full-size still remains available as a resource.
        if ((!rendered.sheet || entry === rendered.sheet) && inlineBytes + Math.ceil(imageBuffer.length * 4 / 3) <= MAX_INLINE_BYTES) {
          content.push({ type: 'image', data: imageBuffer.toString('base64'), mimeType: 'image/png' });
          inlineBytes += Math.ceil(imageBuffer.length * 4 / 3);
        }
      }
      const result = { ...manifest, frames: manifest.frames.map(frame => ({ ...frame, uri: `ona-motion://frames/${id}/${path.basename(frame.path)}` })),
        ...(manifest.sheet ? { sheet: { ...manifest.sheet, uri: `ona-motion://frames/${id}/sheet.png` } } : {}),
        inlineImages: content.filter(c => c.type === 'image').length };
      return { result, content };
    } catch (error) {
      if (timedOut) throw new MotionError('TIMEOUT', 'Frame rendering exceeded the two-minute deadline. Reduce frame count or subframes.');
      if (controller.signal.aborted) throw new MotionError('CANCELLED', 'Frame rendering was cancelled.');
      throw error;
    } finally { clearTimeout(timer); extra.signal.removeEventListener('abort', abort); calls.delete(call); done(); }
  });
  function jobResult(job) {
    if (job.status !== 'completed') return { result: job };
    const filename = artifacts.video(job.id), uri = `ona-motion://jobs/${job.id}/video`;
    return { result: { ...job, artifact: { uri, path: filename, mimeType: 'video/mp4', bytes: fs.statSync(filename).size } }, content: [link(uri, filename, 'video/mp4')] };
  }
  tool('render_video', 'Queue a video export and immediately return a durable job ID. Poll get_job for progress and output. Uses out/audio.wav if present; otherwise exports silently. One export runs at a time, with a 30-minute deadline.', {
    ...commonRender, crf: z.number().int().min(0).max(51).default(16),
  }, false, async ({ project, ...options }) => ({ result: jobs.submit(project, options) }));
  tool('get_job', 'Read current render state and frame progress. Completed jobs include a video resource and local file path. Terminal states: completed, failed, cancelled.', { jobId: idSchema }, true,
    async ({ jobId }) => jobResult(jobs.get(jobId)));
  tool('list_jobs', 'List the most recent render jobs in this workspace, including jobs recovered after a server restart. Returns up to 20 records.', { limit: z.number().int().min(1).max(20).default(10) }, true,
    async ({ limit }) => ({ result: { jobs: jobs.list(limit) } }));
  tool('cancel_job', 'Cancel a queued or running video export. Running jobs report cancelling until renderer cleanup completes. Cancelling a terminal job preserves its state.', { jobId: idSchema }, false,
    async ({ jobId }) => ({ result: jobs.cancel(jobId) }));

  server.registerResource('workflow', 'ona-motion://guide', { mimeType: 'text/plain', description: 'Project, inspection and rendering workflow.' },
    async uri => ({ contents: [{ uri: String(uri), mimeType: 'text/plain', text: GUIDE }] }));
  server.registerResource('frame-artifacts', new ResourceTemplate('ona-motion://frames/{renderId}/{filename}', { list: undefined }), { mimeType: 'image/png' },
    async (uri, { renderId, filename }) => artifacts.read(uri, artifacts.frame(String(renderId), String(filename)), 'image/png'));
  server.registerResource('video-artifacts', new ResourceTemplate('ona-motion://jobs/{jobId}/video', { list: undefined }), { mimeType: 'video/mp4' },
    async (uri, { jobId }) => artifacts.read(uri, artifacts.video(String(jobId)), 'video/mp4'));
  const close = () => closing ??= (async () => {
    shuttingDown = true;
    for (const call of calls) call.controller.abort();
    await Promise.all([...calls].map(call => call.finished));
    await jobs.close(); await server.close();
  })();
  return { server, jobs, close, connect: () => server.connect(new StdioServerTransport()) };
}
