# syntax=docker/dockerfile:1
# One image for every Node service in compose.yaml: the Discord share page,
# the API and its migration job, and (P4) the Discord bot. Built and pushed to GHCR by
# .github/workflows/image.yml; Coolify only pulls it, so the small VPS never
# installs the dev toolchain (wrangler, workerd, vitest).

FROM node:24-alpine3.22 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
RUN npm ci --workspace server --ignore-scripts
COPY server server
# The API is the Worker's own code (worker/, shared/), bundled into the server.
COPY worker worker
COPY shared shared
RUN npm run build --workspace server

FROM node:24-alpine3.22 AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
RUN npm ci --workspace server --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY server/share-public server/share-public
COPY server/migrations server/migrations
# Mount point for the app-data volume; a fresh named volume takes this owner.
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8787
# Exec form, so SIGTERM reaches node (graceful shutdown in server/src/main.ts).
CMD ["node", "--enable-source-maps", "server/dist/main.js"]
