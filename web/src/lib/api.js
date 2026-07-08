let csrfToken = '';

async function request(path, options = {}) {
  const headers = {
    Accept: 'application/json',
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    ...options.headers,
  };
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  if (payload?.csrfToken) csrfToken = payload.csrfToken;
  return { status: response.status, ok: response.ok, payload };
}

export const api = {
  async session() {
    return request('/admin/api/session');
  },
  async init(credentials) {
    return request('/admin/api/auth/init', { method: 'POST', body: credentials });
  },
  async login(credentials) {
    return request('/admin/api/auth/login', { method: 'POST', body: credentials });
  },
  async logout() {
    return request('/admin/api/auth/logout', { method: 'POST' });
  },
  async get(path) {
    return request(path);
  },
  async post(path, body) {
    return request(path, { method: 'POST', body });
  },
  async patch(path, body) {
    return request(path, { method: 'PATCH', body });
  },
  async delete(path) {
    return request(path, { method: 'DELETE' });
  },
};
