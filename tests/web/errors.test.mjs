import { describe, expect, it } from 'vitest';
import { adminRuntimeErrorMessage } from '../../web/src/lib/errors.js';

describe('admin runtime error localization', () => {
  it('localizes known persisted upstream errors', () => {
    expect(adminRuntimeErrorMessage('Quota endpoint returned 404')).toBe('额度接口返回 404');
    expect(adminRuntimeErrorMessage('Upstream returned 429')).toBe('上游返回 429');
    expect(adminRuntimeErrorMessage('Quota response was not recognized')).toBe('无法识别额度响应');
    expect(adminRuntimeErrorMessage('ENCRYPTION_KEY is missing or invalid')).toBe('加密密钥缺失或无效');
  });

  it('does not expose unknown English runtime errors on the page', () => {
    expect(adminRuntimeErrorMessage('socket hang up')).toBe('请求失败');
    expect(adminRuntimeErrorMessage('')).toBe('无');
    expect(adminRuntimeErrorMessage('手动中文错误')).toBe('手动中文错误');
  });
});
