#!/usr/bin/env node
// Administrator setup: copy already obtained executables to durable, ignored workspace storage.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_WORKSPACE, scopedPath, workspaceRoot } from './lib/project.mjs';
import { MEDIA_CONFIG } from './lib/media-tools.mjs';
import { probe } from './lib/environment.mjs';
import { writeJson } from './mcp/jobs.mjs';

const HELP = 'node ona-setup.mjs --ffmpeg /path/to/ffmpeg --ffprobe /path/to/ffprobe [--workspace /path/to/checkout]';
const args = process.argv.slice(2);
if (args.includes('--help')) console.log(HELP);
else {
  let destination, published = false;
  try {
    const options = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!['--ffmpeg', '--ffprobe', '--workspace'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || options[args[i]]) throw new Error(HELP);
      options[args[i]] = args[i + 1];
    }
    if (!options['--ffmpeg'] || !options['--ffprobe']) throw new Error(HELP);
    const root = workspaceRoot(options['--workspace'] ?? DEFAULT_WORKSPACE);
    destination = scopedPath(root, path.join('.ona-motion', 'bin', randomUUID()));
    fs.mkdirSync(destination, { recursive: true });
    const config = {}, versions = {};
    for (const name of ['ffmpeg', 'ffprobe']) {
      const source = fs.realpathSync(options[`--${name}`]);
      if (!fs.statSync(source).isFile()) throw new Error(`${name} must be an executable file.`);
      const target = path.join(destination, name + (process.platform === 'win32' ? '.exe' : ''));
      fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL); fs.chmodSync(target, 0o755);
      const result = await probe(target, ['-version']);
      if (!result.available) throw new Error(`${name} is unavailable: ${result.error}`);
      config[name] = path.relative(root, target).split(path.sep).join('/'); versions[name] = result.version;
    }
    // Publish configuration last; older installed binaries remain intact for in-flight processes.
    writeJson(scopedPath(root, MEDIA_CONFIG), config); published = true;
    const stored = JSON.parse(fs.readFileSync(scopedPath(root, MEDIA_CONFIG), 'utf8'));
    if (JSON.stringify(stored) !== JSON.stringify(config)) throw new Error('Encoder configuration readback did not match.');
    console.log(JSON.stringify({ workspace: root, config: stored, versions, next: 'Reconnect the MCP client after updating server code, then call check_environment.' }, null, 2));
  } catch (error) {
    if (destination && !published) fs.rmSync(destination, { recursive: true, force: true });
    console.error(error.message); process.exitCode = 1;
  }
}
