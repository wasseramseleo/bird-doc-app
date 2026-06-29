---
status: accepted
---

# Hosting on an IPAX VPS, Cloudflare removed

## Context

The app runs on a home Proxmox LXC reached **only** through a Cloudflare Tunnel
(the host publishes no ports), with deploy over Tailscale — the topology
documented in `ARCHITECTURE.md`. That suited a home server whose IP should not be
exposed and whose uptime was uncertain.

Going public needs dependable uptime and a clean home for both the app and the
new public landing (a Django app). A dedicated **IPAX VPS** (Debian 13, Austrian
datacenter) is available with enough resources for both and a public IP.

## Decision

Move app + landing to the IPAX VPS:

- DNS A records point **directly** at the VPS public IP. **Caddy** terminates TLS
  via Let's Encrypt and reverse-proxies: apex `birddoc.at` → Django landing,
  `app.birddoc.at` → Angular static for `/` and `/api`+`/admin` → Django
  (gunicorn).
- **Drop Cloudflare entirely** — no Tunnel, no CDN/WAF. At beta volume the edge
  cache, WAF and origin-IP hiding do not justify the extra moving part. Re-adding
  Cloudflare (as proxied DNS) later is straightforward if traffic or abuse
  warrants it.
- Austrian hosting (IPAX) keeps capture data in Austria/EU — both a DSGVO posture
  and a marketing asset.

## Considered options

- **Keep the Cloudflare Tunnel on the VPS.** Rejected: the tunnel existed to
  avoid exposing a home IP and to ingress without open ports; a VPS with a public
  IP and Caddy needs neither.
- **Keep Cloudflare as proxied DNS (CDN/WAF) without the tunnel.** Reasonable but
  rejected for now — lack of traffic doesn't justify it; revisit when it does.

## Consequences

- `ARCHITECTURE.md`'s deployment topology (Cloudflare Tunnel, Proxmox LXC,
  "publishes no host ports", Tailscale deploy) is **superseded** and must be
  rewritten as part of the migration.
- The origin IP is public and there is no edge cache or WAF — accepted at beta
  scale.
- TLS, firewall, backups and the deploy path become the VPS's responsibility,
  covered by the cutover plan (full backup + tested restore; the LXC stays as
  rollback until the VPS is verified).
