const adminErrorMessages = {
  body_too_large: '请求内容过大',
  csrf_rejected: '登录状态校验失败，请重新登录',
  encryption_key_missing: '加密密钥缺失或无效',
  invalid_credentials: '用户名或密码错误',
  invalid_input: '用户名和至少 8 位密码为必填',
  invalid_json: '请求格式无效',
  invalid_limit: '额度必须是正整数或留空',
  invalid_models: '允许模型格式无效',
  invalid_proxy_key: '中转密钥名称、额度或模型白名单无效',
  invalid_upstream_key: '需要填写名称和 user_ 上游密钥',
  quota_refresh_failed: '额度刷新失败',
  rate_limited: '登录失败次数过多，请稍后再试',
};

export function adminErrorMessage(error) {
  return adminErrorMessages[error?.code] || '请求失败';
}

const runtimeErrorPatterns = [
  [/^Quota endpoint returned (\d+)$/, '额度接口返回 $1'],
  [/^Upstream returned (\d+)$/, '上游返回 $1'],
];

const runtimeErrorMessages = {
  'ENCRYPTION_KEY is missing or invalid': '加密密钥缺失或无效',
  'Quota response was not recognized': '无法识别额度响应',
  'Upstream authentication failed': '上游认证失败',
  'Upstream key not found': '未找到上游密钥',
  'Upstream returned zero output tokens': '上游返回的输出令牌为 0',
  'fetch failed': '请求上游失败',
};

export function adminRuntimeErrorMessage(message) {
  if (!message) return '无';
  if (runtimeErrorMessages[message]) return runtimeErrorMessages[message];
  for (const [pattern, replacement] of runtimeErrorPatterns) {
    if (pattern.test(message)) return message.replace(pattern, replacement);
  }
  return /[A-Za-z]/.test(message) ? '请求失败' : message;
}
