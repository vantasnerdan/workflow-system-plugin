#!/usr/bin/env bash
# Copies the plugin source from a checkout of the workflow system into this repository:
#   scripts/sync-from-system.sh <path to the workflow system checkout> [git ref, default main]
# Copied: plugins/mcp, plugins/claude-code, plugins/.claude-plugin, packages/client, docs/agent-interface.md,
# and a fresh packages/client/openapi.json. Not copied: the tests that need the whole system
# (plugins/mcp/test/live-site*). Kept from here: the small fallback in packages/client/codegen/generate.ts
# that reads openapi.json (re-apply it if the copy overwrote it; `pnpm test` fails without it).
# Afterwards: pnpm install && pnpm bundle && pnpm check && pnpm test, then review `git diff` before committing.
set -euo pipefail
src=${1:?give the path to the workflow system checkout}
ref=${2:-main}
here=$(cd "$(dirname "$0")/.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
git -C "$src" archive "$ref" plugins/mcp plugins/claude-code plugins/.claude-plugin packages/client docs/agent-interface.md | tar -x -C "$tmp"
rm -f "$tmp"/plugins/mcp/test/live-site.db.test.ts "$tmp"/plugins/mcp/test/live-site.ts
cp "$here/packages/client/codegen/generate.ts" "$tmp/generate.keep"
for d in plugins/mcp plugins/claude-code plugins/.claude-plugin packages/client; do
  rm -rf "${here:?}/$d"
  mkdir -p "$here/$d"
  cp -a "$tmp/$d/." "$here/$d/"
done
cp "$tmp/docs/agent-interface.md" "$here/docs/agent-interface.md"
if ! grep -q "openapi.json" "$here/packages/client/codegen/generate.ts"; then
  echo "note: packages/client/codegen/generate.ts was replaced; its openapi.json fallback must be re-applied (previous copy: see git diff)." >&2
fi
if [ -f "$src/packages/contract/src/openapi.ts" ]; then
  echo "Writing packages/client/openapi.json from the checkout's working tree (make sure it is on $ref)." >&2
  (cd "$src/packages/contract" && node src/openapi.ts) > "$here/packages/client/openapi.json"
fi
echo "Synced from $src at $ref. Now: pnpm install && pnpm bundle && pnpm check && pnpm test" >&2
