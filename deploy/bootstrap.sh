#!/usr/bin/env bash
# One-time VPS bootstrap for bird-doc-app.
# Run as root on a fresh Debian/Ubuntu host with SSH access:
#   curl -fsSL https://raw.githubusercontent.com/<owner>/bird-doc-app/main/deploy/bootstrap.sh | sudo bash
# or scp this file over and run `sudo bash bootstrap.sh`.

set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

APP_DIR=/opt/bird-doc-app

echo ">> Installing Docker Engine + compose plugin"
if ! command -v docker >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ca-certificates curl gnupg

  install -m 0755 -d /etc/apt/keyrings
  if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
    . /etc/os-release
    curl -fsSL "https://download.docker.com/linux/${ID}/gpg" \
      | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg

    arch="$(dpkg --print-architecture)"
    codename="${VERSION_CODENAME:-$(lsb_release -cs 2>/dev/null || echo stable)}"
    echo "deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${ID} ${codename} stable" \
      > /etc/apt/sources.list.d/docker.list
  fi

  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
else
  echo "   docker already installed: $(docker --version)"
fi

echo ">> Creating ${APP_DIR} directory tree"
mkdir -p "${APP_DIR}"/{pgdata,caddy_data,caddy_config}
chmod 700 "${APP_DIR}/pgdata"

cat <<'EOF'

>> Bootstrap complete.

Next steps:

1. Add the following secrets in GitHub → Settings → Secrets and variables → Actions:
     SSH_HOST                  this server's hostname or IP
     SSH_USER                  the deploy user (must be in the docker group, or root)
     SSH_PRIVATE_KEY           private key authorized on the deploy user
     DOMAIN                    e.g. birddoc.example.com (must point to this server's IP)
     DJANGO_SECRET_KEY         long random string (`openssl rand -hex 64`)
     DJANGO_ALLOWED_HOSTS      e.g. birddoc.example.com
     POSTGRES_PASSWORD         database password
     CORS_ALLOWED_ORIGINS      e.g. https://birddoc.example.com
     CSRF_TRUSTED_ORIGINS      e.g. https://birddoc.example.com

2. Make sure DNS for $DOMAIN points to this server (Caddy needs it for Let's Encrypt).

3. Push to main — GitHub Actions will build images, push to GHCR, and roll out
   docker-compose.prod.yml on this host. The first run grabs a TLS cert via Let's Encrypt.

4. Verify after first deploy:
     curl -I https://<DOMAIN>/
     docker compose -f /opt/bird-doc-app/docker-compose.prod.yml logs backend

EOF
