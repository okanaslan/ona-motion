import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { DEFAULT_WORKSPACE } from '../lib/project.mjs';
import path from 'node:path';

// Opt in: launches the real local browser and writes ignored artifacts in examples/hello/out/.
// Leave it disabled for clients/CI machines without a browser.
test('real MCP frame rendering returns PNG image content and readable artifact resources', { skip: process.env.ONA_RENDER_CHECK !== '1', timeout: 120000 }, async t => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(DEFAULT_WORKSPACE, 'ona-mcp.mjs')], stderr: 'pipe' });
  const client = new Client({ name: 'ona-motion-render-check', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(transport);
  const result = await client.callTool({ name: 'render_frames', arguments: { project: 'examples/hello', count: 4, subframes: 1 } });
  assert.equal(result.isError, undefined, JSON.stringify(result.structuredContent));
  assert.equal(result.structuredContent.result.frames.length, 4);
  const image = result.content.find(c => c.type === 'image'); assert.ok(image);
  assert.equal(Buffer.from(image.data, 'base64').subarray(1, 4).toString(), 'PNG');
  const resource = await client.readResource({ uri: result.structuredContent.result.sheet.uri });
  assert.equal(Buffer.from(resource.contents[0].blob, 'base64').subarray(1, 4).toString(), 'PNG');
});
