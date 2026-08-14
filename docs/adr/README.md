<!-- Erzeugt von scripts/check-adr-index.mjs (#479) — nicht von Hand bearbeiten. -->
<!-- Neu erzeugen: node scripts/check-adr-index.mjs --write -->

# Architecture Decision Records

Alle Entscheidungen dieses Verzeichnisses, aufsteigend nach Nummer.

- [0001](0001-account-independent-beringer.md) — Account-independent Beringer
- [0002](0002-iwm-context-attribute-placement.md) — IWM export: capture-context on Project, geography on Station
- [0003](0003-beringer-deletion-reassign-to-fallback.md) — Beringer deletion reassigns captures to a reserved fallback
- [0004](0004-special-kind-discriminator.md) — special_kind discriminator supersedes is_sentinel
- [0005](0005-organisation-as-tenant-boundary.md) — Organisation as tenant boundary
- [0006](0006-ring-scoped-to-organisation.md) — Ring scoped to Organisation
- [0007](0007-hosting-on-ipax-vps-cloudflare-removed.md) — Hosting on an IPAX VPS, Cloudflare removed
- [0008](0008-email-login-without-custom-user-model.md) — Email as login identifier without a custom user model
- [0009](0009-landing-server-rendered-over-shared-brand-layer.md) — Public landing stays server-rendered Django over a shared brand layer
- [0010](0010-canonical-domain-birddoc-eu.md) — Canonical domain is `birddoc.eu`, `birddoc.at` redirects
- [0011](0011-station-archive-over-delete.md) — Org-admin station management: archive over delete, server-owned handle
- [0012](0012-demo-reference-tenant.md) — Demo Referenzprojekt as a de-identified, unmarked real tenant
- [0013](0013-iwm-import-in-app-feature.md) — IWM import as an in-app, Org-Admin feature
- [0014](0014-marketing-positions-on-station-not-field.md) — Marketing copy positions on the ringing Station, not the field
- [0015](0015-offline-sync-before-iwm-import.md) — Operational rule: sync field devices before IWM-importing the same period
- [0016](0016-org-admin-beringer-management.md) — Org-admin Beringer management in-app: CRUD and account linking
- [0017](0017-dashboard-stats-online-only-backend-endpoint.md) — Dashboard statistics are served online-only via a backend aggregation endpoint
- [0018](0018-home-is-current-project-dashboard.md) — The logged-in home is the current Projekt's dashboard, not just a picker
- [0019](0019-zentrale-joins-ring-additively.md) — Zentrale joins the Ring additively; Organisation stays the tenant boundary
- [0020](0020-projekte-picker-route.md) — The project picker is a dedicated `/projekte` route; `/` redirects there when no Projekt is selected
- [0021](0021-artennorm-global-default-plus-org-override.md) — Artennorm — global default plus additive per-Organisation override
- [0022](0022-ai-crawlers-fully-allowed-no-llms-txt.md) — AI crawlers stay fully allowed; no llms.txt
- [0023](0023-projekttyp-decoupled-from-field-visibility.md) — Projekttyp is descriptive metadata, decoupled from capture-field visibility
- [0024](0024-traeger-is-contract-partner-and-controller.md) — The Träger is the contract partner and DSGVO controller; the Betreiber is processor
- [0025](0025-self-hosted-fonts-no-third-party-requests.md) — Fonts are self-hosted; no user-facing surface makes third-party requests
- [0026](0026-fangmarker-not-sonderart.md) — Sonderfänge (Tot-Fund, Nicht-Standard-Fang) are Fangmarker on the capture, not Sonderarten
- [0027](0027-parasit-multivalued-global-vocabulary.md) — Parasit is a multi-valued global-vocabulary field, replacing the has_mites boolean
- [0028](0028-ringgroesse-per-org-override.md) — Empfohlene Ringgröße gains a per-Organisation override, resolved independently of the Artennorm
- [0029](0029-configurable-per-projekt-saison.md) — Configurable per-Projekt Saison (month window) drives a "Diese Saison" dashboard preset
- [0030](0030-capture-delete-tombstoned-invisible-no-restore.md) — A deleted capture is tombstoned, invisible to every query, and has no restore surface
- [0031](0031-retiring-a-vocabulary-code-across-an-offline-window.md) — Retiring a vocabulary code across an offline window: migrate at rest, accept and rewrite in motion
- [0032](0032-offline-bereitschaft-covers-the-version-never-force-reload.md) — Offline-Bereitschaft covers the Version, and the app never force-reloads
- [0033](0033-the-replay-path-is-lenient.md) — The replay path is lenient: stamped payloads, always accepted, flagged only on validation
- [0034](0034-totfund-carries-its-own-export-codes.md) — Ein Tot-Fund trägt eigene Export-Codes (Umstand 08, Zustand 2)
- [0035](0035-optionale-felder-als-opt-out-liste.md) — Optionale Felder pro Projekt: eine Opt-out-Liste statt weiterer Booleans
- [0036](0036-wochengrenze-definiert-die-wochen-voreinstellung.md) — Die Wochengrenze definiert die Wochen-Voreinstellung des Dashboards
- [0037](0037-fehlerklassen-und-ihre-oberflaechen.md) — Fehler werden danach benannt, was dagegen zu tun ist — sechs Klassen, Oberfläche nach Moment
- [0038](0038-fehlercodes-additiv-neben-der-drf-form.md) — Fehlercodes reisen additiv neben der DRF-Form, und ein Fehler trägt seinen Kontext selbst
- [0039](0039-dauerhaft-nur-was-sonst-nirgends-existiert.md) — Dauerhaft ist nur, was sonst nirgends existiert — deshalb rettet ein 401 den Erstfang
- [0040](0040-die-oberflaeche-schreibt-beringer-in.md) — Die Oberfläche schreibt Beringer:in — vier Schreibweisen, jede mit ihrem Geltungsbereich
- [0041](0041-charting-library-chartjs-direct.md) — Visualisation charting: Chart.js used directly, no Angular wrapper
- [0042](0042-zeilenklick-oeffnet-den-detail-dialog.md) — Der Zeilenklick öffnet den Detail-Dialog, der Dialog führt zum Bearbeiten
- [0043](0043-die-gezeichnete-marke-und-ihre-ableitungen.md) — Die gezeichnete Marke und ihre Ableitungen — ein Kanon je Artefakt, zwei Wurzeln, ein Skript
- [0044](0044-die-fehlerseiten-stehen-fuer-sich.md) — Die Fehlerseiten stehen für sich — kein Chrome, Tuschegrund, und der Vogel sagt, welcher Zustand gilt

**Nächste freie Nummer: 0045**
