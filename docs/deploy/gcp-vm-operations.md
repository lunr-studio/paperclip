---
title: GCP VM Operations
summary: Backup, reboot, health-check, and recovery runbook for a single-VM Paperclip deployment
---

Use this runbook to operate the single-VM GCP deployment described in [GCP VM with Codex ChatGPT Login](/Users/trishan/Documents/paperclip/docs/deploy/gcp-vm-codex-chatgpt.md).

## What You Need to Protect

The live single-VM deployment stores its durable state in three places:

- `/opt/paperclip/data` for the Paperclip instance, embedded PostgreSQL, SQL backups, run logs, uploaded assets, and shared Codex auth
- `/opt/paperclip/caddy-data` for TLS certificates
- `/opt/paperclip/caddy-config` for Caddy runtime state

Inside `/opt/paperclip/data`, the most important paths are:

- `/paperclip/instances/default/db`
- `/paperclip/instances/default/data/backups`
- `/paperclip/instances/default/config.json`
- `/paperclip/.codex`

## Backup Strategy

Use a layered backup strategy:

1. Let Paperclip keep generating its in-app SQL backups under `/paperclip/instances/default/data/backups`.
2. Before maintenance or after meaningful configuration changes, trigger a fresh SQL backup manually.
3. Take a GCE disk snapshot of the VM boot disk so you capture the full single-VM state, including `/opt/paperclip/data`, `/opt/paperclip/caddy-data`, and `/opt/paperclip/caddy-config`.

This repo now includes an operator script for that workflow:

```sh
./scripts/gcp-vm-backup.sh \
  --project arctic-math-488714-c6 \
  --zone us-central1-a \
  --instance paperclip-vm
```

What it does:

- runs `pnpm paperclipai db:backup` inside the live `paperclip` container
- prints the newest SQL backup filename
- resolves the VM boot disk automatically
- creates a named GCE snapshot of that disk

## Standard Health Check

Use the tracked operator script:

```sh
./scripts/gcp-vm-healthcheck.sh \
  --project arctic-math-488714-c6 \
  --zone us-central1-a \
  --instance paperclip-vm \
  --url https://paperclip.34-173-2-204.sslip.io
```

Add `--tail-logs` if you also want the recent `paperclip` and `caddy` container logs.

After a reboot or redeploy, add `--wait-seconds 120` so the script waits through the brief reverse-proxy `502` window while the app is still starting:

```sh
./scripts/gcp-vm-healthcheck.sh \
  --project arctic-math-488714-c6 \
  --zone us-central1-a \
  --instance paperclip-vm \
  --url https://paperclip.34-173-2-204.sslip.io \
  --wait-seconds 120
```

The standard healthy result is:

- `GET /api/health` returns `{"status":"ok", ...}`
- `docker compose ps` shows both `paperclip` and `caddy` as `Up`
- recent SQL backups are present in `/paperclip/instances/default/data/backups`

## Manual Commands

If you need to inspect the VM manually:

```sh
gcloud compute ssh paperclip-vm --project arctic-math-488714-c6 --zone us-central1-a
cd ~/paperclip
docker compose --env-file .env.gcp -f docker-compose.gcp.yml ps
docker compose --env-file .env.gcp -f docker-compose.gcp.yml logs --tail=100 paperclip caddy
curl -fsSL https://paperclip.34-173-2-204.sslip.io/api/health
```

To inspect the newest in-app SQL backups:

```sh
docker compose --env-file .env.gcp -f docker-compose.gcp.yml exec -T paperclip \
  sh -lc 'ls -lt /paperclip/instances/default/data/backups | sed -n "1,10p"'
```

## Reboot Validation

For a controlled restart test:

```sh
gcloud compute ssh paperclip-vm \
  --project arctic-math-488714-c6 \
  --zone us-central1-a \
  --command 'sudo systemctl reboot' || true
```

Then wait for SSH to recover and re-run the health check:

```sh
./scripts/gcp-vm-healthcheck.sh \
  --project arctic-math-488714-c6 \
  --zone us-central1-a \
  --instance paperclip-vm \
  --url https://paperclip.34-173-2-204.sslip.io \
  --wait-seconds 120
```

The reboot test passes if:

- the VM accepts SSH again
- both containers come back without manual intervention
- Caddy still serves valid HTTPS
- the public health endpoint returns `status=ok`

During the first few seconds after reboot, Caddy may return a brief `502` while the backend is still starting. Treat that as expected startup behavior as long as the waiting health check succeeds within the timeout window.

## Restore Outline

If the VM becomes unrecoverable:

1. Identify the latest good GCE disk snapshot created by [gcp-vm-backup.sh](/Users/trishan/Documents/paperclip/scripts/gcp-vm-backup.sh).
2. Create a replacement disk from that snapshot.
3. Attach the replacement disk to a new VM or restore the boot disk in place.
4. Reattach the reserved static IP and the same firewall tags.
5. SSH into the restored VM and run the health check script.

Because the boot disk snapshot contains `/opt/paperclip/data` and the Caddy state directories, this restores the application data, Codex auth, and TLS material together.
