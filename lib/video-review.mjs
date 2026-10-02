import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { MotionError, scopedPath } from './project.mjs';
import { mediaTool } from './media-tools.mjs';

// Bounded, shell-free subprocesses. Cancellation waits for process cleanup.
export function runMedia(workspace, name, args, { signal, timeoutMs = 120000 } = {}) {
  if (signal?.aborted) return Promise.reject(new MotionError('CANCELLED', 'Media inspection was cancelled.'));
  return new Promise((resolve, reject) => {
    const child = spawn(mediaTool(workspace, name).command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', failure, killTimer;
    const stop = () => {
      child.kill('SIGTERM');
      killTimer ??= setTimeout(() => child.kill('SIGKILL'), 2000); killTimer.unref();
    };
    const abort = () => { failure = new MotionError('CANCELLED', 'Media inspection was cancelled.'); stop(); };
    const timer = setTimeout(() => { failure = new MotionError('TIMEOUT', 'Media inspection exceeded the two-minute deadline. Reduce the review request.'); stop(); }, timeoutMs); timer.unref();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    child.stdout.on('data', bytes => {
      if (stdout.length + bytes.length > 1024 * 1024) { failure = new MotionError('MEDIA_OUTPUT_LIMIT', 'Media metadata exceeded the output limit.'); stop(); }
      else stdout += bytes.toString();
    });
    child.stderr.on('data', bytes => { stderr = (stderr + bytes).slice(-16000); });
    child.once('error', error => { failure = new MotionError(error.code === 'ENOENT' ? `MISSING_${name.toUpperCase()}` : 'MEDIA_PROCESS_FAILED', error.message); });
    child.once('close', code => {
      clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', abort);
      if (failure) reject(failure);
      else if (code !== 0) reject(new MotionError('MEDIA_PROCESS_FAILED', stderr.slice(-4000) || `${name} exited with code ${code}.`));
      else resolve({ stdout, stderr });
    });
  });
}
const number = value => value === undefined || value === null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const rate = value => {
  const [a, b = '1'] = String(value).split('/');
  return number(a) !== null && number(b) > 0 ? Number(a) / Number(b) : null;
};
export async function inspectVideo(workspace, filename, { countFrames = false, verifyDecode = false, signal } = {}) {
  const file = scopedPath(workspace, filename);
  const { stdout } = await runMedia(workspace, 'ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe',
    ...(countFrames ? ['-count_frames'] : []), '-show_entries',
    'format=duration,size,format_name:stream=index,codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,nb_frames,nb_read_frames,pix_fmt,duration,sample_rate,channels:stream_disposition=attached_pic',
    '-of', 'json', file], { signal });
  let metadata;
  try { metadata = JSON.parse(stdout); } catch { throw new MotionError('INVALID_MEDIA', 'ffprobe returned invalid metadata.'); }
  const video = metadata.streams?.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
  if (!video || !Number.isInteger(video.width) || !Number.isInteger(video.height) || video.width < 1 || video.height < 1 || video.width > 8192 || video.height > 8192) throw new MotionError('INVALID_MEDIA', 'Choose a video with dimensions from 1 to 8192 pixels.');
  const duration = number(metadata.format?.duration) ?? number(video.duration);
  if (duration === null || duration <= 0) throw new MotionError('INVALID_MEDIA', 'Video must have a finite positive duration.');
  if (verifyDecode) await runMedia(workspace, 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-xerror', '-protocol_whitelist', 'file,pipe', '-i', file, '-map', `0:${video.index}`, '-f', 'null', '-'], { signal });
  const decodedFrames = number(video.nb_read_frames), audio = metadata.streams.filter(stream => stream.codec_type === 'audio').map(stream => ({ codec: stream.codec_name, sampleRate: number(stream.sample_rate), channels: number(stream.channels), duration: number(stream.duration) }));
  return { path: file, bytes: fs.statSync(file).size, duration, format: metadata.format?.format_name,
    video: { streamIndex: video.index, codec: video.codec_name, width: video.width, height: video.height, pixelFormat: video.pix_fmt,
      avgFrameRate: rate(video.avg_frame_rate), rFrameRate: rate(video.r_frame_rate), frames: decodedFrames ?? number(video.nb_frames), frameCountSource: decodedFrames !== null ? 'decoded' : number(video.nb_frames) !== null ? 'container' : 'unavailable' },
    audio, hasAudio: audio.length > 0, decodeVerified: verifyDecode, decodeScope: verifyDecode ? 'selected video stream only' : 'not performed' };
}
export async function extractVideoFrames(workspace, filename, metadata, { frames, times, count = 6, sheet = true, outputDir, signal } = {}) {
  if (frames && times) throw new MotionError('INVALID_FRAMES', 'Choose frames or times, not both.');
  if (!Number.isInteger(count) || count < 1 || count > 12) throw new MotionError('INVALID_FRAMES', 'Choose 1–12 samples.');
  if (frames?.some(frame => !Number.isInteger(frame) || frame < 0 || (metadata.video.frames !== null && frame >= metadata.video.frames))) throw new MotionError('INVALID_FRAMES', 'Frame indices must be inside the encoded video.');
  const selectedTimes = times ?? (frames ? undefined : Array.from({ length: count }, (_, i) => (i + 0.5) * metadata.duration / count));
  if (selectedTimes?.some(time => !Number.isFinite(time) || time < 0 || time >= metadata.duration)) throw new MotionError('INVALID_FRAMES', 'Times must be inside the encoded video duration.');
  const selected = frames ?? selectedTimes;
  if (!selected.length || selected.length > 12) throw new MotionError('INVALID_FRAMES', 'Choose 1–12 samples.');
  const output = scopedPath(workspace, outputDir); fs.mkdirSync(output, { recursive: true });
  const file = scopedPath(workspace, filename), results = [];
  const previewFilter = "scale=w='min(1024,iw)':h='min(1024,ih)':force_original_aspect_ratio=decrease";
  try {
    for (let i = 0; i < selected.length; i++) {
      const value = selected[i], name = `sample-${String(i).padStart(3, '0')}.png`, destination = scopedPath(workspace, path.join(output, name));
      const select = frames ? `eq(n,${value})` : `gte(t,${value})*isnan(prev_selected_t)`;
      const { stderr } = await runMedia(workspace, 'ffmpeg', ['-hide_banner', '-loglevel', 'info', '-protocol_whitelist', 'file,pipe', '-i', file,
        '-map', `0:${metadata.video.streamIndex}`, '-vf', `select='${select}',showinfo`, '-an', '-sn', '-dn', '-fps_mode', 'passthrough', '-frames:v', '1', destination], { signal });
      const match = stderr.match(/\bpts_time:([\d.eE+-]+)/);
      if (!fs.existsSync(destination) || !match || !Number.isFinite(Number(match[1]))) throw new MotionError('FRAME_NOT_FOUND', 'No encoded frame exists at the requested position.');
      const buffer = fs.readFileSync(destination);
      let previewBuffer;
      if (!sheet) {
        const preview = scopedPath(workspace, path.join(output, `preview-${i}.png`));
        await runMedia(workspace, 'ffmpeg', ['-v', 'error', '-i', destination, '-vf', previewFilter, '-frames:v', '1', preview], { signal });
        previewBuffer = fs.readFileSync(preview);
      }
      results.push({ ...(frames ? { frame: value } : { requestedTime: value }), time: Number(match[1]), path: destination, buffer, ...(previewBuffer ? { previewBuffer } : {}) });
    }
    let contactSheet;
    if (sheet) {
      const cols = Math.min(4, results.length), rows = Math.ceil(results.length / cols);
      const scale = Math.min(1, 400 / metadata.video.width, 400 / metadata.video.height);
      const width = Math.max(1, Math.round(metadata.video.width * scale)), height = Math.max(1, Math.round(metadata.video.height * scale));
      const destination = scopedPath(workspace, path.join(output, 'sheet.png'));
      await runMedia(workspace, 'ffmpeg', ['-v', 'error', '-framerate', '1', '-i', path.join(output, 'sample-%03d.png'),
        '-vf', `scale=${width}:${height},tile=${cols}x${rows}:nb_frames=${results.length}:padding=6:margin=6`, '-frames:v', '1', destination], { signal });
      const preview = scopedPath(workspace, path.join(output, 'sheet-preview.png'));
      await runMedia(workspace, 'ffmpeg', ['-v', 'error', '-i', destination, '-vf', previewFilter, '-frames:v', '1', preview], { signal });
      contactSheet = { path: destination, buffer: fs.readFileSync(destination), previewBuffer: fs.readFileSync(preview) };
    }
    if (signal?.aborted) throw new MotionError('CANCELLED', 'Encoded frame extraction was cancelled.');
    return { frames: results, sheet: contactSheet };
  } catch (error) { fs.rmSync(output, { recursive: true, force: true }); throw error; }
}
