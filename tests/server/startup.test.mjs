import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isDirectRun } from '../../server/index.mjs';

describe('server startup detection', () => {
  it('detects direct execution on Windows-style argv paths', () => {
    const argvPath = 'C:\\repo\\server\\index.mjs';
    expect(isDirectRun(pathToFileURL(argvPath).href, argvPath)).toBe(true);
  });
});
