import { readFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

function extension(pathname) {
  const match = pathname.match(/\.[^.]+$/);
  return match ? match[0] : '';
}

async function fileExists(pathname) {
  try {
    return (await stat(pathname)).isFile();
  } catch {
    return false;
  }
}

export async function serveStaticOrIndex(req, res, { rootDir, indexPath }) {
  const host = req.headers?.host || 'localhost';
  const url = new URL(req.url, `http://${host}`);
  const root = resolve(rootDir);
  const pathname = decodeURIComponent(url.pathname);
  let target = null;

  if (pathname === '/admin' || (pathname.startsWith('/admin/') && !pathname.startsWith('/admin/api/'))) {
    target = indexPath;
  } else {
    const relative = pathname.replace(/^\/+/, '');
    const candidate = resolve(join(root, relative));
    if (candidate.startsWith(root) && await fileExists(candidate)) {
      target = candidate;
    }
  }

  if (!target || !await fileExists(target)) return false;
  const body = await readFile(target);
  res.writeHead(200, { 'Content-Type': contentTypes[extension(target)] || 'application/octet-stream' });
  res.end(body);
  return true;
}
