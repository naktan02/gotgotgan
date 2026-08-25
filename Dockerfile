FROM node:22.23.2-alpine3.24@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS dependencies

WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY backend/package.json ./backend/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN npm ci

FROM dependencies AS web-build
COPY apps/web ./apps/web
RUN npm run build:web

FROM node:22.23.2-alpine3.24@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS web-runtime

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=web-build --chown=node:node /workspace/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /workspace/apps/web/.next/static ./apps/web/.next/static
USER node
CMD ["node", "apps/web/server.js"]

FROM dependencies AS backend-build
COPY backend ./backend
RUN npm run build:backend

FROM node:22.23.2-alpine3.24@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS backend-production-dependencies

WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY backend/package.json ./backend/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN npm ci --omit=dev --workspace @place/backend --include-workspace-root

FROM node:22.23.2-alpine3.24@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS backend-runtime

ENV NODE_ENV=production
WORKDIR /app
COPY --from=backend-production-dependencies --chown=node:node /workspace/node_modules ./node_modules
COPY --from=backend-build --chown=node:node /workspace/backend/dist ./backend/dist
COPY --from=backend-build --chown=node:node /workspace/backend/package.json ./backend/package.json
USER node
CMD ["node", "backend/dist/entrypoints/http/main.js"]
