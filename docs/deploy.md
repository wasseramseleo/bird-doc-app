# Deployment

This runbook brings the production stack online on the **IPAX VPS** (Debian 13, Austrian/EU data residency) and wires up the GitHub Actions pipeline that owns every subsequent deploy. Cloudflare and Tailscale are gone (ADR 0007): the VPS has a public IP, **Caddy** terminates TLS via Let's Encrypt, and deploy reaches the box over public SSH. Run the steps top-to-bottom on a fresh VPS; once they're done, every push to `main` ships automatically.

If you are **cutting over** from the old Proxmox LXC rather than standing up a clean install, do steps 1–9 first to prove the new box, then follow [Cutover from the LXC](#cutover-from-the-lxc) for the scheduled switch.

## Overview

```
GitHub Actions (push to main)
  ├─ Build backend + frontend images → GHCR
  └─ SSH to VPS → scp compose + Caddyfile → render .env → docker compose up -d

IPAX VPS (Debian 13, public IP)
  ├─ ufw firewall            (22 SSH, 80/443 HTTP/S)
  └─ docker compose stack    (/opt/bird-doc-app/docker-compose.prod.yml)
       ├─ caddy   → :80/:443  (terminates TLS via Let's Encrypt; public ingress)
       │     ├─ birddoc.eu        → backend (Django landing) + /static
       │     ├─ app.birddoc.eu    → / → frontend (SPA); /api,/admin → backend; /static
       │     └─ birddoc.at, app.birddoc.at → 301 → .eu canonical
       ├─ frontend (nginx + Angular build)
       ├─ backend  (gunicorn; entrypoint runs migrate + collectstatic)
       └─ db       (postgres:16-alpine, data at /opt/bird-doc-app/pgdata)
```

Application code, image build, and compose file all live in this repo. The VPS holds no source — it only runs the compose stack the workflow drops into `/opt/bird-doc-app/`.

## Prerequisites (host operator)

These must be true before running anything below. They're not steps.

- **OS**: Debian 13 (Trixie).
- **Public IP**: a routable IPv4 (and ideally IPv6) the DNS A/AAAA records point at.
- **Sizing (starting point)**: 2 vCPU, 4 GB RAM, 20 GB disk. Postgres, Caddy data, and the two app images fit comfortably; bump RAM if the working set grows.
- **Network**: outbound internet for apt, GHCR, and Let's Encrypt; inbound 80/443 reachable from the public internet (Let's Encrypt validates over HTTP-01 on port 80).
- **Access**: root or a sudo-capable user with SSH/console access.

## Step 1 — Bootstrap the VPS

On the VPS, as root:

```bash
sudo bash deploy/bootstrap.sh
```

Or, if you haven't cloned the repo on the VPS:

```bash
curl -fsSL https://raw.githubusercontent.com/wasseramseleo/bird-doc-app/main/deploy/bootstrap.sh | sudo bash
```

This installs Docker + the compose plugin, opens the **ufw** firewall for SSH (22) and HTTP/HTTPS (80/443 tcp + 443/udp for HTTP/3), and creates `/opt/bird-doc-app/{pgdata,caddy_data,caddy_config}` with `pgdata` locked to mode 700. Idempotent — safe to re-run.

## Step 2 — Point DNS at the VPS

Create A records (and AAAA if you have IPv6) at your DNS provider, pointing **directly** at the VPS public IP:

| Host | Type | Value | Purpose |
|---|---|---|---|
| `birddoc.eu` | A | `<VPS_IP>` | Apex → Django landing |
| `app.birddoc.eu` | A | `<VPS_IP>` | App subdomain → SPA + `/api` + `/admin` |
| `birddoc.at` | A | `<VPS_IP>` | 301 → `birddoc.eu` |
| `app.birddoc.at` | A | `<VPS_IP>` | 301 → `app.birddoc.eu` |

All four must resolve to the VPS before the first deploy, because Caddy obtains a Let's Encrypt certificate for **each** hostname on startup via the HTTP-01 challenge (port 80). The `.at` hosts need certs too — they serve the 301 redirect over HTTPS.

> During cutover, leave the old DNS in place until the new box is proven (see [Cutover from the LXC](#cutover-from-the-lxc)). You can validate the VPS ahead of the DNS switch by adding `/etc/hosts` overrides on your workstation.

## Step 3 — Create the deploy SSH user

Generate the keypair **on your workstation** (not the VPS); the private half becomes the `SSH_PRIVATE_KEY` GitHub secret.

```bash
ssh-keygen -t ed25519 -f ~/.ssh/birddoc_deploy -C deploy@birddoc
```

On the VPS, create the user and install the public key:

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy
sudo install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
# paste ~/.ssh/birddoc_deploy.pub into:
sudo -u deploy tee /home/deploy/.ssh/authorized_keys < birddoc_deploy.pub
sudo chmod 600 /home/deploy/.ssh/authorized_keys
```

Harden public SSH: in `/etc/ssh/sshd_config` set `PasswordAuthentication no` and `PermitRootLogin no`, then `systemctl reload ssh`. Key-only auth plus the ufw rule from step 1 is the whole exposure surface.

Sanity check from your workstation:

```bash
ssh -i ~/.ssh/birddoc_deploy deploy@<VPS_IP> 'docker version'
```

## Step 4 — Set up Brevo (transactional mail)

Every transactional mail (email verification, password reset, Org-Einladung, Warteliste/feedback notifications) leaves from `noreply@birddoc.eu` over the Brevo EU SMTP relay.

1. Create a **Brevo** account and add the sender domain `birddoc.eu`.
2. Publish the DNS records Brevo generates so SPF, DKIM and DMARC pass:
   - **SPF** — add `include:spf.brevo.com` to (or create) the apex `TXT` SPF record.
   - **DKIM** — the two `CNAME`/`TXT` records Brevo shows for the domain key.
   - **DMARC** — a `_dmarc.birddoc.eu` `TXT` record, e.g. `v=DMARC1; p=quarantine; rua=mailto:postmaster@birddoc.eu`.
3. Verify the domain in Brevo (it checks the records above) and create an **SMTP key** — its login + key become the `BREVO_SMTP_USER` / `BREVO_SMTP_PASSWORD` secrets in step 5.

Confirm alignment after DNS propagates (e.g. `dig +short TXT birddoc.eu`, `dig +short TXT _dmarc.birddoc.eu`) and send a Brevo test mail to a Gmail/Outlook inbox — the headers should show `spf=pass`, `dkim=pass`, `dmarc=pass`.

## Step 5 — Add GitHub Actions secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**. All of these are required by `.github/workflows/deploy.yml`.

| Secret | Value / how to generate                             |
|---|-----------------------------------------------------|
| `SSH_HOST` | VPS public IP or DNS name                           |
| `SSH_USER` | `deploy`                                            |
| `SSH_PRIVATE_KEY` | Contents of `~/.ssh/birddoc_deploy` from step 3     |
| `DJANGO_SECRET_KEY` | `openssl rand -hex 64`                              |
| `DJANGO_ALLOWED_HOSTS` | `app.birddoc.eu,birddoc.eu`                         |
| `POSTGRES_PASSWORD` | `openssl rand -base64 32`                           |
| `CORS_ALLOWED_ORIGINS` | `https://app.birddoc.eu,https://birddoc.eu`         |
| `CSRF_TRUSTED_ORIGINS` | `https://app.birddoc.eu,https://birddoc.eu`         |
| `SESSION_COOKIE_DOMAIN` | `app.birddoc.eu` (SPA + `/admin` share one session) |
| `APP_LOGIN_URL` | `https://app.birddoc.eu/login`                      |
| `OPERATOR_EMAIL` | operator inbox (e.g. `contact@birddoc.eu`)          |
| `BREVO_SMTP_USER` | Brevo SMTP login from step 4                        |
| `BREVO_SMTP_PASSWORD` | Brevo SMTP key from step 4                          |

`DATABASE_URL` is **constructed** by the workflow from `POSTGRES_PASSWORD` — don't set it as a secret. The Caddy hostnames are baked into the `Caddyfile`, so there is no `DOMAIN` secret.

## Step 6 — Trigger the first deploy

Either push a commit to `main`, or run the workflow manually: **Actions → Deploy → Run workflow** (it has `workflow_dispatch`).

The workflow:

1. Builds `backend` and `frontend` images and pushes them to `ghcr.io/wasseramseleo/bird-doc-app-{backend,frontend}` as both `:latest` and `:sha-<commit>`.
2. SCPs `docker-compose.prod.yml` and `Caddyfile` into `/opt/bird-doc-app/`.
3. Writes `/opt/bird-doc-app/.env` (mode 600) from the secrets above — including the Brevo SMTP transport, so prod mail sends over Brevo rather than the dev console backend.
4. Runs `docker compose -f docker-compose.prod.yml pull && up -d --remove-orphans`.

The backend image's entrypoint runs `migrate` and `collectstatic` before exec'ing gunicorn, so a fresh deploy is fully self-applying.

## Step 7 — Verify

```bash
ssh deploy@<SSH_HOST>
cd /opt/bird-doc-app
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail 100 backend
docker compose -f docker-compose.prod.yml logs --tail 100 caddy
```

Then from anywhere:

```bash
curl -I  https://birddoc.eu/                       # 200 — landing
curl -I  https://app.birddoc.eu/                    # 200/302 — SPA
curl -sI https://birddoc.at/     | grep -i location # -> https://birddoc.eu/
curl -sI https://app.birddoc.at/ | grep -i location # -> https://app.birddoc.eu/
```

Expected:

- All four services (`db`, `backend`, `frontend`, `caddy`) show `Up`/`healthy`.
- Caddy log shows `certificate obtained successfully` for each hostname.
- Backend log shows `Apply all migrations …` followed by `Booting worker`.
- The `.at` curls return `301` with the `.eu` `Location`.

## Step 8 — Create the Django superuser (one-time)

Skip this when cutting over — the LXC dump already carries the accounts.

```bash
docker compose -f /opt/bird-doc-app/docker-compose.prod.yml exec backend \
  python manage.py createsuperuser
```

Admin UI: `https://app.birddoc.eu/admin/`.

## Step 9 — Backup + tested restore (before go-public)

Prove the backup path **before** the cutover, so the LXC can be retired safely.

**Take a full backup** (on whichever box currently holds the live data):

```bash
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U birddoc -Fc birddoc > "birddoc-$(date +%Y%m%d-%H%M).dump"
```

**Test the restore** into a throwaway database and confirm the row counts match:

```bash
# scratch DB inside the running postgres container
docker compose -f docker-compose.prod.yml exec -T db \
  createdb -U birddoc restore_check
docker compose -f docker-compose.prod.yml exec -T db \
  pg_restore -U birddoc -d restore_check --no-owner < birddoc-YYYYMMDD-HHMM.dump
docker compose -f docker-compose.prod.yml exec -T db \
  psql -U birddoc -d restore_check -c "select count(*) from birds_dataentry;"
docker compose -f docker-compose.prod.yml exec -T db \
  dropdb -U birddoc restore_check
```

Keep the dump off-box (download it), and back up the host path `/opt/bird-doc-app/pgdata` as well.

## Cutover from the LXC

The old Proxmox LXC stays running as the rollback until the VPS is verified. The data move itself — reshaping the single-tenant IWM Linz data into the tenancy model — is the **cutover transform** (issue #82); run it as part of this window.

1. **Announce a short maintenance window** to `filip` (IWM Linz). Downtime is roughly the dump → transfer → restore → transform time.
2. **Freeze writes on the LXC** (stop the old app container, leave its `db` up) and take a final dump:
   ```bash
   docker compose -f docker-compose.prod.yml exec -T db \
     pg_dump -U birddoc -Fc birddoc > birddoc-cutover.dump
   ```
3. **Restore onto the VPS** (stack up, DB healthy):
   ```bash
   scp birddoc-cutover.dump deploy@<VPS_IP>:/opt/bird-doc-app/
   docker compose -f /opt/bird-doc-app/docker-compose.prod.yml exec -T db \
     pg_restore -U birddoc -d birddoc --clean --no-owner < /opt/bird-doc-app/birddoc-cutover.dump
   ```
4. **Run the cutover transform** (issue #82) so the existing IWM Linz data lands in the tenancy model, then `migrate` if needed (the entrypoint runs it on the next boot anyway).
5. **Smoke-test over `/etc/hosts` overrides** pointing the four hostnames at the VPS IP: log in as `filip`, open a project, record a capture, pull the IWM export.
6. **Switch DNS** (step 2) to the VPS IP. Caddy issues certs as each name resolves. Watch `docker compose logs -f caddy`.
7. **Verify** (step 7) against the real hostnames once DNS propagates.
8. **Keep the LXC** powered (writes frozen) as rollback until the VPS has run clean for a day or two; rollback = point DNS back at the LXC's previous ingress.

## Operations

**Tail logs**
```bash
docker compose -f /opt/bird-doc-app/docker-compose.prod.yml logs -f backend
docker compose -f /opt/bird-doc-app/docker-compose.prod.yml logs -f caddy
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
  pg_dump -U birddoc -Fc birddoc > "birddoc-$(date +%Y%m%d).dump"
```
Postgres data lives on the host at `/opt/bird-doc-app/pgdata`; back that path up too.

## Known constraints

- **TLS is the VPS's job now.** Caddy obtains and renews Let's Encrypt certs over the HTTP-01 challenge — ports 80 **and** 443 must stay reachable from the public internet (ufw allows them). There is no edge cache or WAF in front (ADR 0007, accepted at beta scale).
- **DNS must resolve before first boot.** Caddy can't get a certificate for a hostname that doesn't point at the box yet; a name added later picks up its cert on the next request. The `.eu` redirect hosts need certs too.
- **`staticfiles` volume ownership.** If the named volume was created by an older image build it can be root-owned and `collectstatic` will fail. Remediation:
  ```bash
  docker compose -f /opt/bird-doc-app/docker-compose.prod.yml down
  docker volume rm bird-doc-app_staticfiles
  docker compose -f /opt/bird-doc-app/docker-compose.prod.yml up -d
  ```
  The current backend image pre-creates `/app/staticfiles` with `app:app` (UID 1001) so a fresh volume inherits writable permissions.
