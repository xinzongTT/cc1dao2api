export const DEFAULT_COMMAND_CODE_CLI_VERSION = '0.43.1';
export const DEFAULT_COMMAND_CODE_CLI_USER_AGENT = 'cli';

export function commandCodeCliVersion(config = {}) {
  return config?.cliVersion || DEFAULT_COMMAND_CODE_CLI_VERSION;
}

export function commandCodeCliUserAgent(config = {}) {
  return config?.cliUserAgent || DEFAULT_COMMAND_CODE_CLI_USER_AGENT;
}

export function buildCommandCodeHeaders({ config, apiKey, contentType, projectSlug } = {}) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'x-cli-environment': 'production',
    'x-command-code-version': commandCodeCliVersion(config),
    'User-Agent': commandCodeCliUserAgent(config),
  };
  if (contentType) headers['Content-Type'] = contentType;
  if (projectSlug) headers['x-project-slug'] = projectSlug;
  return headers;
}
