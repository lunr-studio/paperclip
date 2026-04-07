#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Create an operator-grade backup for a single-VM Paperclip deployment.

This script:
1. Triggers a fresh Paperclip SQL backup inside the running container
2. Creates a GCE disk snapshot of the VM boot disk
3. Prints the newest SQL backup file and the created snapshot name

Usage:
  ./scripts/gcp-vm-backup.sh --project <project> --zone <zone> --instance <vm>

Optional flags:
  --paperclip-dir <dir>     Remote repo directory on the VM (default: ~/paperclip)
  --compose-file <file>     Compose file path relative to the repo dir (default: docker-compose.gcp.yml)
  --env-file <file>         Env file path relative to the repo dir (default: .env.gcp)
  --snapshot-prefix <name>  Snapshot name prefix (default: paperclip-vm)

Examples:
  ./scripts/gcp-vm-backup.sh \
    --project arctic-math-488714-c6 \
    --zone us-central1-a \
    --instance paperclip-vm
EOF
}

PROJECT_ID=""
ZONE=""
INSTANCE_NAME=""
PAPERCLIP_DIR="~/paperclip"
COMPOSE_FILE="docker-compose.gcp.yml"
ENV_FILE=".env.gcp"
SNAPSHOT_PREFIX="paperclip-vm"

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
    --snapshot-prefix)
      SNAPSHOT_PREFIX="${2:-}"
      shift 2
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

if [[ -z "$PROJECT_ID" || -z "$ZONE" || -z "$INSTANCE_NAME" ]]; then
  usage >&2
  exit 1
fi

timestamp="$(date -u +%Y%m%d%H%M%S)"
snapshot_name="${SNAPSHOT_PREFIX}-${timestamp}"

boot_disk="$(
  gcloud compute instances describe "$INSTANCE_NAME" \
    --project "$PROJECT_ID" \
    --zone "$ZONE" \
    --format='get(disks[0].source.basename())'
)"

if [[ -z "$boot_disk" ]]; then
  echo "Failed to resolve the boot disk for $INSTANCE_NAME." >&2
  exit 1
fi

echo "Triggering a fresh in-app SQL backup on ${INSTANCE_NAME}..."
gcloud compute ssh "$INSTANCE_NAME" \
  --project "$PROJECT_ID" \
  --zone "$ZONE" \
  --command "cd ${PAPERCLIP_DIR} && docker compose --env-file ${ENV_FILE} -f ${COMPOSE_FILE} exec -T -u node paperclip pnpm paperclipai db:backup"

latest_sql_backup="$(
  gcloud compute ssh "$INSTANCE_NAME" \
    --project "$PROJECT_ID" \
    --zone "$ZONE" \
    --command "cd ${PAPERCLIP_DIR} && docker compose --env-file ${ENV_FILE} -f ${COMPOSE_FILE} exec -T paperclip sh -lc 'ls -1t /paperclip/instances/default/data/backups | head -n 1'"
)"

echo "Creating GCE disk snapshot ${snapshot_name} from disk ${boot_disk}..."
gcloud compute disks snapshot "$boot_disk" \
  --project "$PROJECT_ID" \
  --zone "$ZONE" \
  --snapshot-names "$snapshot_name" \
  --labels "app=paperclip,instance=${INSTANCE_NAME}"

echo
echo "Backup complete."
echo "- VM: ${INSTANCE_NAME}"
echo "- Boot disk: ${boot_disk}"
echo "- Snapshot: ${snapshot_name}"
echo "- Latest SQL backup: ${latest_sql_backup}"
