#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Run the standard health checks for a single-VM Paperclip deployment.

Usage:
  ./scripts/gcp-vm-healthcheck.sh \
    --project <project> \
    --zone <zone> \
    --instance <vm> \
    --url <public-url>

Optional flags:
  --paperclip-dir <dir>   Remote repo directory on the VM (default: ~/paperclip)
  --compose-file <file>   Compose file path relative to the repo dir (default: docker-compose.gcp.yml)
  --env-file <file>       Env file path relative to the repo dir (default: .env.gcp)
  --wait-seconds <n>      Poll the public health endpoint for up to n seconds before failing
  --tail-logs             Include the last 40 lines of paperclip/caddy logs
EOF
}

PROJECT_ID=""
ZONE=""
INSTANCE_NAME=""
PUBLIC_URL=""
PAPERCLIP_DIR="~/paperclip"
COMPOSE_FILE="docker-compose.gcp.yml"
ENV_FILE=".env.gcp"
WAIT_SECONDS=0
TAIL_LOGS=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project)
      PROJECT_ID="${2:-}"
      shift 2
      ;;
    --zone)
      ZONE="${2:-}"
      shift 2
      ;;
    --instance)
      INSTANCE_NAME="${2:-}"
      shift 2
      ;;
    --url)
      PUBLIC_URL="${2:-}"
      shift 2
      ;;
    --paperclip-dir)
      PAPERCLIP_DIR="${2:-}"
      shift 2
      ;;
    --compose-file)
      COMPOSE_FILE="${2:-}"
      shift 2
      ;;
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --wait-seconds)
      WAIT_SECONDS="${2:-}"
      shift 2
      ;;
    --tail-logs)
      TAIL_LOGS=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$PROJECT_ID" || -z "$ZONE" || -z "$INSTANCE_NAME" || -z "$PUBLIC_URL" ]]; then
  usage >&2
  exit 1
fi

wait_for_health() {
  local deadline=$((SECONDS + WAIT_SECONDS))
  local url="${PUBLIC_URL%/}/api/health"

  while true; do
    if health_payload="$(curl -fsSL "$url" 2>/dev/null)"; then
      printf '%s' "$health_payload"
      return 0
    fi

    if (( WAIT_SECONDS == 0 || SECONDS >= deadline )); then
      return 1
    fi

    sleep 5
  done
}

if ! health_payload="$(wait_for_health)"; then
  echo "Public health check failed for ${PUBLIC_URL%/}/api/health" >&2
  exit 1
fi

echo "Public health endpoint:"
echo "$health_payload"
echo

echo "Remote container status:"
gcloud compute ssh "$INSTANCE_NAME" \
  --project "$PROJECT_ID" \
  --zone "$ZONE" \
  --command "cd ${PAPERCLIP_DIR} && docker compose --env-file ${ENV_FILE} -f ${COMPOSE_FILE} ps"

echo
echo "Latest SQL backups:"
gcloud compute ssh "$INSTANCE_NAME" \
  --project "$PROJECT_ID" \
  --zone "$ZONE" \
  --command "cd ${PAPERCLIP_DIR} && docker compose --env-file ${ENV_FILE} -f ${COMPOSE_FILE} exec -T paperclip sh -lc 'ls -lt /paperclip/instances/default/data/backups | sed -n \"1,6p\"'"

if [[ "$TAIL_LOGS" == "true" ]]; then
  echo
  echo "Recent container logs:"
  gcloud compute ssh "$INSTANCE_NAME" \
    --project "$PROJECT_ID" \
    --zone "$ZONE" \
    --command "cd ${PAPERCLIP_DIR} && docker compose --env-file ${ENV_FILE} -f ${COMPOSE_FILE} logs --tail=40 paperclip caddy"
fi
