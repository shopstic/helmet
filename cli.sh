#!/usr/bin/env bash
set -euo pipefail

code_quality() {
  echo "Checking formatting..."
  deno fmt --unstable --check ./src
  echo "Linting..."
  deno lint --unstable ./src
  # echo "Runnning tests..."
  # deno test -A
}

build() {
  local VERSION=${1:-"latest"}
  printf "%s\n" "export default \"${VERSION}\";" > ./src/version.ts
  deno compile -A --unstable --lite -o ./images/release/helmet ./src/helmet.ts
}

run() {
  deno run -A --unstable ./src/helmet.ts "$@"
}

"$@"