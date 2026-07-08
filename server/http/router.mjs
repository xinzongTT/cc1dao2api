export function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(payload));
}

export function createRouter() {
  const routes = [];
  let notFoundHandler = null;
  function matchPath(routePath, requestPath) {
    const routeParts = routePath.split('/').filter(Boolean);
    const requestParts = requestPath.split('/').filter(Boolean);
    if (routeParts.length !== requestParts.length) return null;
    const params = {};
    for (let index = 0; index < routeParts.length; index += 1) {
      const routePart = routeParts[index];
      const requestPart = requestParts[index];
      if (routePart.startsWith(':')) {
        params[routePart.slice(1)] = decodeURIComponent(requestPart);
      } else if (routePart !== requestPart) {
        return null;
      }
    }
    return params;
  }

  return {
    add(method, path, handler) {
      routes.push({ method, path, handler });
    },
    setNotFound(handler) {
      notFoundHandler = handler;
    },
    async handle(req, res) {
      const host = req.headers?.host || 'localhost';
      const url = new URL(req.url, `http://${host}`);
      let route = null;
      let params = null;
      for (const candidate of routes) {
        if (candidate.method !== req.method) continue;
        params = matchPath(candidate.path, url.pathname);
        if (params) {
          route = candidate;
          break;
        }
      }
      if (!route) {
        if (notFoundHandler && await notFoundHandler(req, res, url)) return undefined;
        return sendJson(res, 404, { error: { message: 'Not found', type: 'not_found' } });
      }
      req.params = params;
      return route.handler(req, res, url, params);
    },
  };
}
