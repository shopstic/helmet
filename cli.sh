#!/usr/bin/env bash
set -euo pipefail

ENTRY_FILE="./src/helmet.ts"
MOD_FILE="./src/mod.ts"

code_quality() {
  echo "Checking formatting..."
  deno fmt --check ./src
  echo "Linting..."
  deno lint ./src
  # echo "Runnning tests..."
  # deno test -A
}

auto_fmt() {
  deno fmt ./src
}

set_version() {
  local VERSION=${1:-"latest"}
  printf "%s\n" "export default \"${VERSION}\";" > ./src/version.ts
}

create_release() {
  local RELEASE_VERSION=${1:?"Release version is required"}
  local RELEASE_BRANCH="releases/${RELEASE_VERSION}"

  git config --global user.email "ci-runner@shopstic.com"
  git config --global user.name "CI Runner"
  git checkout -b "${RELEASE_BRANCH}"

  git add ./src/version.ts
  git commit -m "Release ${RELEASE_VERSION}"
  git push origin "${RELEASE_BRANCH}"

  gh release create "${RELEASE_VERSION}" --title "Release ${RELEASE_VERSION}" --notes "" --target "${RELEASE_BRANCH}"
}

build() {
  local VERSION=${1:-"latest"}
  local OUTPUT=${2:-$(mktemp -d)}

  printf "%s\n" "export default \"${VERSION}\";" > ./src/version.ts
  deno bundle --lock ./deno.lock "${ENTRY_FILE}" "${OUTPUT}/helmet.js"
}

install() {
  local VERSION=${1:-"latest"}
  local OUTPUT=${2:-$(mktemp -d)}

  "$0" build "${VERSION}" "${OUTPUT}"
  deno install --unstable -A -f "${OUTPUT}/helmet.js"
}

update_cache() {
  deno cache "${ENTRY_FILE}" "${MOD_FILE}" 
}

update_lock() {
  deno cache --reload --lock=deno.lock --lock-write "${ENTRY_FILE}" "${MOD_FILE}"
}

run() {
  deno run --lock ./deno.lock --cached-only -A --check --unstable "${ENTRY_FILE}" "$@"
}

"$@"