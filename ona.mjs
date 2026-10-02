#!/usr/bin/env node
// ona-motion CLI; operations are shared with the MCP server.
import { spawn } from 'node:child_process';
import { DEFAULT_WORKSPACE, createProject, loadProject } from './lib/project.mjs';
import { openPreview, renderFrames, renderVideo } from './lib/render.mjs';

const HELP = `ona-motion CLI
  node ona.mjs new <name>                         scaffold examples/<name>
  node ona.mjs preview <project>                  live browser player
  node ona.mjs stills <project> <f,f,f|t1s,t2s>   PNG stills
  node ona.mjs sheet <project> [count]            contact sheet
  node ona.mjs render <project>                   mp4 export
options: --lang xx  --sub N  --crf N  --out file.mp4  --port N`;
const [command, target, ...rest] = process.argv.slice(2);
const options = {}, positional = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i] === '--sheet') options.sheet = true;
  else if (rest[i].startsWith('--')) {
    const key = rest[i].slice(2);
    if (!['lang', 'sub', 'crf', 'out', 'port'].includes(key) || !rest[i + 1] || rest[i + 1].startsWith('--')) {
      console.error(`Invalid option: ${rest[i]}`); process.exit(1);
    }
    options[key] = rest[++i];
  } else positional.push(rest[i]);
}
try {
  if (!command || ['help', '--help'].includes(command)) console.log(HELP);
  else if (command === 'new') {
    if (!target) throw new Error('usage: node ona.mjs new <name>');
    const project = createProject(DEFAULT_WORKSPACE, target);
    console.log(`created ${project.project} — next: node ona.mjs preview ${project.project}`);
  } else {
    if (!['preview', 'stills', 'sheet', 'render'].includes(command)) throw new Error(`Unknown command: ${command}`);
    if (!target) throw new Error(`usage: node ona.mjs ${command} <project-folder>`);
    const shared = { lang: options.lang, ...(options.sub ? { subframes: Number(options.sub) } : {}) };
    if (command === 'preview') {
      const preview = await openPreview(DEFAULT_WORKSPACE, target, { ...shared, port: Number(options.port ?? 5177) });
      console.log(`\n  ▶ ${preview.url}\n    space play/pause · ←/→ frame · shift+←/→ second · b motion blur · &t=3.5 to freeze\n    (edit scene.js and reload — Ctrl+C to stop)\n`);
      let stopping = false;
      const stop = async () => { if (stopping) return; stopping = true; await preview.close(); };
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
      const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', preview.url]] : process.platform === 'darwin' ? ['open', [preview.url]] : ['xdg-open', [preview.url]];
      if (!process.env.ONA_NO_OPEN) spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).on('error', () => {});
    } else {
      const controller = new AbortController(), abort = () => controller.abort();
      process.once('SIGINT', abort); process.once('SIGTERM', abort);
      try {
        const onProgress = ({ completed, total }) => { if (completed === total || completed % 60 === 0) process.stdout.write(`\r  ${completed}/${total}   `); };
        if (command === 'render') {
          const result = await renderVideo(DEFAULT_WORKSPACE, target, { ...shared, signal: controller.signal, onProgress, output: options.out, crf: Number(options.crf ?? 16) });
          console.log(`\n  → ${result.path} (${(result.bytes / 1e6).toFixed(1)} MB)${result.audio ? '' : ' · silent (run sound.py for audio)'}`);
        } else {
          let frames;
          if (command === 'stills') {
            if (!positional[0]) throw new Error('usage: node ona.mjs stills <project> 0,90,180 (or 1.5s,4s)');
            const p = loadProject(DEFAULT_WORKSPACE, target);
            frames = positional[0].split(',').map(s => s.endsWith('s') ? Math.round(parseFloat(s) * p.fps) : Number(s));
          }
          const result = await renderFrames(DEFAULT_WORKSPACE, target, { ...shared, signal: controller.signal, onProgress, frames, count: command === 'sheet' ? Number(positional[0] ?? 12) : 12, sheet: command === 'sheet' || options.sheet });
          for (const frame of result.frames) console.log(`  still ${frame.frame} (${frame.time.toFixed(2)}s) → ${frame.path}`);
          if (result.sheet) console.log(`  → ${result.sheet.path}`);
        }
      } finally { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); }
    }
  }
} catch (error) { console.error(`\n  ✖ ${error.message}\n`); process.exitCode = error.code === 'CANCELLED' ? 130 : 1; }
