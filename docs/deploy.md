# Deployment

This runbook brings the production stack online on a Proxmox LXC and wires up the GitHub Actions pipeline that owns every subsequent deploy. Run the steps top-to-bottom on a fresh LXC; once they're done, every push to `main` ships automatically.

## Overview

```
GitHub Actions (push to main)
  ├─ Build backend + frontend images → GHCR
  └─ Join tailnet → SSH to LXC → scp compose + Caddyfile → render .env → docker compose up -d

LXC (Debian/Ubuntu on Proxmox)
  ├─ tailscaled              (joins tailnet; how GitHub Actions reaches the box)
  ├─ cloudflared (systemd)   (public ingress; TLS terminates at Cloudflare edge)
  └─ docker compose stack    (/opt/bird-doc-app/docker-compose.prod.yml)
       ├─ caddy   → 127.0.0.1:80   (only reached by local cloudflared)
       ├─ frontend (nginx + Angular build)
       ├─ backend  (gunicorn; entrypoint runs migrate + collectstatic)
       └─ db       (postgres:16-alpine, data at /opt/bird-doc-app/pgdata)
```

Application code, image build, and compose file all live in this repo. The LXC holds no source — it only runs the compose stack the workflow drops into `/opt/bird-doc-app/`.

## Prerequisites (host operator)

These must be true before running anything below. They're not steps.

- **LXC base**: Debian 12 or Ubuntu 22.04/24.04.
- **Sizing (starting point)**: 2 vCPU, 4 GB RAM, 20 GB disk. Postgres, Caddy data, and the two app images fit comfortably; bump RAM if the working set grows.
- **Proxmox container options**: `features: nesting=1,keyctl=1`. Without these, the Docker daemon will refuse to start or fail with cgroup errors. `unprivileged=1` is fine.
- **Network**: outbound internet for apt, GHCR, Tailscale, and Cloudflare.
- **Access**: root or a sudo-capable user with SSH/console access.

## Step 1 — Bootstrap the LXC

On the LXC, as root:

```bash
sudo bash deploy/bootstrap.sh
```

Or, if you haven't cloned the repo on the LXC:

```bash
curl -fsSL https://raw.githubusercontent.com/wasseramseleo/bird-doc-app/main/deploy/bootstrap.sh | sudo bash
```

This installs Docker + the compose plugin, Tailscale, and cloudflared, and creates `/opt/bird-doc-app/{pgdata,caddy_data,caddy_config}` with `pgdata` locked to mode 700. Idempotent — safe to re-run.

## Step 2 — Join the tailnet

GitHub Actions reaches the LXC only over Tailscale. There is no public SSH.

```bash
sudo tailscale up
# or non-interactively:
sudo tailscale up --authkey=tskey-...
```

Then capture the LXC's MagicDNS name — you'll need it for `SSH_HOST` in step 5:

```bash
tailscale status
```

## Step 3 — Create the deploy SSH user

Generate the keypair **on your workstation** (not the LXC); the private half becomes the `SSH_PRIVATE_KEY` GitHub secret.

```bash
ssh-keygen -t ed25519 -f ~/.ssh/birddoc_deploy -C deploy@birddoc
```

On the LXC, create the user and install the public key:

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy
sudo install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
# paste ~/.ssh/birddoc_deploy.pub into:
sudo -u deploy tee /home/deploy/.ssh/authorized_keys < birddoc_deploy.pub
sudo chmod 600 /home/deploy/.ssh/authorized_keys
```

Sanity check from your workstation (over Tailscale):

```bash
ssh -i ~/.ssh/birddoc_deploy deploy@<tailscale-magicdns-name> 'docker version'
```

## Step 4 — Connect the Cloudflare Tunnel

TLS terminates at Cloudflare. Caddy listens only on `127.0.0.1:80` inside the LXC; the tunnel is the only public path in.

1. In the **Cloudflare Zero Trust dashboard** → Networks → Tunnels, create a new tunnel.
2. Under **Public Hostnames**, add the production hostname (e.g. `birddoc.example.com`) pointing at `http://localhost:80`.
3. Copy the tunnel token, then on the LXC:

   ```bash
   sudo cloudflared service install <TUNNEL_TOKEN>
   systemctl status cloudflared
   ```

DNS for the hostname is managed inside the tunnel config — do **not** add an A/AAAA record at your DNS provider pointing at the LXC.

## Step 5 — Add GitHub Actions secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**. All of these are required by `.github/workflows/deploy.yml`.

| Secret | Value / how to generate |
|---|---|
| `TAILSCALE_AUTHKEY` | Ephemeral authkey from Tailscale admin → Settings → Keys |
| `SSH_HOST` | LXC MagicDNS name from step 2 |
| `SSH_USER` | `deploy` |
| `SSH_PRIVATE_KEY` | Contents of `~/.ssh/birddoc_deploy` from step 3 |
| `DOMAIN` | `birddoc.example.com` (the tunnel hostname from step 4) |
| `DJANGO_SECRET_KEY` | `openssl rand -hex 64` |
| `DJANGO_ALLOWED_HOSTS` | `birddoc.example.com` (comma-separated if multiple) |
| `POSTGRES_PASSWORD` | `openssl rand -base64 32` |
| `CORS_ALLOWED_ORIGINS` | `https://birddoc.example.com` |
| `CSRF_TRUSTED_ORIGINS` | `https://birddoc.example.com` |

`DATABASE_URL` is **constructed** by the workflow from `POSTGRES_PASSWORD` — don't set it as a secret.

## Step 6 — Trigger the first deploy

Either push a commit to `main`, or run the workflow manually: **Actions → Deploy → Run workflow** (it has `workflow_dispatch`).

The workflow:

1. Builds `backend` and `frontend` images and pushes them to `ghcr.io/wasseramseleo/bird-doc-app-{backend,frontend}` as both `:latest` and `:sha-<commit>`.
2. Joins the tailnet on the runner.
3. SCPs `docker-compose.prod.yml` and `Caddyfile` into `/opt/bird-doc-app/`.
4. Writes `/opt/bird-doc-app/.env` (mode 600) from the secrets above.
5. Runs `docker compose -f docker-compose.prod.yml pull && up -d --remove-orphans`.

The backend image's entrypoint runs `migrate` and `collectstatic` before exec'ing gunicorn, so a fresh deploy is fully self-applying.

## Step 7 — Verify

```bash
ssh deploy@<SSH_HOST>
cd /opt/bird-doc-app
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail 100 backend
curl -I "https://$DOMAIN/"
```

Expected:

- All four services (`db`, `backend`, `frontend`, `caddy`) show `Up`/`healthy`.
- Backend log shows `Operations to perform: Apply all migrations …` followed by `Booting worker`.
- `curl -I` returns `HTTP/2 200` (or 302 if there's a frontend redirect).

## Step 8 — Create the Django superuser (one-time)

```bash
docker compose -f /opt/bird-doc-app/docker-compose.prod.yml exec backend \
  python manage.py createsuperuser
```

Admin UI: `https://<DOMAIN>/admin/`.

## Operations

**Tail logs**
```bash
docker compose -f /opt/bird-doc-app/docker-compose.prod.yml logs -f backend
```

**Roll back to a previous build**
Edit `/opt/bird-doc-app/docker-compose.prod.yml` and replace the image tag on the affected service with `:sha-<commit>`, then:
```bash
docker compose -f /opt/bird-doc-app/docker-compose.prod.yml up -d
```
The next `main` deploy will overwrite the compose file and return the service to `:latest` — pin in the workflow or pause the workflow if you need the rollback to stick.

**Re-render `.env`**
Re-run the Deploy workflow; it always rewrites `/opt/bird-doc-app/.env` mode 600 from the current secrets.

**Database backup**
```bash
docker compose -f /opt/bird-doc-app/docker-compose.prod.yml exec -T db \
  pg_dump -U birddoc birddoc > "birddoc-$(date +%Y%m%d).sql"
```
Postgres data lives on the host at `/opt/bird-doc-app/pgdata`; back that path up too.

## Known constraints

- **TLS at the edge only.** Do not publish ports 80/443 on the LXC host; Caddy is bound to `127.0.0.1:80` and the only reader is the local `cloudflared` service.
- **`staticfiles` volume ownership.** If the named volume was created by an older image build it can be root-owned and `collectstatic` will fail. Remediation:
  ```bash
  docker compose -f /opt/bird-doc-app/docker-compose.prod.yml down
  docker volume rm bird-doc-app_staticfiles
  docker compose -f /opt/bird-doc-app/docker-compose.prod.yml up -d
  ```
  The current backend image pre-creates `/app/staticfiles` with `app:app` (UID 1001) so a fresh volume inherits writable permissions.
- **Docker-in-LXC.** Requires Proxmox container features `nesting=1,keyctl=1`. Symptoms of missing features: the docker daemon refuses to start, or `docker run` errors on cgroup setup.
