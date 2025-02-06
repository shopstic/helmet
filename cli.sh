#!/usr/bin/env bash
set -euo pipefail
shopt -s globstar

ENTRY_FILE="./src/cli.ts"
MOD_FILE="./src/mod.ts"

update_deps() {
  local pkg
  pkg=$(jq -er '.imports["@wok/deup"]' <deno.json) || exit $?
  deno run -A "${pkg}" update "$@"
  "$0" update_lock
}

update_lock() {
  rm -f deno.lock
  deno cache --reload --lock=deno.lock --frozen=false "${ENTRY_FILE}" "${MOD_FILE}"
}

check_all() {
  deno check ./**/*.ts
}

code_quality() {
  echo "Checking formatting..."
  deno fmt --check ./src
  echo "Checking types..."
  "$0" check_all
  echo "Linting..."
  deno lint ./src
  echo "Running eslint..."
  eslint .
}

auto_fmt() {
  deno fmt ./src
}

set_version() {
  local version=${1:-"dev"}
  local jsr_json
  jsr_json=$(jq -e --arg VERSION "${version}" '.version=$VERSION' ./deno.json)
  echo "${jsr_json}" >./deno.json
}

jsr_publish() {
  deno publish --config ./deno.json --allow-slow-types --allow-dirty
}

create_release() {
  local release_version=${1:?"Release version is required"}
  local release_branch="releases/${release_version}"

  git config --global user.email "ci-runner@shopstic.com"
  git config --global user.name "CI Runner"
  git checkout -b "${release_branch}"

  git add ./deno.json
  git commit -m "Release ${release_version}"
  git push origin "${release_branch}"

  gh release create "${release_version}" --title "Release ${release_version}" --notes "" --target "${release_branch}"
}

update_cache() {
  deno cache "${ENTRY_FILE}" "${MOD_FILE}"
}

run() {
  deno run --lock ./deno.lock --cached-only -A --check "${ENTRY_FILE}" "$@"
}

"$@"
