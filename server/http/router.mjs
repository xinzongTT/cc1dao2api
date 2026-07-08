export function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(payload));
}

export function createRouter() {
  const routes = [];
  return {
    add(method, path, handler) {
      routes.push({ method, path, handler });
    },
    async handle(req, res) {
      const host = req.headers?.host || 'localhost';
      const url = new URL(req.url, `http://${host}`);
      const route = routes.find((candidate) => (
        candidate.method === req.method && candidate.path === url.pathname
      ));
      if (!route) {
        return sendJson(res, 404, { error: { message: 'Not found', type: 'not_found' } });
      }
      return route.handler(req, res, url);
    },
  };
}
