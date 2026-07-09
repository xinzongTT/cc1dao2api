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

function tryParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function textFromContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part?.type === 'text' ? part.text || '' : ''))
      .join('');
  }
  if (content == null) return '';
  return String(content);
}

function normalizeToolInput(toolCall) {
  const args = toolCall?.function?.arguments;
  if (typeof args === 'string') return tryParseJson(args);
  return args || {};
}

function normalizeOpenAiMessageContent(message) {
  if (message.role === 'user') {
    if (typeof message.content === 'string') {
      return [{ type: 'text', text: message.content }];
    }
    if (Array.isArray(message.content)) {
      return message.content.map((part) => {
        if (part?.type === 'image_url') {
          return { type: 'image', image: part.image_url?.url || '' };
        }
        return part;
      }).filter(Boolean);
    }
    return [{ type: 'text', text: textFromContent(message.content) }];
  }

  const parts = [];
  if (typeof message.content === 'string' && message.content) {
    parts.push({ type: 'text', text: message.content });
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part?.type === 'text') parts.push(part);
    }
  }
  return parts;
}

function convertOpenAiToCommandCodeParams(openaiReq = {}) {
  const messages = Array.isArray(openaiReq.messages) ? openaiReq.messages : [];
  const systemPrompt = messages
    .filter((message) => message.role === 'system')
    .map((message) => textFromContent(message.content))
    .filter(Boolean)
    .join('\n');
  const chatMessages = messages.filter((message) => message.role !== 'system');

  const toolNameById = {};
  for (const message of chatMessages) {
    if (message.role !== 'assistant' || !Array.isArray(message.tool_calls)) continue;
    for (const toolCall of message.tool_calls) {
      if (toolCall?.id) toolNameById[toolCall.id] = toolCall.function?.name || '';
    }
  }

  const ccMessages = chatMessages.map((message) => {
    if (message.role === 'user') {
      return { role: 'user', content: normalizeOpenAiMessageContent(message) };
    }
    if (message.role === 'assistant') {
      const content = normalizeOpenAiMessageContent(message);
      if (Array.isArray(message.tool_calls)) {
        for (const toolCall of message.tool_calls) {
          content.push({
            type: 'tool-call',
            toolCallId: toolCall.id,
            toolName: toolCall.function?.name || '',
            input: normalizeToolInput(toolCall),
          });
        }
      }
      return { role: 'assistant', content };
    }
    if (message.role === 'tool') {
      return {
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: message.tool_call_id,
          toolName: toolNameById[message.tool_call_id] || message.name || '',
          output: { type: 'text', value: textFromContent(message.content) },
        }],
      };
    }
    return message;
  });

  const params = {
    model: openaiReq.model || 'deepseek/deepseek-v4-flash',
    messages: ccMessages,
    max_tokens: Math.min(openaiReq.max_tokens || openaiReq.max_completion_tokens || 64000, 200000),
    stream: true,
  };

  if (systemPrompt) params.system = systemPrompt;
  if (openaiReq.temperature !== undefined) params.temperature = openaiReq.temperature;
  if (openaiReq.reasoning_effort !== undefined) params.reasoning_effort = openaiReq.reasoning_effort;
  if (Array.isArray(openaiReq.tools) && openaiReq.tools.length > 0) {
    params.tools = openaiReq.tools.map((tool) => ({
      type: tool.type || 'function',
      name: tool.function?.name || tool.name || '',
      description: tool.function?.description || tool.description || '',
      input_schema: tool.function?.parameters || tool.input_schema || { type: 'object', properties: {} },
    }));
  }
  if (openaiReq.tool_choice !== undefined) {
    if (typeof openaiReq.tool_choice === 'string') {
      const map = { auto: 'auto', none: 'none', required: 'any' };
      params.tool_choice = { type: map[openaiReq.tool_choice] || 'auto' };
    } else if (openaiReq.tool_choice?.type === 'function') {
      params.tool_choice = { type: 'tool', name: openaiReq.tool_choice.function?.name };
    } else {
      params.tool_choice = openaiReq.tool_choice;
    }
  }
  if (openaiReq.parallel_tool_calls !== undefined) {
    params.parallel_tool_calls = openaiReq.parallel_tool_calls;
  }
  return params;
}

function convertAnthropicToOpenAi(anthropicReq = {}) {
  let systemPrompt = '';
  if (typeof anthropicReq.system === 'string') {
    systemPrompt = anthropicReq.system;
  } else if (Array.isArray(anthropicReq.system)) {
    systemPrompt = anthropicReq.system
      .filter((block) => block?.type === 'text')
      .map((block) => block.text || '')
      .join('\n');
  }

  const toolNameById = {};
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });

  for (const message of anthropicReq.messages || []) {
    if (message.role === 'assistant') {
      let text = '';
      const toolCalls = [];
      const blocks = Array.isArray(message.content) ? message.content : [{ type: 'text', text: message.content || '' }];
      for (const block of blocks) {
        if (block?.type === 'text') {
          text += block.text || '';
        } else if (block?.type === 'tool_use') {
          toolNameById[block.id] = block.name;
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: { name: block.name, arguments: JSON.stringify(block.input || {}) },
          });
        }
      }
      const assistantMessage = { role: 'assistant', content: text || null };
      if (toolCalls.length > 0) assistantMessage.tool_calls = toolCalls;
      messages.push(assistantMessage);
    } else if (message.role === 'user') {
      let text = '';
      const toolResults = [];
      if (typeof message.content === 'string') {
        text = message.content;
      } else if (Array.isArray(message.content)) {
        for (const block of message.content) {
          if (block?.type === 'text') text += block.text || '';
          if (block?.type === 'tool_result') toolResults.push(block);
        }
      }
      if (text) messages.push({ role: 'user', content: text });
      for (const toolResult of toolResults) {
        messages.push({
          role: 'tool',
          tool_call_id: toolResult.tool_use_id,
          name: toolNameById[toolResult.tool_use_id] || '',
          content: textFromContent(toolResult.content),
        });
      }
    }
  }

  const openaiReq = {
    model: anthropicReq.model || 'deepseek/deepseek-v4-flash',
    messages,
    max_tokens: anthropicReq.max_tokens || 64000,
    stream: anthropicReq.stream === true,
  };

  if (Array.isArray(anthropicReq.tools) && anthropicReq.tools.length > 0) {
    openaiReq.tools = anthropicReq.tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description || '',
        parameters: tool.input_schema || { type: 'object', properties: {} },
      },
    }));
  }
  if (anthropicReq.tool_choice) {
    const choice = anthropicReq.tool_choice;
    if (choice.type === 'auto' || choice.type === undefined) openaiReq.tool_choice = 'auto';
    else if (choice.type === 'any') openaiReq.tool_choice = 'required';
    else if (choice.type === 'tool') openaiReq.tool_choice = { type: 'function', function: { name: choice.name } };
    else if (choice.type === 'none') openaiReq.tool_choice = 'none';
  }
  if (anthropicReq.temperature !== undefined) openaiReq.temperature = anthropicReq.temperature;
  if (anthropicReq.thinking) {
    const thinking = anthropicReq.thinking;
    if (thinking.type === 'adaptive') openaiReq.reasoning_effort = thinking.effort ?? 'medium';
    else if (thinking.budget_tokens !== undefined) {
      if (thinking.budget_tokens >= 10000) openaiReq.reasoning_effort = 'high';
      else if (thinking.budget_tokens >= 5000) openaiReq.reasoning_effort = 'medium';
      else openaiReq.reasoning_effort = 'low';
    }
  }
  return openaiReq;
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
    const ccParams = convertOpenAiToCommandCodeParams(body);
    const response = await forwardToCommandCode({ config, fetchImpl, upstreamKey, body: ccParams });
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
    const openaiBody = convertAnthropicToOpenAi(body);
    const ccParams = convertOpenAiToCommandCodeParams(openaiBody);
    const response = await forwardToCommandCode({ config, fetchImpl, upstreamKey, body: ccParams });
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
