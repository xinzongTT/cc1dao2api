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

function emptyParsedResponse() {
  return {
    content: '',
    reasoningContent: '',
    finishReason: 'stop',
    toolCalls: null,
    usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
  };
}

function parseCcEventLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith(':')) return null;
  const data = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
  if (!data || data === '[DONE]') return null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function commandCodeToolCall(event) {
  return {
    id: event.toolCallId || `call_${randomUUID().slice(0, 8)}`,
    type: 'function',
    function: {
      name: event.toolName || '',
      arguments: typeof event.input === 'string' ? event.input : JSON.stringify(event.input || {}),
    },
  };
}

function applyCcEvent(parsed, event) {
  if (!event) return;
  if (event.type === 'text-delta' && typeof event.text === 'string') parsed.content += event.text;
  if (event.type === 'reasoning-delta' && typeof event.text === 'string') parsed.reasoningContent += event.text;
  if (event.type === 'tool-call') {
    parsed.toolCalls = parsed.toolCalls || [];
    parsed.toolCalls.push(commandCodeToolCall(event));
  }
  if (typeof event.text === 'string' && !event.type) parsed.content += event.text;
  if (typeof event.delta === 'string') parsed.content += event.delta;
  if (typeof event.delta?.content === 'string') parsed.content += event.delta.content;
  if (typeof event.choices?.[0]?.delta?.content === 'string') parsed.content += event.choices[0].delta.content;
  if (typeof event.choices?.[0]?.delta?.reasoning_content === 'string') parsed.reasoningContent += event.choices[0].delta.reasoning_content;
  if (typeof event.choices?.[0]?.message?.content === 'string') parsed.content += event.choices[0].message.content;
  if (typeof event.choices?.[0]?.message?.reasoning_content === 'string') parsed.reasoningContent += event.choices[0].message.reasoning_content;
  if (event.type === 'finish' && event.finishReason) parsed.finishReason = mapFinishReason(event.finishReason);
  if (event.totalUsage) parsed.usage = usageFromAny(event.totalUsage);
  if (event.usage) parsed.usage = usageFromAny(event.usage);
}

function parseCcText(text) {
  const parsed = emptyParsedResponse();

  for (const line of text.split(/\r?\n/)) {
    applyCcEvent(parsed, parseCcEventLine(line));
  }

  return parsed;
}

async function parseUpstreamResponse(response) {
  const text = await response.text();
  const contentType = response.headers?.get?.('content-type') || '';
  if (contentType.includes('application/json') && text) {
    const data = JSON.parse(text);
    if (data.usage) {
      return {
        content: data.choices?.[0]?.message?.content || data.content?.[0]?.text || '',
        reasoningContent: data.choices?.[0]?.message?.reasoning_content || '',
        toolCalls: data.choices?.[0]?.message?.tool_calls || null,
        finishReason: data.choices?.[0]?.finish_reason || 'stop',
        usage: usageFromAny(data.usage),
      };
    }
  }
  return parseCcText(text);
}

function openAiError(message, type = 'invalid_request_error') {
  return { error: { message, type } };
}

function mapFinishReason(reason) {
  if (reason === 'tool-calls') return 'tool_calls';
  if (reason === 'length') return 'length';
  return reason || 'stop';
}

function mapAnthropicStopReason(reason) {
  if (reason === 'tool_calls') return 'tool_use';
  if (reason === 'length') return 'max_tokens';
  return 'end_turn';
}

function writeSse(res, event, data) {
  if (event) res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function writeSseDone(res) {
  res.write('data: [DONE]\n\n');
  res.end();
}

function sendOpenAiStream(res, body, parsed) {
  const id = `chatcmpl-${randomUUID().slice(0, 12)}`;
  const model = body.model || 'deepseek/deepseek-v4-flash';
  const usage = parsed.usage;
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
  if (parsed.reasoningContent) {
    writeSse(res, null, {
      id,
      object: 'chat.completion.chunk',
      created: nowUnix(),
      model,
      choices: [{ index: 0, delta: { reasoning_content: parsed.reasoningContent }, finish_reason: null }],
    });
  }
  if (parsed.content) {
    writeSse(res, null, {
      id,
      object: 'chat.completion.chunk',
      created: nowUnix(),
      model,
      choices: [{ index: 0, delta: { content: parsed.content }, finish_reason: null }],
    });
  }
  if (parsed.toolCalls) {
    writeSse(res, null, {
      id,
      object: 'chat.completion.chunk',
      created: nowUnix(),
      model,
      choices: [{ index: 0, delta: { tool_calls: parsed.toolCalls }, finish_reason: null }],
    });
  }
  writeSse(res, null, {
    id,
    object: 'chat.completion.chunk',
    created: nowUnix(),
    model,
    choices: [{ index: 0, delta: {}, finish_reason: parsed.finishReason || 'stop' }],
    usage: {
      prompt_tokens: usage.inputTokens,
      completion_tokens: usage.outputTokens,
      total_tokens: usage.inputTokens + usage.outputTokens,
      prompt_tokens_details: { cached_tokens: usage.cachedInputTokens },
    },
  });
  writeSseDone(res);
}

function openAiUsage(usage) {
  return {
    prompt_tokens: usage.inputTokens,
    completion_tokens: usage.outputTokens,
    total_tokens: usage.inputTokens + usage.outputTokens,
    prompt_tokens_details: { cached_tokens: usage.cachedInputTokens },
  };
}

function writeOpenAiChunk(res, { id, created, model, delta, finishReason = null, usage = null }) {
  const chunk = {
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
  if (usage) chunk.usage = openAiUsage(usage);
  writeSse(res, null, chunk);
}

async function streamOpenAiResponse(res, body, response) {
  const id = `chatcmpl-${randomUUID().slice(0, 12)}`;
  const created = nowUnix();
  const model = body.model || 'deepseek/deepseek-v4-flash';
  const parsed = emptyParsedResponse();
  let sentRole = false;
  let sentFinish = false;
  let toolCallIndex = 0;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  function deltaWithRole(delta) {
    if (sentRole) return delta;
    sentRole = true;
    return { role: 'assistant', ...delta };
  }

  function emitEvent(event) {
    applyCcEvent(parsed, event);
    if (event?.type === 'text-delta') {
      const text = event.text || event.delta || '';
      if (text) writeOpenAiChunk(res, { id, created, model, delta: deltaWithRole({ content: text }) });
    } else if (event?.type === 'reasoning-delta') {
      const text = event.text || '';
      if (text) writeOpenAiChunk(res, { id, created, model, delta: deltaWithRole({ reasoning_content: text }) });
    } else if (event?.type === 'tool-call') {
      const toolCall = commandCodeToolCall(event);
      writeOpenAiChunk(res, {
        id,
        created,
        model,
        delta: deltaWithRole({
          content: null,
          tool_calls: [{
            index: toolCallIndex,
            ...toolCall,
          }],
        }),
      });
      toolCallIndex += 1;
    } else if (event?.type === 'finish') {
      sentFinish = true;
      writeOpenAiChunk(res, {
        id,
        created,
        model,
        delta: {},
        finishReason: parsed.finishReason || 'stop',
        usage: parsed.usage,
      });
    }
  }

  const reader = response.body?.getReader?.();
  if (!reader) {
    const fallback = await parseUpstreamResponse(response);
    fallback.usage = normalizeUsage(fallback.usage);
    sendOpenAiStream(res, body, fallback);
    return fallback;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) emitEvent(parseCcEventLine(line));
  }
  buffer += decoder.decode();
  if (buffer.trim()) emitEvent(parseCcEventLine(buffer));
  parsed.usage = normalizeUsage(parsed.usage);

  if (!sentFinish) {
    writeOpenAiChunk(res, {
      id,
      created,
      model,
      delta: {},
      finishReason: parsed.finishReason || 'stop',
      usage: parsed.usage,
    });
  }
  writeSseDone(res);
  return parsed;
}

function sendAnthropicStream(res, body, parsed) {
  const messageId = `msg_${randomUUID().slice(0, 12)}`;
  const usage = parsed.usage;
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
  if (parsed.content) {
    writeSse(res, 'content_block_delta', {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: parsed.content },
    });
  }
  writeSse(res, 'content_block_stop', { type: 'content_block_stop', index: 0 });
  writeSse(res, 'message_delta', {
    type: 'message_delta',
    delta: { stop_reason: mapAnthropicStopReason(parsed.finishReason), stop_sequence: null },
    usage: { output_tokens: usage.outputTokens },
  });
  writeSse(res, 'message_stop', { type: 'message_stop' });
  res.end();
}

async function streamAnthropicResponse(res, body, response) {
  const messageId = `msg_${randomUUID().slice(0, 12)}`;
  const parsed = emptyParsedResponse();
  let textBlockStarted = false;
  let currentIndex = 0;
  let sentMessageDelta = false;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
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
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  });

  function ensureTextBlock() {
    if (textBlockStarted) return;
    writeSse(res, 'content_block_start', {
      type: 'content_block_start',
      index: currentIndex,
      content_block: { type: 'text', text: '' },
    });
    textBlockStarted = true;
  }

  function finishTextBlock() {
    if (!textBlockStarted) return;
    writeSse(res, 'content_block_stop', { type: 'content_block_stop', index: currentIndex });
    textBlockStarted = false;
    currentIndex += 1;
  }

  function emitFinish() {
    if (sentMessageDelta) return;
    finishTextBlock();
    writeSse(res, 'message_delta', {
      type: 'message_delta',
      delta: { stop_reason: mapAnthropicStopReason(parsed.finishReason), stop_sequence: null },
      usage: { output_tokens: parsed.usage.outputTokens },
    });
    writeSse(res, 'message_stop', { type: 'message_stop' });
    sentMessageDelta = true;
  }

  function emitEvent(event) {
    applyCcEvent(parsed, event);
    if (event?.type === 'text-delta') {
      const text = event.text || event.delta || '';
      if (!text) return;
      ensureTextBlock();
      writeSse(res, 'content_block_delta', {
        type: 'content_block_delta',
        index: currentIndex,
        delta: { type: 'text_delta', text },
      });
    } else if (event?.type === 'tool-call') {
      finishTextBlock();
      const input = typeof event.input === 'string' ? tryParseJson(event.input) : (event.input || {});
      writeSse(res, 'content_block_start', {
        type: 'content_block_start',
        index: currentIndex,
        content_block: { type: 'tool_use', id: event.toolCallId || `call_${randomUUID().slice(0, 8)}`, name: event.toolName || '', input: {} },
      });
      writeSse(res, 'content_block_delta', {
        type: 'content_block_delta',
        index: currentIndex,
        delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) },
      });
      writeSse(res, 'content_block_stop', { type: 'content_block_stop', index: currentIndex });
      currentIndex += 1;
    } else if (event?.type === 'finish') {
      emitFinish();
    }
  }

  const reader = response.body?.getReader?.();
  if (!reader) {
    const fallback = await parseUpstreamResponse(response);
    fallback.usage = normalizeUsage(fallback.usage);
    sendAnthropicStream(res, body, fallback);
    return fallback;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) emitEvent(parseCcEventLine(line));
  }
  buffer += decoder.decode();
  if (buffer.trim()) emitEvent(parseCcEventLine(buffer));
  parsed.usage = normalizeUsage(parsed.usage);
  emitFinish();
  res.end();
  return parsed;
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

    if (body.stream) {
      const parsed = await streamOpenAiResponse(res, body, response);
      return { status: 200, upstreamStatus: response.status, usage: parsed.usage };
    }

    const parsed = await parseUpstreamResponse(response);
    parsed.usage = normalizeUsage(parsed.usage);
    if ((parsed.usage.outputTokens || 0) === 0) {
      sendJson(res, 429, { ...openAiError('Upstream returned zero output tokens', 'rate_limit_error'), retry_after: 1 });
      return { status: 429, upstreamStatus: response.status, usage: parsed.usage, proxyGeneratedError: 'zero_output' };
    }

    const model = body.model || 'deepseek/deepseek-v4-flash';
    const message = {
      role: 'assistant',
      content: parsed.content || null,
    };
    if (parsed.reasoningContent) message.reasoning_content = parsed.reasoningContent;
    if (parsed.toolCalls) message.tool_calls = parsed.toolCalls;

    sendJson(res, 200, {
      id: `chatcmpl-${randomUUID().slice(0, 12)}`,
      object: 'chat.completion',
      created: nowUnix(),
      model,
      choices: [{
        index: 0,
        message,
        finish_reason: parsed.finishReason || 'stop',
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
    if (body.stream) {
      const parsed = await streamAnthropicResponse(res, body, response);
      return { status: 200, upstreamStatus: response.status, usage: parsed.usage };
    }

    const parsed = await parseUpstreamResponse(response);
    parsed.usage = normalizeUsage(parsed.usage);
    if ((parsed.usage.outputTokens || 0) === 0) {
      sendJson(res, 429, { type: 'error', error: { type: 'rate_limit_error', message: 'Upstream returned zero output tokens' } });
      return { status: 429, upstreamStatus: response.status, usage: parsed.usage, proxyGeneratedError: 'zero_output' };
    }

    sendJson(res, 200, {
      id: `msg_${randomUUID().slice(0, 12)}`,
      type: 'message',
      role: 'assistant',
      model: body.model,
      content: parsed.content ? [{ type: 'text', text: parsed.content }] : [],
      stop_reason: mapAnthropicStopReason(parsed.finishReason),
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
