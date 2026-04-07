#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${1:-$ROOT_DIR/.env.gcp}"
DOCKERFILE="$ROOT_DIR/Dockerfile"
UNTRUSTED_DOCKERFILE="$ROOT_DIR/docker/untrusted-review/Dockerfile"
COMPOSE_FILE="$ROOT_DIR/docker-compose.gcp.yml"
CADDY_FILE="$ROOT_DIR/deploy/Caddyfile"
ENV_TEMPLATE="$ROOT_DIR/.env.gcp.example"

require_file() {
  local file="$1"

  if [[ ! -f "$file" ]]; then
    echo "Missing required file: $file" >&2
    exit 1
  fi
}

assert_contains() {
  local file="$1"
  local pattern="$2"
  local description="$3"

  if ! grep -Fq "$pattern" "$file"; then
    echo "Expected $description in $file" >&2
    exit 1
  fi
}

stat_mode() {
  local file="$1"

  if stat -f '%Lp' "$file" >/dev/null 2>&1; then
    stat -f '%Lp' "$file"
    return
  fi

  stat -c '%a' "$file"
}

require_file "$DOCKERFILE"
require_file "$UNTRUSTED_DOCKERFILE"
require_file "$COMPOSE_FILE"
require_file "$CADDY_FILE"
require_file "$ENV_TEMPLATE"

if grep -Fq '@latest' "$DOCKERFILE"; then
  echo "Production Dockerfile still contains floating @latest installs." >&2
  exit 1
fi

if grep -Fq '@latest' "$UNTRUSTED_DOCKERFILE"; then
  echo "Untrusted review Dockerfile still contains floating @latest installs." >&2
  exit 1
fi

assert_contains "$DOCKERFILE" '@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}' "pinned Claude Code install"
assert_contains "$DOCKERFILE" '@openai/codex@${CODEX_CLI_VERSION}' "pinned Codex install"
assert_contains "$DOCKERFILE" 'opencode-ai@${OPENCODE_VERSION}' "pinned OpenCode install"
assert_contains "$UNTRUSTED_DOCKERFILE" '@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}' "pinned Claude Code install"
assert_contains "$UNTRUSTED_DOCKERFILE" '@openai/codex@${CODEX_CLI_VERSION}' "pinned Codex install"
assert_contains "$COMPOSE_FILE" './deploy/Caddyfile:/etc/caddy/Caddyfile:ro' "tracked Caddyfile mount"
assert_contains "$COMPOSE_FILE" '${PAPERCLIP_DATA_DIR:-/opt/paperclip/data}:/paperclip' "persistent Paperclip data mount"
assert_contains "$CADDY_FILE" '{$PAPERCLIP_HOSTNAME}' "hostname-driven Caddy site block"
assert_contains "$ENV_TEMPLATE" 'PAPERCLIP_HOSTNAME=' "hostname entry in the env template"

if [[ -f "$ENV_FILE" ]]; then
  env_mode="$(stat_mode "$ENV_FILE")"
  if [[ "$env_mode" != "600" && "$env_mode" != "400" ]]; then
    echo "Expected $ENV_FILE permissions to be 600 or 400, got $env_mode." >&2
    exit 1
  fi
else
  echo "Note: $ENV_FILE does not exist yet; skipping secret-permission check."
fi

cat <<EOF
GCP deployment assets verified:
- tracked compose file: $COMPOSE_FILE
- tracked Caddyfile: $CADDY_FILE
- tracked env template: $ENV_TEMPLATE
- pinned production CLI installs in: $DOCKERFILE
- pinned review CLI installs in: $UNTRUSTED_DOCKERFILE
EOF
