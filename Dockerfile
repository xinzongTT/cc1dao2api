FROM node:22-alpine AS build

WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3050 \
    HOST=0.0.0.0 \
    DATABASE_PATH=/app/data/cc-proxy.sqlite

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist
COPY --from=build /app/proxy.mjs ./proxy.mjs

RUN mkdir -p /app/data

EXPOSE 3050
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --spider http://127.0.0.1:3050/health || exit 1

CMD ["node", "server/index.mjs"]
