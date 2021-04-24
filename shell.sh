#!/usr/bin/env bash
set -euo pipefail

SHELL_NAME=${SHELL_NAME:-"helmet-shell"}
export DOCKER_BUILDKIT=1

docker build ./images/shell
IMAGE_ID=$(docker build -q ./images/shell | head -n1)

docker run \
  -it --rm \
  --privileged \
  --hostname="${SHELL_NAME}" \
  --init \
  -v "${HOME}/.kube:/root/.kube" \
  -v "${DENO_DIR}:/root/.cache/deno" \
  -e "DENO_DIR=/root/.cache/deno" \
  -v "${PWD}:${PWD}" \
  -w "${PWD}" \
  "${IMAGE_ID}" \
  bash -l