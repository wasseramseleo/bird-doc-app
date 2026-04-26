#!/usr/bin/env bash
# One-time bootstrap for bird-doc-app on a Proxmox LXC container (Debian/Ubuntu).
# Installs Docker, Tailscale, and cloudflared, then prepares /opt/bird-doc-app.
# Run as root on a fresh LXC:
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

echo ">> Installing Tailscale"
if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh
else
  echo "   tailscale already installed: $(tailscale version | head -n1)"
fi
systemctl enable --now tailscaled

echo ">> Installing cloudflared"
if ! command -v cloudflared >/dev/null 2>&1; then
  arch="$(dpkg --print-architecture)"
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}.deb" \
    -o /tmp/cloudflared.deb
  apt-get install -y /tmp/cloudflared.deb
  rm -f /tmp/cloudflared.deb
else
  echo "   cloudflared already installed: $(cloudflared --version | head -n1)"
fi

echo ">> Creating ${APP_DIR} directory tree"
mkdir -p "${APP_DIR}"/{pgdata,caddy_data,caddy_config}
chmod 700 "${APP_DIR}/pgdata"

cat <<'EOF'

>> Bootstrap complete.

Next steps:

1. Join the tailnet:
     tailscale up
   (or non-interactively: tailscale up --authkey=tskey-...)

2. Connect the Cloudflare Tunnel:
     sudo cloudflared service install <TUNNEL_TOKEN>
   Create the tunnel in the Cloudflare Zero Trust dashboard first; point the public
   hostname at http://localhost:80 (Caddy listens on 127.0.0.1:80 inside the LXC).

3. Add the following secrets in GitHub → Settings → Secrets and variables → Actions:
     TAILSCALE_AUTHKEY         ephemeral authkey for the deploy workflow's runner
     SSH_HOST                  Tailscale IP or MagicDNS name of this LXC
     SSH_USER                  deploy user (must be in the docker group, or root)
     SSH_PRIVATE_KEY           private key authorized on the deploy user
     DOMAIN                    e.g. birddoc.example.com (the Cloudflare Tunnel hostname)
     DJANGO_SECRET_KEY         long random string (`openssl rand -hex 64`)
     DJANGO_ALLOWED_HOSTS      e.g. birddoc.example.com
     POSTGRES_PASSWORD         database password
     CORS_ALLOWED_ORIGINS      e.g. https://birddoc.example.com
     CSRF_TRUSTED_ORIGINS      e.g. https://birddoc.example.com

4. Push to main — GitHub Actions builds images, pushes to GHCR, connects to the
   tailnet, then SSHes in to roll out docker-compose.prod.yml.

5. Verify after first deploy:
     curl -I https://<DOMAIN>/
     docker compose -f /opt/bird-doc-app/docker-compose.prod.yml logs backend

EOF
