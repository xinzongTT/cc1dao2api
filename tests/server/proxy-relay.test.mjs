import { Readable } from 'node:stream';
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

function fakeReasoningOnlyCcResponse() {
  return new Response([
    '{"type":"start"}\n',
    '{"type":"reasoning-start","id":"reasoning-0"}\n',
    '{"type":"reasoning-delta","id":"reasoning-0","text":"thinking"}\n',
    '{"type":"finish","finishReason":"stop","totalUsage":{"inputTokens":5,"outputTokens":6,"cachedInputTokens":1}}\n',
  ].join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function streamingRequest(app, method, url, body, headers = {}) {
  const payload = [Buffer.from(JSON.stringify(body))];
  const req = Readable.from(payload);
  req.method = method;
  req.url = url;
  req.headers = {
    host: '127.0.0.1',
    'content-type': 'application/json',
    ...Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])),
  };

  const responseHeaders = {};
  const chunks = [];
  const firstWrite = deferred();
  const res = {
    statusCode: 200,
    setHeader(name, value) {
      responseHeaders[name.toLowerCase()] = value;
    },
    getHeader(name) {
      return responseHeaders[name.toLowerCase()];
    },
    writeHead(status, headersToSet = {}) {
      this.statusCode = status;
      for (const [name, value] of Object.entries(headersToSet)) {
        this.setHeader(name, value);
      }
    },
    write(chunk) {
      chunks.push(Buffer.from(chunk));
      firstWrite.resolve(Buffer.concat(chunks).toString('utf8'));
    },
    end(chunk = '') {
      if (chunk) chunks.push(Buffer.from(chunk));
    },
  };

  const done = app.router.handle(req, res).then(() => ({
    status: res.statusCode,
    headers: responseHeaders,
    text: Buffer.concat(chunks).toString('utf8'),
  }));

  return {
    done,
    firstWrite: firstWrite.promise,
    getText: () => Buffer.concat(chunks).toString('utf8'),
  };
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
  it('requires a valid relay key for model listing', async () => {
    const app = await createInitializedApp();
    const missing = await request(app, 'GET', '/v1/models');
    expect(missing.status).toBe(401);

    const relay = await createRelayKey(app, { dailyTokenLimit: 1000 });
    const ok = await request(app, 'GET', '/v1/models', null, {
      Authorization: `Bearer ${relay.plaintextKey}`,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.object).toBe('list');
  });

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
    expect(upstreamCalls[0].init.headers['x-cli-environment']).toBe('production');
    expect(upstreamCalls[0].init.headers['x-command-code-version']).toBe('0.43.1');
    expect(upstreamCalls[0].init.headers['User-Agent']).toBe('cli');
    expect(usageTotal(app.db, relay.id)).toBe(30);
  });

  it('normalizes OpenAI chat messages to the CommandCode CLI request format', async () => {
    const upstreamCalls = [];
    const app = await createInitializedApp({
      fetch: async (url, init) => {
        upstreamCalls.push({ url, init, body: JSON.parse(init.body) });
        return fakeCcSseResponse({ inputTokens: 10, outputTokens: 20, cachedInputTokens: 3 });
      },
    });
    await addEncryptedUpstreamKey(app, 'user_upstream_format');
    const relay = await createRelayKey(app, { dailyTokenLimit: 1000 });

    const res = await request(app, 'POST', '/v1/chat/completions', {
      model: 'deepseek/deepseek-v4-flash',
      max_tokens: 100,
      messages: [
        { role: 'system', content: 'Use concise Chinese.' },
        { role: 'user', content: 'hello' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'call_weather',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"city":"Shanghai"}' },
          }],
        },
        { role: 'tool', tool_call_id: 'call_weather', content: 'sunny' },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'describe' },
            { type: 'image_url', image_url: { url: 'data:image/png;base64,abc' } },
          ],
        },
      ],
    }, {
      Authorization: `Bearer ${relay.plaintextKey}`,
    });

    expect(res.status).toBe(200);
    const params = upstreamCalls[0].body.params;
    expect(params.system).toBe('Use concise Chinese.');
    expect(params.stream).toBe(true);
    expect(params.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      {
        role: 'assistant',
        content: [{
          type: 'tool-call',
          toolCallId: 'call_weather',
          toolName: 'get_weather',
          input: { city: 'Shanghai' },
        }],
      },
      {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: 'call_weather',
          toolName: 'get_weather',
          output: { type: 'text', value: 'sunny' },
        }],
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'describe' },
          { type: 'image', image: 'data:image/png;base64,abc' },
        ],
      },
    ]);
  });

  it('normalizes Anthropic messages before forwarding to CommandCode', async () => {
    const upstreamCalls = [];
    const app = await createInitializedApp({
      fetch: async (url, init) => {
        upstreamCalls.push({ url, init, body: JSON.parse(init.body) });
        return fakeCcSseResponse({ inputTokens: 7, outputTokens: 9, cachedInputTokens: 1 });
      },
    });
    await addEncryptedUpstreamKey(app, 'user_upstream_anthropic_format');
    const relay = await createRelayKey(app, { dailyTokenLimit: 1000 });

    const res = await request(app, 'POST', '/v1/messages', {
      model: 'claude-sonnet-4-6',
      max_tokens: 100,
      system: [{ type: 'text', text: 'Reply in Chinese.' }],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'weather?' }] },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'toolu_weather', name: 'get_weather', input: { city: 'Shanghai' } }],
        },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_weather', content: 'sunny' }] },
      ],
      tools: [{ name: 'get_weather', description: 'weather lookup', input_schema: { type: 'object' } }],
      tool_choice: { type: 'tool', name: 'get_weather' },
    }, {
      Authorization: `Bearer ${relay.plaintextKey}`,
    });

    expect(res.status).toBe(200);
    const params = upstreamCalls[0].body.params;
    expect(params.system).toBe('Reply in Chinese.');
    expect(params.tools).toEqual([{ type: 'function', name: 'get_weather', description: 'weather lookup', input_schema: { type: 'object' } }]);
    expect(params.tool_choice).toEqual({ type: 'tool', name: 'get_weather' });
    expect(params.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'weather?' }] },
      {
        role: 'assistant',
        content: [{
          type: 'tool-call',
          toolCallId: 'toolu_weather',
          toolName: 'get_weather',
          input: { city: 'Shanghai' },
        }],
      },
      {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: 'toolu_weather',
          toolName: 'get_weather',
          output: { type: 'text', value: 'sunny' },
        }],
      },
    ]);
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
    expect(usageTotal(app.db, relay.id)).toBe(0);
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

  it('preserves CommandCode reasoning deltas in non-streaming OpenAI responses', async () => {
    const app = await createInitializedApp({ fetch: async () => fakeReasoningOnlyCcResponse() });
    await addEncryptedUpstreamKey(app, 'user_upstream_reasoning');
    const relay = await createRelayKey(app, { dailyTokenLimit: 1000 });
    const res = await request(app, 'POST', '/v1/chat/completions', validBody(), {
      Authorization: `Bearer ${relay.plaintextKey}`,
    });

    expect(res.status).toBe(200);
    expect(res.body.choices[0].message).toMatchObject({
      role: 'assistant',
      content: null,
      reasoning_content: 'thinking',
    });
    expect(usageTotal(app.db, relay.id)).toBe(11);
  });

  it('returns OpenAI-compatible server-sent events for streaming chat completions', async () => {
    const app = await createInitializedApp({
      fetch: async () => fakeCcSseResponse({ inputTokens: 10, outputTokens: 20, cachedInputTokens: 3 }),
    });
    await addEncryptedUpstreamKey(app, 'user_upstream_stream');
    const relay = await createRelayKey(app, { dailyTokenLimit: 1000 });
    const res = await request(app, 'POST', '/v1/chat/completions', { ...validBody(), stream: true }, {
      Authorization: `Bearer ${relay.plaintextKey}`,
    });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('"object":"chat.completion.chunk"');
    expect(res.text).toContain('"content":"hello"');
    expect(res.text).toContain('data: [DONE]');
    expect(usageTotal(app.db, relay.id)).toBe(30);
  });

  it('preserves CommandCode reasoning deltas in streaming OpenAI responses', async () => {
    const app = await createInitializedApp({ fetch: async () => fakeReasoningOnlyCcResponse() });
    await addEncryptedUpstreamKey(app, 'user_upstream_reasoning_stream');
    const relay = await createRelayKey(app, { dailyTokenLimit: 1000 });
    const res = await request(app, 'POST', '/v1/chat/completions', { ...validBody(), stream: true }, {
      Authorization: `Bearer ${relay.plaintextKey}`,
    });

    expect(res.status).toBe(200);
    expect(res.text).toContain('"reasoning_content":"thinking"');
    expect(res.text).toContain('data: [DONE]');
    expect(usageTotal(app.db, relay.id)).toBe(11);
  });

  it('streams OpenAI chunks as upstream CommandCode events arrive', async () => {
    const encoder = new TextEncoder();
    const controllerReady = deferred();
    let upstreamController;
    const app = await createInitializedApp({
      fetch: async () => new Response(new ReadableStream({
        start(controller) {
          upstreamController = controller;
          controllerReady.resolve(controller);
        },
      }), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    });
    await addEncryptedUpstreamKey(app, 'user_upstream_realtime_stream');
    const relay = await createRelayKey(app, { dailyTokenLimit: 1000 });
    const stream = await streamingRequest(app, 'POST', '/v1/chat/completions', { ...validBody(), stream: true }, {
      Authorization: `Bearer ${relay.plaintextKey}`,
    });

    await controllerReady.promise;
    upstreamController.enqueue(encoder.encode('{"type":"text-delta","text":"hel"}\n'));
    const firstWriteResult = await Promise.race([
      stream.firstWrite.then((text) => ({ type: 'write', text })),
      new Promise((resolve) => setTimeout(() => resolve({ type: 'timeout' }), 50)),
    ]);
    upstreamController.enqueue(encoder.encode('{"type":"finish","finishReason":"stop","totalUsage":{"inputTokens":2,"outputTokens":3,"cachedInputTokens":0}}\n'));
    upstreamController.close();
    const completed = await stream.done;

    expect(firstWriteResult.type).toBe('write');
    expect(firstWriteResult.text).toContain('"content":"hel"');
    expect(completed.text).toContain('data: [DONE]');
    expect(usageTotal(app.db, relay.id)).toBe(5);
  });

  it('returns Anthropic-compatible server-sent events for streaming messages', async () => {
    const app = await createInitializedApp({
      fetch: async () => fakeCcSseResponse({ inputTokens: 7, outputTokens: 9, cachedInputTokens: 1 }),
    });
    await addEncryptedUpstreamKey(app, 'user_upstream_anthropic_stream');
    const relay = await createRelayKey(app, { dailyTokenLimit: 1000 });
    const res = await request(app, 'POST', '/v1/messages', { ...validBody(), stream: true }, {
      Authorization: `Bearer ${relay.plaintextKey}`,
    });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('event: message_start');
    expect(res.text).toContain('"type":"content_block_delta"');
    expect(res.text).toContain('"text":"hello"');
    expect(res.text).toContain('event: message_stop');
    expect(usageTotal(app.db, relay.id)).toBe(16);
  });

  it('streams Anthropic content blocks as upstream CommandCode events arrive', async () => {
    const encoder = new TextEncoder();
    const controllerReady = deferred();
    let upstreamController;
    const app = await createInitializedApp({
      fetch: async () => new Response(new ReadableStream({
        start(controller) {
          upstreamController = controller;
          controllerReady.resolve(controller);
        },
      }), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    });
    await addEncryptedUpstreamKey(app, 'user_upstream_anthropic_realtime');
    const relay = await createRelayKey(app, { dailyTokenLimit: 1000 });
    const stream = await streamingRequest(app, 'POST', '/v1/messages', {
      model: 'deepseek/deepseek-v4-flash',
      max_tokens: 100,
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
    }, {
      Authorization: `Bearer ${relay.plaintextKey}`,
    });

    await controllerReady.promise;
    upstreamController.enqueue(encoder.encode('{"type":"text-delta","text":"hel"}\n'));
    const realtime = await waitForText(stream, '"type":"content_block_delta"', 50);
    upstreamController.enqueue(encoder.encode('{"type":"finish","finishReason":"stop","totalUsage":{"inputTokens":2,"outputTokens":3,"cachedInputTokens":0}}\n'));
    upstreamController.close();
    const completed = await stream.done;

    expect(realtime.type).toBe('found');
    expect(realtime.text).toContain('"text":"hel"');
    expect(completed.text).toContain('event: message_stop');
    expect(usageTotal(app.db, relay.id)).toBe(5);
  });
});
function waitForText(stream, pattern, timeoutMs = 50) {
  return Promise.race([
    new Promise((resolve) => {
      const startedAt = Date.now();
      const poll = () => {
        if (stream.getText().includes(pattern)) return resolve({ type: 'found', text: stream.getText() });
        if (Date.now() - startedAt >= timeoutMs) return resolve({ type: 'timeout', text: stream.getText() });
        setTimeout(poll, 5);
      };
      poll();
    }),
  ]);
}
