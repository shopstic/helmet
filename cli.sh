#!/usr/bin/env bash
set -euo pipefail

ENTRY_FILE="./src/helmet.ts"
MOD_FILE="./src/mod.ts"

code_quality() {
  echo "Checking formatting..."
  deno fmt --check ./src
  echo "Linting..."
  deno lint ./src
  echo "Running eslint..."
  eslint .
}

auto_fmt() {
  deno fmt ./src
}

set_version() {
  local VERSION=${1:-"dev"}
  local JSR_JSON
  JSR_JSON=$(jq -e --arg VERSION "${VERSION}" '.version=$VERSION' ./deno.json)
  echo "${JSR_JSON}" >./deno.json
}

jsr_publish() {
  deno publish --config ./deno.json --allow-slow-types --allow-dirty
}

create_release() {
  local RELEASE_VERSION=${1:?"Release version is required"}
  local RELEASE_BRANCH="releases/${RELEASE_VERSION}"

  git config --global user.email "ci-runner@shopstic.com"
  git config --global user.name "CI Runner"
  git checkout -b "${RELEASE_BRANCH}"

  git add ./deno.json
  git commit -m "Release ${RELEASE_VERSION}"
  git push origin "${RELEASE_BRANCH}"

  gh release create "${RELEASE_VERSION}" --title "Release ${RELEASE_VERSION}" --notes "" --target "${RELEASE_BRANCH}"
}

update_cache() {
  deno cache "${ENTRY_FILE}" "${MOD_FILE}"
}

update_lock() {
  rm -f deno.lock
  deno cache --reload --lock=deno.lock --lock-write "${ENTRY_FILE}" "${MOD_FILE}"
}

run() {
  deno run --lock ./deno.lock --cached-only -A --check "${ENTRY_FILE}" "$@"
}

"$@"
