import { readFile, stat } from 'node:fs/promises';
import { resolve, join, relative, isAbsolute } from 'node:path';

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
  const index = resolve(indexPath);
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return false;
  }
  let target = null;

  if (pathname === '/admin' || (pathname.startsWith('/admin/') && !pathname.startsWith('/admin/api/'))) {
    target = index;
  } else {
    const requestRelativePath = pathname.replace(/^\/+/, '');
    const candidate = resolve(join(root, requestRelativePath));
    const rootRelativePath = relative(root, candidate);
    if (!rootRelativePath.startsWith('..') && !isAbsolute(rootRelativePath) && await fileExists(candidate)) {
      target = candidate;
    }
  }

  if (!target || !await fileExists(target)) return false;
  const body = await readFile(target);
  res.writeHead(200, { 'Content-Type': contentTypes[extension(target)] || 'application/octet-stream' });
  res.end(body);
  return true;
}
