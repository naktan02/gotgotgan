FROM node:22.23.2-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9 AS node
FROM python:3.12.14-slim-trixie@sha256:876416ecde9aca2bcc90e1fb0c7a9500bbf749f5788b70f82d4c5a5c2357f8b4
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
COPY ci/debian-snapshot.sources /etc/apt/sources.list.d/debian.sources
RUN apt-get update && apt-get install -y --no-install-recommends git=1:2.47.3-0+deb13u1 && rm -rf /var/lib/apt/lists/*
WORKDIR /tools/source
COPY . .
ENV npm_config_cache=/tools/npm-cache
RUN npm ci --ignore-scripts --no-audit --no-fund \
    && PLAYWRIGHT_BROWSERS_PATH=/tools/browsers node node_modules/playwright/cli.js install --with-deps chromium \
    && python ci/check.py --inputs > /tools/input.sha256 \
    && chmod -R a+rX /tools
ENV PYTHONDONTWRITEBYTECODE=1 NEXT_TELEMETRY_DISABLED=1
USER 1000:1000
WORKDIR /work
ENTRYPOINT ["python"]
