import { sendJson } from '../http/router.mjs';

export const fallbackModels = [
  'deepseek/deepseek-v4-flash',
  'deepseek/deepseek-v4-pro',
  'claude-sonnet-4-6',
  'moonshotai/Kimi-K2.5',
  'xiaomi/mimo-v2.5',
];

export function sendModelList(res, models = fallbackModels) {
  const created = Math.floor(Date.now() / 1000);
  return sendJson(res, 200, {
    object: 'list',
    data: models.map((id) => ({
      id,
      object: 'model',
      created,
      owned_by: 'command-code',
    })),
  });
}
