export function parseCookies(header = '') {
  return Object.fromEntries((header || '')
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const splitAt = part.indexOf('=');
      if (splitAt === -1) return [decodeURIComponent(part), ''];
      return [
        decodeURIComponent(part.slice(0, splitAt).trim()),
        decodeURIComponent(part.slice(splitAt + 1).trim()),
      ];
    }));
}

export function serializeCookie(name, value, options = {}) {
  const parts = [`${encodeURIComponent(name)}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.trunc(options.maxAge)}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join('; ');
}
