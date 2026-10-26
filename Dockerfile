# syntax=docker/dockerfile:1
# One image for every Node service in compose.yaml: the Discord share page now,
# the API (P3a) and the Discord bot (P4) later. Built and pushed to GHCR by
# .github/workflows/image.yml; Coolify only pulls it, so the small VPS never
# installs the dev toolchain (wrangler, workerd, vitest).

FROM node:24-alpine3.22 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
RUN npm ci --workspace server --ignore-scripts
COPY server server
RUN npm run build --workspace server

FROM node:24-alpine3.22 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
RUN npm ci --workspace server --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY server/share-public server/share-public
USER node
EXPOSE 8787
# Exec form, so SIGTERM reaches node (graceful shutdown in server/src/main.ts).
CMD ["node", "--enable-source-maps", "server/dist/main.js"]
