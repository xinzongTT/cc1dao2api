import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('admin HTML shell', () => {
  it('uses Chinese page metadata', () => {
    const html = readFileSync(new URL('../../web/index.html', import.meta.url), 'utf8');

    expect(html).toContain('<html lang="zh-CN">');
    expect(html).toContain('<title>命令码中转管理</title>');
    expect(html).not.toContain('CommandCode Proxy Admin');
  });
});
