import { randomUUID } from 'node:crypto';
import { buildCommandCodeHeaders } from '../commandCodeHeaders.mjs';
import { sendJson } from '../http/router.mjs';

function nowUnix() {
  return Math.floor(Date.now() / 1000);
}

function buildCcBody(params) {
  return {
    config: {
      workingDir: process.cwd(),
      date: new Date().toISOString().slice(0, 10),
      environment: `${process.platform}-${process.arch}, Node.js ${process.version}`,
      structure: [],
      isGitRepo: false,
      currentBranch: '',
      mainBranch: '',
      gitStatus: '',
      recentCommits: [],
    },
    memory: '',
    taste: '',
    skills: '',
    permissionMode: 'standard',
    params,
    threadId: randomUUID(),
  };
}

function usageFromAny(raw = {}) {
  return {
    inputTokens: Number(raw.inputTokens ?? raw.input_tokens ?? raw.prompt_tokens ?? 0),
    outputTokens: Number(raw.outputTokens ?? raw.output_tokens ?? raw.completion_tokens ?? 0),
    cachedInputTokens: Number(raw.cachedInputTokens ?? raw.cached_input_tokens ?? raw.cache_read_input_tokens ?? raw.prompt_tokens_details?.cached_tokens ?? 0),
  };
}

function normalizeUsage(usage) {
  if (!usage || !Number(usage.outputTokens)) {
    return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  }
  return usage;
}

function parseCcText(text) {
  let content = '';
  let usage = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(':')) continue;
    const data = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
    if (!data || data === '[DONE]') continue;
    try {
      const event = JSON.parse(data);
      if (event.type === 'text-delta' && typeof event.text === 'string') content += event.text;
      if (typeof event.text === 'string' && !event.type) content += event.text;
      if (typeof event.delta === 'string') content += event.delta;
      if (typeof event.delta?.content === 'string') content += event.delta.content;
      if (typeof event.choices?.[0]?.delta?.content === 'string') content += event.choices[0].delta.content;
      if (typeof event.choices?.[0]?.message?.content === 'string') content += event.choices[0].message.content;
      if (event.totalUsage) usage = usageFromAny(event.totalUsage);
      if (event.usage) usage = usageFromAny(event.usage);
    } catch {
      // Ignore malformed upstream event lines; the caller still gets any parsed usage.
    }
  }

  return { content, usage };
}

async function parseUpstreamResponse(response) {
  const text = await response.text();
  const contentType = response.headers?.get?.('content-type') || '';
  if (contentType.includes('application/json') && text) {
    const data = JSON.parse(text);
    if (data.usage) {
      return {
        content: data.choices?.[0]?.message?.content || data.content?.[0]?.text || '',
        usage: usageFromAny(data.usage),
      };
    }
  }
  return parseCcText(text);
}

function openAiError(message, type = 'invalid_request_error') {
  return { error: { message, type } };
}

function writeSse(res, event, data) {
  if (event) res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function writeSseDone(res) {
  res.write('data: [DONE]\n\n');
  res.end();
}

function sendOpenAiStream(res, body, content, usage) {
  const id = `chatcmpl-${randomUUID().slice(0, 12)}`;
  const model = body.model || 'deepseek/deepseek-v4-flash';
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  writeSse(res, null, {
    id,
    object: 'chat.completion.chunk',
    created: nowUnix(),
    model,
    choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
  });
  if (content) {
    writeSse(res, null, {
      id,
      object: 'chat.completion.chunk',
      created: nowUnix(),
      model,
      choices: [{ index: 0, delta: { content }, finish_reason: null }],
    });
  }
  writeSse(res, null, {
    id,
    object: 'chat.completion.chunk',
    created: nowUnix(),
    model,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
    usage: {
      prompt_tokens: usage.inputTokens,
      completion_tokens: usage.outputTokens,
      total_tokens: usage.inputTokens + usage.outputTokens,
      prompt_tokens_details: { cached_tokens: usage.cachedInputTokens },
    },
  });
  writeSseDone(res);
}

function sendAnthropicStream(res, body, content, usage) {
  const messageId = `msg_${randomUUID().slice(0, 12)}`;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  writeSse(res, 'message_start', {
    type: 'message_start',
    message: {
      id: messageId,
      type: 'message',
      role: 'assistant',
      model: body.model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: usage.inputTokens,
        output_tokens: 0,
        cache_read_input_tokens: usage.cachedInputTokens,
      },
    },
  });
  writeSse(res, 'content_block_start', {
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  });
  if (content) {
    writeSse(res, 'content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: content },
    });
  }
  writeSse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
  writeSse(res, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: usage.outputTokens },
  });
  writeSse(res, 'message_stop', { type: 'message_stop' });
  res.end();
}

async function forwardToCommandCode({ config, fetchImpl, upstreamKey, body }) {
  return fetchImpl(`${config.apiBase}/alpha/generate`, {
    method: 'POST',
    headers: buildCommandCodeHeaders({
      config,
      apiKey: upstreamKey,
      contentType: 'application/json',
      projectSlug: config.projectSlug || 'cc-proxy',
    }),
    body: JSON.stringify(buildCcBody(body)),
  });
}

export function createLegacyProxyHandlers({ config, fetchImpl }) {
  async function handleChatCompletionsBody({ req, res, body, upstreamKey }) {
    const response = await forwardToCommandCode({ config, fetchImpl, upstreamKey, body });
    if (!response.ok) {
      const message = await response.text().catch(() => '');
      sendJson(res, response.status, openAiError(message || `Upstream error ${response.status}`, 'upstream_error'));
      return { status: response.status, upstreamStatus: response.status, usage: null };
    }

    const parsed = await parseUpstreamResponse(response);
    parsed.usage = normalizeUsage(parsed.usage);
    if ((parsed.usage.outputTokens || 0) === 0) {
      sendJson(res, 429, { ...openAiError('Upstream returned zero output tokens', 'rate_limit_error'), retry_after: 1 });
      return { status: 429, upstreamStatus: response.status, usage: parsed.usage, proxyGeneratedError: 'zero_output' };
    }

    const model = body.model || 'deepseek/deepseek-v4-flash';
    if (body.stream) {
      sendOpenAiStream(res, body, parsed.content, parsed.usage);
      return { status: 200, upstreamStatus: response.status, usage: parsed.usage };
    }

    sendJson(res, 200, {
      id: `chatcmpl-${randomUUID().slice(0, 12)}`,
      object: 'chat.completion',
      created: nowUnix(),
      model,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: parsed.content },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: parsed.usage.inputTokens,
        completion_tokens: parsed.usage.outputTokens,
        total_tokens: parsed.usage.inputTokens + parsed.usage.outputTokens,
        prompt_tokens_details: { cached_tokens: parsed.usage.cachedInputTokens },
      },
    });
    return { status: 200, upstreamStatus: response.status, usage: parsed.usage };
  }

  async function handleMessagesBody({ req, res, body, upstreamKey }) {
    const response = await forwardToCommandCode({ config, fetchImpl, upstreamKey, body });
    if (!response.ok) {
      const message = await response.text().catch(() => '');
      sendJson(res, response.status, { type: 'error', error: { type: 'upstream_error', message: message || `Upstream error ${response.status}` } });
      return { status: response.status, upstreamStatus: response.status, usage: null };
    }
    const parsed = await parseUpstreamResponse(response);
    parsed.usage = normalizeUsage(parsed.usage);
    if ((parsed.usage.outputTokens || 0) === 0) {
      sendJson(res, 429, { type: 'error', error: { type: 'rate_limit_error', message: 'Upstream returned zero output tokens' } });
      return { status: 429, upstreamStatus: response.status, usage: parsed.usage, proxyGeneratedError: 'zero_output' };
    }
    if (body.stream) {
      sendAnthropicStream(res, body, parsed.content, parsed.usage);
      return { status: 200, upstreamStatus: response.status, usage: parsed.usage };
    }

    sendJson(res, 200, {
      id: `msg_${randomUUID().slice(0, 12)}`,
      type: 'message',
      role: 'assistant',
      model: body.model,
      content: [{ type: 'text', text: parsed.content }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: {
        input_tokens: parsed.usage.inputTokens,
        output_tokens: parsed.usage.outputTokens,
        cache_read_input_tokens: parsed.usage.cachedInputTokens,
        cache_creation_input_tokens: null,
      },
    });
    return { status: 200, upstreamStatus: response.status, usage: parsed.usage };
  }

  return { handleChatCompletionsBody, handleMessagesBody };
}
