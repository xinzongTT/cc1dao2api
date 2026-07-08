import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
});
