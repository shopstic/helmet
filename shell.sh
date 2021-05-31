#!/usr/bin/env bash
set -euo pipefail

SHELL_NAME=${SHELL_NAME:-"helmet-shell"}
export DOCKER_SCAN_SUGGEST=false
export DOCKER_BUILDKIT=1

TEMP_FILE=$(mktemp)
trap "rm -f ${TEMP_FILE}" EXIT

docker build ./images/shell --iidfile "${TEMP_FILE}"
IMAGE_ID=$(cat "${TEMP_FILE}")

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