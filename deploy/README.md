# Deployment

The `main` branch deploys automatically: GitHub Actions builds backend + frontend images, pushes them to GHCR, then SSHes into the VPS and rolls out `docker-compose.prod.yml`. Caddy fronts the stack with auto Let's Encrypt TLS.

## One-time VPS setup

On a fresh Debian/Ubuntu host with SSH access:

```bash
sudo bash deploy/bootstrap.sh
```

This installs Docker + the compose plugin and creates `/opt/bird-doc-app/{pgdata,caddy_data,caddy_config}`. The deploy workflow places `docker-compose.prod.yml` and `Caddyfile` into `/opt/bird-doc-app/` on every run, so you do not copy them manually.

## Required GitHub Actions secrets

Configure under **Settings → Secrets and variables → Actions**:

| Secret | Example | Notes |
|---|---|---|
| `SSH_HOST` | `203.0.113.10` | Hostname or IP of the VPS |
| `SSH_USER` | `deploy` | Must be in the `docker` group (or root) |
| `SSH_PRIVATE_KEY` | `-----BEGIN OPENSSH PRIVATE KEY-----…` | Authorized for `SSH_USER` |
| `DOMAIN` | `birddoc.example.com` | DNS A/AAAA must resolve to `SSH_HOST` |
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
ssh "$SSH_USER@$SSH_HOST"
cd /opt/bird-doc-app
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail 100 backend
curl -I "https://$DOMAIN/"
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

- The `caddy_data` volume holds the Let's Encrypt account + issued certs. Do not delete it — LE will rate-limit re-issuance otherwise.
- The first request to `https://<DOMAIN>/` after a fresh bootstrap may take a few seconds while Caddy fetches the cert.
- DNS must already resolve before pushing to `main`, or Caddy's ACME challenge will fail.
