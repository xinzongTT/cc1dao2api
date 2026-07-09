import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createTestApp, request } from './testUtils.mjs';

async function createStaticTestApp({ indexHtml }) {
  const root = mkdtempSync(join(tmpdir(), 'ccp-static-'));
  writeFileSync(join(root, 'index.html'), indexHtml);
  return createTestApp({
    staticRoot: root,
    staticIndexPath: join(root, 'index.html'),
  });
}

describe('static admin serving', () => {
  it('serves index.html fallback for admin routes', async () => {
    const app = await createStaticTestApp({ indexHtml: '<div id="root"></div>' });
    const res = await request(app, 'GET', '/admin');
    expect(res.status).toBe(200);
    expect(res.text).toContain('root');
  });

  it('rejects encoded traversal into sibling directories with the same prefix', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ccp-static-'));
    const sibling = `${root}-evil`;
    mkdirSync(sibling);
    writeFileSync(join(root, 'index.html'), '<div id="root"></div>');
    writeFileSync(join(sibling, 'secret.txt'), 'leaked');
    const app = await createTestApp({
      staticRoot: root,
      staticIndexPath: join(root, 'index.html'),
    });
    const siblingName = sibling.slice(dirname(root).length + 1);

    const res = await request(app, 'GET', `/%2e%2e%2f${siblingName}/secret.txt`);

    expect(res.status).toBe(404);
    expect(res.text).not.toContain('leaked');
  });

  it('rejects malformed percent-encoded paths without a 500', async () => {
    const app = await createStaticTestApp({ indexHtml: '<div id="root"></div>' });

    const res = await request(app, 'GET', '/%E0%A4%A');

    expect(res.status).toBe(404);
  });
});
