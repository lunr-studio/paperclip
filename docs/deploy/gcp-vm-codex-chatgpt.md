---
title: GCP VM with Codex ChatGPT Login
summary: Run Paperclip on a single GCP VM with Docker, Caddy, and native Codex login
---

Deploy Paperclip on a single Google Cloud VM with public HTTPS, persistent local storage, and `codex_local` authenticated through your ChatGPT/Codex account instead of `OPENAI_API_KEY`.

## Architecture

This setup uses:

- one GCP Compute Engine VM
- Docker Compose for Paperclip and Caddy
- embedded PostgreSQL on the VM disk
- local disk storage for uploads, workspaces, and secrets
- Caddy for automatic HTTPS
- Codex CLI login stored on the persistent Paperclip volume

This is the simplest internet-facing deployment that still supports login, TLS, and durable Codex authentication across restarts.

## Recommended Runtime Shape

- VM: `e2-standard-2`
- Disk: `50 GB` SSD
- Public ports: `80`, `443`
- Paperclip app port: `3100` behind Caddy
- Deployment mode: `authenticated`
- Exposure: `public`
- Public URL: `https://paperclip.<STATIC_IP_WITH_DASHES>.sslip.io`

## 1. Provision the VM

Reserve a static IP, create the VM, and allow inbound `80` and `443`.

```sh
PROJECT_ID=your-gcp-project
REGION=us-central1
ZONE=us-central1-a
MY_IP=your.public.ip.addr/32

gcloud config set project "$PROJECT_ID"
gcloud compute addresses create paperclip-ip --region "$REGION"
IP=$(gcloud compute addresses describe paperclip-ip --region "$REGION" --format='value(address)')

gcloud compute firewall-rules create paperclip-web \
  --allow tcp:80,tcp:443 \
  --target-tags paperclip-web \
  --source-ranges 0.0.0.0/0

gcloud compute firewall-rules create paperclip-ssh \
  --allow tcp:22 \
  --target-tags paperclip-web \
  --source-ranges "$MY_IP"

gcloud compute instances create paperclip-vm \
  --zone "$ZONE" \
  --machine-type e2-standard-2 \
  --boot-disk-size 50GB \
  --boot-disk-type pd-ssd \
  --image-family ubuntu-2404-lts-amd64 \
  --image-project ubuntu-os-cloud \
  --tags paperclip-web \
  --address "$IP"
```

Build the hostname from the reserved IP. For example, `34.123.45.67` becomes:

```txt
paperclip.34-123-45-67.sslip.io
```

## 2. Install Docker and Clone the Repo

SSH into the VM, install Docker Engine and the Compose plugin, then clone your Paperclip branch.

```sh
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
newgrp docker

git clone https://github.com/lunr-studio/paperclip.git
cd paperclip
git checkout <your-branch>
```

## 3. Configure Docker Compose and Caddy

Create a Compose file that runs Paperclip behind Caddy.

```yaml
services:
  paperclip:
    build: .
    restart: unless-stopped
    environment:
      HOST: "0.0.0.0"
      PAPERCLIP_HOME: "/paperclip"
      PAPERCLIP_DEPLOYMENT_MODE: "authenticated"
      PAPERCLIP_DEPLOYMENT_EXPOSURE: "public"
      PAPERCLIP_AUTH_BASE_URL_MODE: "explicit"
      PAPERCLIP_PUBLIC_URL: "${PAPERCLIP_PUBLIC_URL}"
      BETTER_AUTH_SECRET: "${BETTER_AUTH_SECRET}"
      PAPERCLIP_AGENT_JWT_SECRET: "${PAPERCLIP_AGENT_JWT_SECRET}"
      ANTHROPIC_API_KEY: "${ANTHROPIC_API_KEY:-}"
      PAPERCLIP_SECRETS_STRICT_MODE: "true"
      USER_UID: "1000"
      USER_GID: "1000"
    expose:
      - "3100"
    volumes:
      - /opt/paperclip/data:/paperclip

  caddy:
    image: caddy:2
    restart: unless-stopped
    depends_on:
      - paperclip
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./deploy/Caddyfile:/etc/caddy/Caddyfile:ro
      - /opt/paperclip/caddy-data:/data
      - /opt/paperclip/caddy-config:/config
```

Create `deploy/Caddyfile`:

```caddyfile
paperclip.34-123-45-67.sslip.io {
  reverse_proxy paperclip:3100
}
```

Create `.env.gcp`:

```sh
PAPERCLIP_PUBLIC_URL=https://paperclip.34-123-45-67.sslip.io
BETTER_AUTH_SECRET=<random-secret>
PAPERCLIP_AGENT_JWT_SECRET=<random-secret>
ANTHROPIC_API_KEY=
```

Generate strong secrets with:

```sh
openssl rand -hex 32
```

If your mounted `/opt/paperclip/data` directory is owned by a different Linux user, update `USER_UID` and `USER_GID` to match `id -u` and `id -g` on the VM. Without that, Paperclip may fail to create directories under `/paperclip` on first boot.

## 4. Start Paperclip

```sh
docker compose --env-file .env.gcp -f docker-compose.gcp.yml up --build -d
```

Open the public URL in your browser once the containers are healthy.

## 5. Use Native Codex Login Instead of `OPENAI_API_KEY`

For `codex_local`, this deployment intentionally uses the Codex CLI's own login state instead of an API key. Do not set `OPENAI_API_KEY` if you want Codex runs billed through your ChatGPT/Codex account.

Run the login flow inside the Paperclip container:

```sh
docker compose --env-file .env.gcp -f docker-compose.gcp.yml exec paperclip codex login --device-auth
docker compose --env-file .env.gcp -f docker-compose.gcp.yml exec paperclip codex login status
```

Paperclip's Codex adapter reuses the shared Codex auth state and seeds company-scoped `CODEX_HOME` directories from it, so the login survives across heartbeats and restarts as long as `/paperclip` is persistent.

## 6. Bootstrap the First Instance Admin

If the app reports that instance setup is still required, generate the bootstrap invite from inside the container:

```sh
docker compose --env-file .env.gcp -f docker-compose.gcp.yml exec paperclip pnpm paperclipai auth bootstrap-ceo
```

Open the invite URL it prints, sign in, and claim the board.

## 7. Configure Agents

Inside the Paperclip UI:

- create or import your company
- configure agents to use the `codex_local` adapter
- avoid setting `OPENAI_API_KEY` for those agents if you want them to use the native Codex login
- run the adapter environment check to verify the login is detected

## Validation Checklist

Verify the deployment with:

```sh
curl https://paperclip.34-123-45-67.sslip.io/api/health
docker compose --env-file .env.gcp -f docker-compose.gcp.yml ps
docker compose --env-file .env.gcp -f docker-compose.gcp.yml exec paperclip codex login status
```

Expected outcomes:

- the dashboard loads over valid HTTPS
- `/api/health` returns `{"status":"ok"}`
- `codex login status` reports a ChatGPT/Codex login
- a `codex_local` agent passes its environment check without `OPENAI_API_KEY`
- the instance remains usable after a VM reboot

## Persistence and Backups

This deployment stores state on the VM under:

- `/opt/paperclip/data` for Paperclip data and Codex auth
- `/opt/paperclip/caddy-data` for TLS certificates
- `/opt/paperclip/caddy-config` for Caddy runtime config

Recommended follow-ups:

- take regular disk snapshots or back up `/opt/paperclip/data`
- verify containers restart automatically after reboot
- monitor `docker compose logs` and `/api/health`

For higher durability later, move to managed PostgreSQL and object storage, but keep the same public URL and reverse-proxy pattern.
