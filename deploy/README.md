# Deployment

The deployment runbook lives at [`docs/deploy.md`](../docs/deploy.md).

This directory holds the supporting artifacts it references:

- [`bootstrap.sh`](bootstrap.sh) — one-time VPS bootstrap (Docker, ufw firewall, `/opt/bird-doc-app/`). Cloudflare and Tailscale are gone (ADR 0007).
