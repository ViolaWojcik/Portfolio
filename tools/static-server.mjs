/**
 * A static file server that behaves like GitHub Pages, so what we prerender and
 * audit locally matches what visitors get.
 *
 * The one behaviour worth copying deliberately: Pages resolves an extensionless
 * URL to the matching `.html` file, so https://wioletawojcik.com/repapp serves
 * repapp.html. Anything missing falls through to 404.html, again like Pages.
 */

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
};

async function firstFile(candidates) {
  for (const path of candidates) {
    try {
      if ((await stat(path)).isFile()) return path;
    } catch { /* keep looking */ }
  }
  return null;
}

function send(res, status, path) {
  res.writeHead(status, {
    'content-type': MIME[extname(path)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(path).pipe(res);
}

/** Start the server on an ephemeral port. Resolves to `{ server, port, origin }`. */
export function serve(root) {
  const server = createServer(async (req, res) => {
    const rel = normalize(decodeURIComponent(req.url.split('?')[0]))
      .replace(/^(\.\.[/\\])+/, '');
    const base = join(root, rel);

    const path = await firstFile(
      rel.endsWith('/') || rel === '' ? [join(base, 'index.html')]
                                      : [base, `${base}.html`, join(base, 'index.html')]);

    if (path) return send(res, 200, path);

    const notFound = await firstFile([join(root, '404.html')]);
    if (notFound) return send(res, 404, notFound);
    res.writeHead(404, { 'content-type': 'text/plain' }).end('404');
  });

  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port, origin: `http://127.0.0.1:${port}` });
    });
  });
}
