import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { workspaceRoot } from './project.mjs';

export function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  const candidates = {
    darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'],
    linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'],
    win32: [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).flatMap(p => [path.join(p, 'Google/Chrome/Application/chrome.exe'), path.join(p, 'Microsoft/Edge/Application/msedge.exe')]),
  }[process.platform] ?? [];
  return candidates.find(p => fs.existsSync(p)) ?? null;
}
export function probe(command, args) {
  return new Promise(resolve => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000 });
    let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output = (output + data).slice(-4000); });
    child.on('error', error => resolve({ available: false, error: error.message }));
    child.on('close', code => resolve(code === 0 ? { available: true, version: output.trim().split('\n')[0] } : { available: false, error: output.trim() || `Process exited with code ${code}.` }));
  });
}
export async function checkEnvironment(workspace) {
  const root = workspaceRoot(workspace);
  const [ffmpeg, ffprobe, python, pythonAudio] = await Promise.all([
    probe(process.env.FFMPEG_PATH ?? 'ffmpeg', ['-version']), probe(process.env.FFPROBE_PATH ?? 'ffprobe', ['-version']),
    probe(process.env.PYTHON_PATH ?? 'python3', ['--version']), probe(process.env.PYTHON_PATH ?? 'python3', ['-c', 'import numpy, scipy; print("numpy " + numpy.__version__ + ", scipy " + scipy.__version__)']),
  ]);
  let puppeteer = false;
  try { createRequire(path.join(root, 'package.json')).resolve('puppeteer-core'); puppeteer = true; } catch { /* not installed */ }
  const browser = findChrome();
  return { workspace: root, node: process.version, browser, puppeteer, ffmpeg, ffprobe, python, pythonAudio,
    fonts: ['inter', 'jetbrains-mono', 'barlow-condensed', 'archivo-black', 'fredoka'].map(name => ({ name, available: fs.existsSync(path.join(root, 'node_modules/@fontsource', name)) })),
    canRenderFrames: Boolean(browser && puppeteer), canRenderVideo: Boolean(browser && puppeteer && ffmpeg.available) };
}
