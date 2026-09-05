FROM node:22.23.2-alpine3.24@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS dependencies

WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/admin-web/package.json ./apps/admin-web/package.json
COPY apps/member-connector/package.json ./apps/member-connector/package.json
COPY backend/package.json ./backend/package.json
COPY packages/browser-auth/package.json ./packages/browser-auth/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY vendor ./vendor
COPY .tools ./.tools
RUN npm ci --workspace @place/web --workspace @place/admin-web --workspace @place/backend \
    --workspace @place/contracts --workspace @place/browser-auth --include-workspace-root

FROM dependencies AS contracts-build
COPY packages/contracts ./packages/contracts
RUN npm run build:contracts

FROM contracts-build AS browser-auth-build
COPY packages/browser-auth ./packages/browser-auth
RUN npm run build:browser-auth

FROM browser-auth-build AS web-build
COPY apps/web ./apps/web
RUN npm run build --workspace @place/web

FROM node:22.23.2-alpine3.24@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS web-runtime

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=web-build --chown=node:node /workspace/apps/web/.next/standalone ./
COPY --from=web-build --chown=node:node /workspace/apps/web/.next/static ./apps/web/.next/static
COPY --from=web-build --chown=node:node /workspace/apps/web/public ./apps/web/public
USER node
CMD ["node", "apps/web/server.js"]

FROM browser-auth-build AS admin-web-build
COPY apps/admin-web ./apps/admin-web
RUN npm run build --workspace @place/admin-web

FROM node:22.23.2-alpine3.24@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS admin-web-runtime

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=admin-web-build --chown=node:node /workspace/apps/admin-web/.next/standalone ./
COPY --from=admin-web-build --chown=node:node /workspace/apps/admin-web/.next/static ./apps/admin-web/.next/static
USER node
CMD ["node", "apps/admin-web/server.js"]

FROM contracts-build AS backend-build
COPY backend ./backend
RUN npm run build --workspace @place/backend

FROM node:22.23.2-alpine3.24@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS backend-production-dependencies

WORKDIR /workspace
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/admin-web/package.json ./apps/admin-web/package.json
COPY apps/member-connector/package.json ./apps/member-connector/package.json
COPY backend/package.json ./backend/package.json
COPY packages/browser-auth/package.json ./packages/browser-auth/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY vendor ./vendor
RUN npm ci --omit=dev --workspace @place/backend --include-workspace-root

FROM node:22.23.2-alpine3.24@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS backend-runtime

ENV NODE_ENV=production
WORKDIR /app
COPY --from=backend-production-dependencies --chown=node:node /workspace/node_modules ./node_modules
COPY --from=backend-build --chown=node:node /workspace/backend/dist ./backend/dist
COPY --from=backend-build --chown=node:node /workspace/backend/package.json ./backend/package.json
COPY --chown=node:node backend/migrations ./backend/migrations
COPY --chown=node:node deploy/database-runtime.json ./deploy/database-runtime.json
COPY --from=backend-build --chown=node:node /workspace/packages/contracts/dist ./packages/contracts/dist
COPY --from=backend-build --chown=node:node /workspace/packages/contracts/package.json ./packages/contracts/package.json
RUN mkdir -p /var/lib/place/captures
RUN chown node:node /var/lib/place/captures
RUN chmod 0700 /var/lib/place/captures
USER node
CMD ["node", "backend/dist/entrypoints/http/main.js"]
