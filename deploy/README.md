# Deployment

The `main` branch deploys automatically: GitHub Actions builds backend + frontend images, pushes them to GHCR, joins the tailnet, then SSHes into a **Proxmox LXC container** and rolls out `docker-compose.prod.yml`. Public traffic reaches the LXC via a **Cloudflare Tunnel** (`cloudflared` runs as a systemd service on the LXC); TLS terminates at Cloudflare and Caddy serves plain HTTP on `127.0.0.1:80` inside the LXC.

## One-time LXC setup

On a fresh Debian/Ubuntu LXC container:

```bash
sudo bash deploy/bootstrap.sh
```

This installs Docker + compose plugin, Tailscale, and `cloudflared`, and creates `/opt/bird-doc-app/{pgdata,caddy_data,caddy_config}`. The deploy workflow places `docker-compose.prod.yml` and `Caddyfile` into `/opt/bird-doc-app/` on every run, so you do not copy them manually.

After bootstrap, finalize the two networking pieces manually:

```bash
# 1. Join the tailnet (interactive, or pass --authkey=tskey-...).
sudo tailscale up

# 2. Connect the Cloudflare Tunnel. Create the tunnel in the Cloudflare
#    Zero Trust dashboard first, then point the public hostname at
#    http://localhost:80, and use the token from the dashboard:
sudo cloudflared service install <TUNNEL_TOKEN>
```

## Required GitHub Actions secrets

Configure under **Settings → Secrets and variables → Actions**:

| Secret | Example | Notes |
|---|---|---|
| `TAILSCALE_AUTHKEY` | `tskey-auth-…` | Ephemeral authkey; the deploy runner uses it to join the tailnet |
| `SSH_HOST` | `birddoc-lxc.tailXXXX.ts.net` | LXC's Tailscale IP or MagicDNS name |
| `SSH_USER` | `deploy` | Must be in the `docker` group (or root) |
| `SSH_PRIVATE_KEY` | `-----BEGIN OPENSSH PRIVATE KEY-----…` | Authorized for `SSH_USER` |
| `DOMAIN` | `birddoc.example.com` | The Cloudflare Tunnel public hostname |
| `DJANGO_SECRET_KEY` | `(openssl rand -hex 64)` | Long random string |
| `DJANGO_ALLOWED_HOSTS` | `birddoc.example.com` | Comma-separated if multiple |
| `POSTGRES_PASSWORD` | random 32+ chars | DB password |
| `CORS_ALLOWED_ORIGINS` | `https://birddoc.example.com` | Comma-separated if multiple |
| `CSRF_TRUSTED_ORIGINS` | `https://birddoc.example.com` | Comma-separated if multiple |

The deploy workflow renders these into `/opt/bird-doc-app/.env` (mode 600) on every deploy. `DATABASE_URL` is constructed from `POSTGRES_PASSWORD`.

## Container registry

Images are published to:

- `ghcr.io/<owner>/bird-doc-app-backend:latest` (and `:sha-<commit>`)
- `ghcr.io/<owner>/bird-doc-app-frontend:latest` (and `:sha-<commit>`)

`<owner>` follows your GitHub org/user. The repo's `GITHUB_TOKEN` already has push rights to GHCR via the workflow's `packages: write` permission.

## Verifying a deploy

```bash
ssh "$SSH_USER@$SSH_HOST"     # over Tailscale
cd /opt/bird-doc-app
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail 100 backend
curl -I "https://$DOMAIN/"    # via Cloudflare Tunnel
```

The backend image's entrypoint runs `migrate` and `collectstatic` before exec'ing `gunicorn`, so a fresh deploy applies pending migrations automatically.

## Rolling back

To pin to a specific commit:

```bash
docker compose -f docker-compose.prod.yml pull \
  ghcr.io/<owner>/bird-doc-app-backend:sha-<commit> \
  ghcr.io/<owner>/bird-doc-app-frontend:sha-<commit>
# or edit docker-compose.prod.yml to reference :sha-<commit> tags, then up -d
```

## Known constraints

- TLS terminates at Cloudflare. Caddy listens on `127.0.0.1:80` inside the LXC and is reached only by the local `cloudflared` systemd service. Do not publish ports 80/443 on the LXC host.
- DNS for `$DOMAIN` is managed inside the Cloudflare Tunnel configuration; no public A/AAAA record points at the LXC.
- `staticfiles` is a named docker volume. The backend image pre-creates `/app/staticfiles` with `app:app` (UID 1001) ownership so the volume inherits writable permissions on first creation. If the volume was created by an older image build it will be root-owned and `collectstatic` will fail; recreate it once with `docker volume rm bird-doc-app_staticfiles` and `docker compose ... up -d`.
