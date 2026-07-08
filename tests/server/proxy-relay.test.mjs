import { describe, expect, it } from 'vitest';
import { getUpstreamKey } from '../../server/db/repositories/upstreamKeys.mjs';
import { addEncryptedUpstreamKey, createInitializedApp, createRelayKey, request, usageTotal } from './testUtils.mjs';

function fakeCcSseResponse({ inputTokens, outputTokens, cachedInputTokens = 0 }) {
  return new Response([
    'data: {"type":"text-delta","text":"hello"}\n\n',
    `data: {"type":"usage","usage":{"inputTokens":${inputTokens},"outputTokens":${outputTokens},"cachedInputTokens":${cachedInputTokens}}}\n\n`,
    'data: [DONE]\n\n',
  ].join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function fakeZeroOutputCcResponse() {
  return fakeCcSseResponse({ inputTokens: 10, outputTokens: 0, cachedInputTokens: 0 });
}

function fakeCcNdjsonResponse() {
  return new Response([
    '{"type":"text-delta","text":"hello"}\n',
    '{"type":"finish","totalUsage":{"inputTokens":11,"outputTokens":22,"cachedInputTokens":5}}\n',
  ].join(''), {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson' },
  });
}

function validBody() {
  return {
    model: 'deepseek/deepseek-v4-flash',
    max_tokens: 100,
    messages: [{ role: 'user', content: 'hello' }],
    stream: false,
  };
}

describe('relay proxy flow', () => {
  it('accepts relay key, selects upstream key, and records usage', async () => {
    const upstreamCalls = [];
    const app = await createInitializedApp({
      fetch: async (url, init) => {
        upstreamCalls.push({ url, init });
        return fakeCcSseResponse({ inputTokens: 10, outputTokens: 20, cachedInputTokens: 3 });
      },
    });
    await addEncryptedUpstreamKey(app, 'user_upstream_one');
    const relay = await createRelayKey(app, { dailyTokenLimit: 1000 });
    const res = await request(app, 'POST', '/v1/chat/completions', validBody(), {
      Authorization: `Bearer ${relay.plaintextKey}`,
    });
    expect(res.status).toBe(200);
    expect(upstreamCalls[0].init.headers.Authorization).toBe('Bearer user_upstream_one');
    expect(usageTotal(app.db, relay.id)).toBe(30);
  });

  it('does not mark upstream limited for proxy-generated zero-output errors', async () => {
    const app = await createInitializedApp({ fetch: async () => fakeZeroOutputCcResponse() });
    const upstreamId = await addEncryptedUpstreamKey(app, 'user_upstream_one');
    const relay = await createRelayKey(app, { dailyTokenLimit: 1000 });
    const res = await request(app, 'POST', '/v1/chat/completions', validBody(), {
      Authorization: `Bearer ${relay.plaintextKey}`,
    });
    expect(res.status).toBe(429);
    expect(getUpstreamKey(app.db, upstreamId).health_status).toBe('unknown');
  });

  it('parses real CommandCode ndjson usage events', async () => {
    const app = await createInitializedApp({ fetch: async () => fakeCcNdjsonResponse() });
    await addEncryptedUpstreamKey(app, 'user_upstream_ndjson');
    const relay = await createRelayKey(app, { dailyTokenLimit: 1000 });
    const res = await request(app, 'POST', '/v1/chat/completions', validBody(), {
      Authorization: `Bearer ${relay.plaintextKey}`,
    });
    expect(res.status).toBe(200);
    expect(usageTotal(app.db, relay.id)).toBe(33);
  });
});
