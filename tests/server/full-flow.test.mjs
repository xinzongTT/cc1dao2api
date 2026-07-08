import { describe, expect, it } from 'vitest';
import { adminRequest, addEncryptedUpstreamKey, createInitializedApp, request } from './testUtils.mjs';

function fakeSuccessfulCcFetch() {
  return new Response([
    'data: {"type":"text-delta","text":"ok"}\n\n',
    'data: {"type":"usage","usage":{"inputTokens":12,"outputTokens":21,"cachedInputTokens":4}}\n\n',
    'data: [DONE]\n\n',
  ].join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('full admin to relay flow', () => {
  it('runs init, adds upstream, creates relay key, sends proxy request, and updates stats', async () => {
    const app = await createInitializedApp({ fetch: async () => fakeSuccessfulCcFetch() });
    await addEncryptedUpstreamKey(app, 'user_main_key');
    const relay = await adminRequest(app, 'POST', '/admin/api/proxy-keys', {
      name: 'client',
      dailyTokenLimit: 100000,
      monthlyTokenLimit: 1000000,
      allowedModels: [],
    });
    const response = await request(app, 'POST', '/v1/chat/completions', {
      model: 'deepseek/deepseek-v4-flash',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hello' }],
      stream: false,
    }, { Authorization: `Bearer ${relay.body.plaintextKey}` });
    expect(response.status).toBe(200);
    const dashboard = await adminRequest(app, 'GET', '/admin/api/dashboard');
    expect(dashboard.body.kpis.todayTokens).toBeGreaterThan(0);
  });
});
