export function loadConfig(env = process.env, cwd = process.cwd()) {
  return {
    port: Number.parseInt(env.PORT || '3000', 10),
    host: env.HOST || '0.0.0.0',
    apiBase: env.CC_API_BASE || 'https://api.commandcode.ai',
    projectSlug: env.PROJECT_SLUG || 'cc-proxy',
    databasePath: env.DATABASE_PATH || '/app/data/cc-proxy.sqlite',
    logFile: env.LOG_FILE || '',
    logLevel: env.LOG_LEVEL || 'info',
    useProviderModels: env.CC_USE_PROVIDER_MODELS !== 'false',
    modelRefreshIntervalMs: Number.parseInt(env.MODEL_REFRESH_INTERVAL_MS || '300000', 10),
    defaultReservationTokens: Number.parseInt(env.DEFAULT_RESERVATION_TOKENS || '8192', 10),
    defaultInputReservationTokens: Number.parseInt(env.DEFAULT_INPUT_RESERVATION_TOKENS || '4096', 10),
    maxReservationTokens: Number.parseInt(env.MAX_RESERVATION_TOKENS || '200000', 10),
    encryptionKey: env.ENCRYPTION_KEY || '',
    relayKeyPepper: env.RELAY_KEY_PEPPER || '',
    sessionSecret: env.SESSION_SECRET || '',
  };
}
