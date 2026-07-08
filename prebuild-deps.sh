#!/bin/bash
# Installs node_modules OUTSIDE the Docker build (plain `docker run`, not a
# BuildKit RUN step), then snapshots that container into a local image
# (isl-deps-snapshot:latest) that the Dockerfile's deps stage COPYs from.
# See the comment in Dockerfile's deps stage for why: BuildKit RUN steps
# reliably died at ~328-330s on this network even with --network=host, while
# plain `docker run npm ci` reliably succeeds. The result is committed to an
# image (not `docker cp`'d to the Windows host) because node_modules/.bin
# contains Unix symlinks that Windows can't recreate without elevated
# privilege.
#
# Run this whenever package.json or package-lock.json changes, before
# `docker compose build`.
set -e
cd "$(dirname "$0")"

mkdir -p docker-deps
cp package.json docker-deps/
cp package-lock.json docker-deps/

WIN_PATH=$(cygpath -w "$(pwd)/docker-deps" 2>/dev/null || echo "$(pwd)/docker-deps")
docker rm -f npm-prebuild >/dev/null 2>&1 || true

echo "Installing dependencies via docker run (this can take several minutes on this network)..."
MSYS_NO_PATHCONV=1 docker run --name npm-prebuild -v "$WIN_PATH:/app" -w //app node:20-alpine \
  npm ci

echo "Snapshotting into isl-deps-snapshot:latest..."
docker commit npm-prebuild isl-deps-snapshot:latest
docker rm -f npm-prebuild >/dev/null 2>&1

echo "Done: isl-deps-snapshot:latest is ready. You can now run: docker compose build"
