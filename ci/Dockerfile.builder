FROM node:22.23.2-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9 AS node
FROM docker:28.4.0-cli@sha256:6a73c9433f2ba4279815be1e60f5739288b939dda1e48151d8c393537802de37 AS docker
FROM python:3.12.14-slim-trixie@sha256:876416ecde9aca2bcc90e1fb0c7a9500bbf749f5788b70f82d4c5a5c2357f8b4
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker /usr/local/libexec/docker/cli-plugins /usr/local/libexec/docker/cli-plugins
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm
WORKDIR /tools
COPY .node-version .npm-version .python-version ./
RUN test "$(node -p process.versions.node)" = "$(cat .node-version)" \
    && test "$(npm --version)" = "$(cat .npm-version)" \
    && test "$(python -c 'import platform; print(platform.python_version())')" = "$(cat .python-version)"
ENV PYTHONDONTWRITEBYTECODE=1 NEXT_TELEMETRY_DISABLED=1
USER 1000:1000
WORKDIR /work
ENTRYPOINT ["python"]
