import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { MotionError, loadProject, scopedPath, within } from './project.mjs';
import { findChrome } from './environment.mjs';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const cancelled = () => new MotionError('CANCELLED', 'Rendering was cancelled.');

export async function openPreview(workspace, project, { lang, port = 0 } = {}) {
  const p = loadProject(workspace, project);
  const allowed = [path.join(p.root, 'engine'), path.join(p.root, 'node_modules'), p.dir];
  const server = http.createServer((req, res) => {
    try {
      const filename = scopedPath(p.root, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
      const real = fs.realpathSync(filename), relative = path.relative(p.root, real);
      if (relative.split(path.sep).some(s => s.startsWith('.')) || !allowed.some(dir => within(dir, real)) || !TYPES[path.extname(filename)] || !fs.statSync(real).isFile()) throw new Error('Not found');
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(filename)], 'Cache-Control': 'no-store' });
      const stream = fs.createReadStream(filename); stream.on('error', () => res.destroy()); stream.pipe(res);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const query = new URLSearchParams({ project: p.relative, ...(lang ? { lang } : {}) });
  const url = `http://127.0.0.1:${server.address().port}/engine/player.html?${query}`;
  return { ...p, url, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
}

async function renderSession(workspace, project, options) {
  if (options.signal?.aborted) throw cancelled();
  const chrome = findChrome();
  if (!chrome) throw new MotionError('MISSING_BROWSER', 'Chrome/Chromium/Edge not found. Set CHROME_PATH to its executable.');
  const preview = await openPreview(workspace, project, options);
  let browser, closing;
  const close = () => closing ??= (async () => { try { await browser?.close(); } finally { await preview.close(); } })();
  const abort = () => { void close().catch(() => {}); };
  try {
    let puppeteer;
    try { puppeteer = createRequire(path.join(preview.root, 'package.json'))('puppeteer-core'); } catch { throw new MotionError('MISSING_DEPENDENCY', 'Run npm install in the workspace first.'); }
    browser = await puppeteer.launch({ executablePath: chrome, headless: true, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
      args: ['--force-device-scale-factor=1', '--disable-gpu', '--enable-unsafe-swiftshader'] });
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) throw cancelled();
    const page = await browser.newPage();
    await page.setViewport({ width: preview.cfg.width, height: preview.cfg.height });
    let sceneError;
    page.on('pageerror', e => { sceneError = e.message; });
    await page.goto(preview.url + '&render=1', { timeout: 60000 });
    await page.waitForFunction('window.__ready || window.__error', { timeout: 60000 });
    const error = await page.evaluate(() => window.__error);
    if (error || sceneError) throw new MotionError('SCENE_ERROR', error ?? sceneError);
    const subframes = options.subframes ?? preview.cfg.subframes ?? 6;
    if (!Number.isInteger(subframes) || subframes < 1 || subframes > 64) throw new MotionError('INVALID_SUBFRAMES', 'subframes must be an integer from 1 to 64.');
    return { ...preview, page, close: async () => { options.signal?.removeEventListener('abort', abort); await close(); },
      grab: async frame => {
        if (options.signal?.aborted) throw cancelled();
        try {
          const data = await page.evaluate((f, s) => { window.renderFrame(f, s); return document.getElementById('c').toDataURL('image/png').split(',')[1]; }, frame, subframes);
          if (sceneError) throw new MotionError('SCENE_ERROR', sceneError);
          return Buffer.from(data, 'base64');
        } catch (error) {
          if (options.signal?.aborted) throw cancelled();
          throw new MotionError('SCENE_ERROR', error.message);
        }
      } };
  } catch (error) {
    options.signal?.removeEventListener('abort', abort); await close();
    if (options.signal?.aborted) throw cancelled();
    throw error;
  }
}

export function selectFrames(p, { frames, times, count = 12 } = {}) {
  if (frames && times) throw new MotionError('INVALID_FRAMES', 'Choose frames or times, not both.');
  if (times?.some(t => !Number.isFinite(t) || t < 0 || t >= p.cfg.duration)) throw new MotionError('INVALID_FRAMES', 'Times must be within the project playback duration.');
  if (!Number.isInteger(count) || count < 1 || count > 48) throw new MotionError('INVALID_FRAMES', 'count must be an integer from 1 to 48.');
  const selected = frames ?? times?.map(t => Math.round(t * p.fps)) ?? Array.from({ length: count }, (_, i) => Math.min(p.frames - 1, Math.floor((i + 0.5) * p.frames / count)));
  if (!selected.length || selected.length > 48 || selected.some(f => !Number.isInteger(f) || f < 0 || f >= p.frames)) throw new MotionError('INVALID_FRAMES', `Choose 1–48 frame indices between 0 and ${p.frames - 1}.`);
  return selected;
}

export async function renderFrames(workspace, project, options = {}) {
  const p = loadProject(workspace, project), selected = selectFrames(p, options);
  const output = scopedPath(p.root, options.outputDir ?? path.join(p.out, 'stills'));
  fs.mkdirSync(output, { recursive: true });
  const session = await renderSession(workspace, project, options);
  try {
    const preview = async buffer => Buffer.from(await session.page.evaluate(async data => {
      const bitmap = await createImageBitmap(await (await fetch('data:image/png;base64,' + data)).blob());
      const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
      return canvas.toDataURL('image/png').split(',')[1];
    }, buffer.toString('base64')), 'base64');
    const results = [];
    for (const frame of selected) {
      const buffer = await session.grab(frame), filename = path.join(output, `f${String(frame).padStart(5, '0')}.png`);
      fs.writeFileSync(filename, buffer); results.push({ frame, time: frame / p.fps, path: filename, buffer, ...(options.imagePreview && !options.sheet ? { previewBuffer: await preview(buffer) } : {}) });
      options.onProgress?.({ completed: results.length, total: selected.length });
    }
    let sheet;
    if (options.sheet) {
      const data = await session.page.evaluate(async (images, landscape) => {
        const cols = Math.min(images.length, landscape ? 4 : 6), rows = Math.ceil(images.length / cols), gap = 6, width = Math.floor(1600 / cols);
        const bitmaps = await Promise.all(images.map(async image => createImageBitmap(await (await fetch('data:image/png;base64,' + image)).blob())));
        const height = Math.round(width * bitmaps[0].height / bitmaps[0].width);
        const canvas = document.createElement('canvas'); canvas.width = cols * (width + gap) + gap; canvas.height = rows * (height + gap) + gap;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = '#444'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        bitmaps.forEach((bitmap, i) => { ctx.drawImage(bitmap, gap + (i % cols) * (width + gap), gap + Math.floor(i / cols) * (height + gap), width, height); bitmap.close(); });
        return canvas.toDataURL('image/png').split(',')[1];
      }, results.map(r => r.buffer.toString('base64')), p.cfg.width >= p.cfg.height);
      const filename = scopedPath(p.root, options.sheetPath ?? path.join(p.out, 'sheet.png'));
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      sheet = { path: filename, buffer: Buffer.from(data, 'base64') }; fs.writeFileSync(filename, sheet.buffer);
      if (options.imagePreview) sheet.previewBuffer = await preview(sheet.buffer);
    }
    if (options.signal?.aborted) throw cancelled();
    return { project: p.relative, frames: results, sheet };
  } finally { await session.close(); }
}

export async function renderVideo(workspace, project, options = {}) {
  const p = loadProject(workspace, project);
  if (p.cfg.width % 2 || p.cfg.height % 2) throw new MotionError('INVALID_VIDEO_SIZE', 'H.264 output requires even width and height.');
  if (!Number.isFinite(options.crf ?? 16) || (options.crf ?? 16) < 0 || (options.crf ?? 16) > 51) throw new MotionError('INVALID_CRF', 'crf must be between 0 and 51.');
  const name = options.output ?? `${p.cfg.name ?? path.basename(p.dir)}${options.lang ? '-' + options.lang : ''}.mp4`;
  const destination = scopedPath(p.root, path.isAbsolute(name) ? name : path.join(p.out, name));
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const partial = destination + `.${randomUUID()}.partial.mp4`;
  const audio = scopedPath(p.root, path.join(p.out, p.cfg.audio ?? 'audio.wav')), hasAudio = fs.existsSync(audio);
  const session = await renderSession(workspace, project, options);
  let child, finished, killTimer;
  const abort = () => { child?.kill('SIGTERM'); killTimer = setTimeout(() => child?.kill('SIGKILL'), 2000); killTimer.unref(); };
  try {
    child = spawn(process.env.FFMPEG_PATH ?? 'ffmpeg', [
      '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(p.fps), '-c:v', 'png', '-i', '-',
      ...(hasAudio ? ['-i', audio] : []), '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', String(options.crf ?? 16),
      '-maxrate', '24M', '-bufsize', '48M', '-profile:v', 'high', '-g', String(p.fps), '-r', String(p.fps),
      ...(hasAudio ? ['-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-shortest'] : ['-an']), '-movflags', '+faststart', partial,
    ], { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '', inputError;
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-4000); });
    child.stdin.on('error', error => { inputError = error; });
    finished = new Promise(resolve => { child.once('error', error => resolve({ error })); child.once('close', code => resolve({ code })); });
    options.signal?.addEventListener('abort', abort, { once: true });
    await once(child, 'spawn').catch(error => { throw new MotionError('MISSING_FFMPEG', error.message); });
    if (options.signal?.aborted) throw cancelled();
    for (let frame = 0; frame < p.frames; frame++) {
      const buffer = await session.grab(frame);
      if (inputError || child.exitCode !== null) throw new MotionError('ENCODER_FAILED', stderr || inputError?.message || 'Encoder stopped before rendering finished.');
      await new Promise((resolve, reject) => child.stdin.write(buffer, error => error ? reject(new MotionError('ENCODER_FAILED', stderr || error.message)) : resolve()));
      options.onProgress?.({ completed: frame + 1, total: p.frames });
    }
    child.stdin.end();
    const result = await finished;
    if (options.signal?.aborted) throw cancelled();
    if (result.error || result.code !== 0) throw new MotionError('ENCODER_FAILED', stderr || result.error?.message || `ffmpeg exited with code ${result.code}.`);
    fs.renameSync(partial, destination);
    return { project: p.relative, path: destination, bytes: fs.statSync(destination).size, frames: p.frames, fps: p.fps, duration: p.cfg.duration, audio: hasAudio };
  } finally {
    options.signal?.removeEventListener('abort', abort);
    if (child && child.exitCode === null && child.signalCode === null) { abort(); await finished; }
    clearTimeout(killTimer); await session.close();
    if (fs.existsSync(partial)) fs.unlinkSync(partial);
  }
}
