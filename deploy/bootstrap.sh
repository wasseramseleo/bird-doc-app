#!/usr/bin/env bash
# One-time bootstrap for bird-doc-app on the IPAX VPS (Debian 13).
# Installs Docker, opens the firewall for HTTP/HTTPS/SSH, and prepares
# /opt/bird-doc-app. Cloudflare and Tailscale are gone (ADR 0007): the VPS has a
# public IP, Caddy terminates TLS via Let's Encrypt, and deploy reaches the box
# over public SSH.
# Run as root on a fresh VPS:
#   curl -fsSL https://raw.githubusercontent.com/wasseramseleo/bird-doc-app/main/deploy/bootstrap.sh | sudo bash
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

echo ">> Configuring the firewall (ufw): allow SSH, HTTP, HTTPS"
if ! command -v ufw >/dev/null 2>&1; then
  apt-get install -y ufw
fi
ufw allow 22/tcp        # public SSH (deploy + admin)
ufw allow 80/tcp        # Let's Encrypt ACME HTTP-01 + HTTP->HTTPS redirect
ufw allow 443/tcp       # HTTPS
ufw allow 443/udp       # HTTP/3 (QUIC)
ufw --force enable
ufw status verbose

echo ">> Creating ${APP_DIR} directory tree"
mkdir -p "${APP_DIR}"/{pgdata,caddy_data,caddy_config}
chmod 700 "${APP_DIR}/pgdata"

cat <<'EOF'

>> Bootstrap complete.

Next steps (see docs/deploy.md for the full runbook):

1. Point DNS A records straight at this VPS's public IP:
     birddoc.eu        A   <VPS_IP>
     app.birddoc.eu    A   <VPS_IP>
     birddoc.at        A   <VPS_IP>   (301 -> birddoc.eu)
     app.birddoc.at    A   <VPS_IP>   (301 -> app.birddoc.eu)
   Caddy obtains a Let's Encrypt certificate for each once DNS resolves here.

2. Create the deploy SSH user (key-only) — its private key becomes the
   SSH_PRIVATE_KEY GitHub secret:
     adduser --disabled-password --gecos "" deploy
     usermod -aG docker deploy
     install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
     # install the deploy public key into /home/deploy/.ssh/authorized_keys

3. Add the following secrets in GitHub -> Settings -> Secrets and variables ->
   Actions:
     SSH_HOST                  public IP or DNS name of this VPS
     SSH_USER                  deploy (must be in the docker group, or root)
     SSH_PRIVATE_KEY           private key authorized on the deploy user
     DJANGO_SECRET_KEY         long random string (`openssl rand -hex 64`)
     DJANGO_ALLOWED_HOSTS      app.birddoc.eu,birddoc.eu
     POSTGRES_PASSWORD         database password
     CORS_ALLOWED_ORIGINS      https://app.birddoc.eu,https://birddoc.eu
     CSRF_TRUSTED_ORIGINS      https://app.birddoc.eu,https://birddoc.eu
     SESSION_COOKIE_DOMAIN     app.birddoc.eu
     APP_LOGIN_URL             https://app.birddoc.eu/login
     OPERATOR_EMAIL            operator inbox (e.g. zugang@birddoc.eu)
     BREVO_SMTP_USER           Brevo SMTP login
     BREVO_SMTP_PASSWORD       Brevo SMTP key (never commit it)

4. Push to main — GitHub Actions builds images, pushes to GHCR, then SSHes in to
   roll out docker-compose.prod.yml.

5. Verify after first deploy:
     curl -I https://birddoc.eu/
     curl -I https://app.birddoc.eu/
     curl -sI https://birddoc.at/ | grep -i location   # -> https://birddoc.eu/
     docker compose -f /opt/bird-doc-app/docker-compose.prod.yml logs caddy

EOF
