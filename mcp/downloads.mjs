import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';

// Only single byte ranges are supported. Null means invalid/unsatisfiable.
export function byteRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || !size) return null;
  const first = match[1] ? Number(match[1]) : null, last = match[2] ? Number(match[2]) : null;
  if ((first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last))) return null;
  if (first === null) return last > 0 ? { start: Math.max(0, size - last), end: size - 1 } : null;
  if (first >= size || (last !== null && last < first)) return null;
  return { start: first, end: last === null ? size - 1 : Math.min(last, size - 1) };
}

export async function serveArtifact(req, res, artifacts, pathname) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return;
  }
  let file;
  try {
    let uri;
    try { uri = 'ona-motion://' + decodeURIComponent(pathname.slice('/artifacts/'.length)); }
    catch { throw Object.assign(new Error('Invalid artifact URI'), { code: 'INVALID_ARTIFACT_URI' }); }
    const artifact = artifacts.resolve(uri);
    // Open a validated canonical file; reject replacement of its final component with a symlink.
    file = await fs.promises.open(fs.realpathSync(artifact.path), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = await file.stat();
    if (!stat.isFile()) throw Object.assign(new Error('Invalid artifact file'), { code: 'INVALID_ARTIFACT_PATH' });
    const headers = {
      'Content-Type': artifact.mimeType, 'Content-Length': stat.size,
      'Content-Disposition': `${new URL(req.url, 'http://localhost').searchParams.get('download') === '1' ? 'attachment' : 'inline'}; filename="${artifact.name.replace(/[^a-zA-Z0-9._-]/g, '_')}"`,
      'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      'Last-Modified': stat.mtime.toUTCString(),
    };
    let range, status = 200;
    // HEAD describes the complete representation. Without an ETag, If-Range tags cannot match.
    const ifRange = req.headers['if-range'];
    const ifRangeDate = typeof ifRange === 'string' && !ifRange.startsWith('"') && !ifRange.startsWith('W/') ? Date.parse(ifRange) : NaN;
    const rangeAllowed = !ifRange || (Number.isFinite(ifRangeDate) && Math.floor(stat.mtimeMs / 1000) * 1000 <= ifRangeDate);
    if (req.method === 'GET' && req.headers.range && rangeAllowed) {
      range = byteRange(req.headers.range, stat.size);
      if (!range) {
        res.writeHead(416, { ...headers, 'Content-Length': 0, 'Content-Range': `bytes */${stat.size}` }); res.end(); return;
      }
      status = 206; headers['Content-Range'] = `bytes ${range.start}-${range.end}/${stat.size}`;
      headers['Content-Length'] = range.end - range.start + 1;
    }
    res.writeHead(status, headers);
    if (req.method === 'HEAD' || !stat.size) { res.end(); return; }
    await pipeline(file.createReadStream({ ...(range ?? {}), autoClose: false }), res);
  } catch (error) {
    if (res.headersSent) { res.destroy(); return; }
    if (!['INVALID_ARTIFACT_URI', 'INVALID_ID', 'ARTIFACT_NOT_FOUND', 'ARTIFACT_NOT_READY', 'JOB_NOT_FOUND', 'INVALID_ARTIFACT_PATH', 'PATH_OUTSIDE_WORKSPACE', 'ENOENT', 'ELOOP', 'ENOTDIR'].includes(error.code)) throw error;
    res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'Artifact not available' }));
  } finally { await file?.close(); }
}
