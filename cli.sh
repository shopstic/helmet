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

build() {
  local VERSION=${1:-"latest"}
  printf "%s\n" "export default \"${VERSION}\";" > ./src/version.ts
  deno bundle "${ENTRY_FILE}" --lock ./lock.json ./images/release/helmet.js
}

update_cache() {
  deno cache --lock=lock.json "${ENTRY_FILE}" "${MOD_FILE}" 
}

update_lock() {
  deno cache "${ENTRY_FILE}" "${MOD_FILE}"  --lock ./lock.json --lock-write
}

run() {
  deno run --lock ./lock.json --cached-only -A --unstable "${ENTRY_FILE}" "$@"
}

"$@"