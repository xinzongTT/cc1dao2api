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
