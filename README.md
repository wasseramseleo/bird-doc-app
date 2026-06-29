# BirdDoc

Field data entry system for bird ringing (ornithology). Captures per-bird biometric measurements, ring assignments, and capture metadata during ringing sessions.

## Monorepo Structure

```
bird-doc-app/
├── backend/    # Django 5 REST API  →  http://localhost:8000
└── frontend/   # Angular 21 SPA     →  http://localhost:4200
```

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for a full system overview.

## Quick Start

### Backend

```bash
cd backend
cp .env.example .env
uv sync
uv run python manage.py migrate
uv run python manage.py createsuperuser
uv run python manage.py runserver
```

Load species reference data (required for autocomplete):

```bash
uv run python manage.py import_species res/artenliste_2024.csv
```

### Frontend

```bash
cd frontend
npm install
ng serve
```

Open `http://localhost:4200`. The backend must be running first.

## Development

Both processes run independently. There is no root-level build script — start them in separate terminals.

| Service | URL | Command |
|---------|-----|---------|
| Django API | http://localhost:8000 | `uv run python manage.py runserver` (in `backend/`) |
| Angular app | http://localhost:4200 | `npm start` (in `frontend/`) |
| Django admin | http://localhost:8000/admin | login with superuser credentials |

For details, see [`backend/README.md`](backend/README.md) and [`frontend/README.md`](frontend/README.md).

### Full stack via Docker

For a Postgres-backed local environment matching production:

```bash
docker compose up --build
```

Brings up `db` (Postgres 16), `backend` (Django on `:8000`), and `frontend` (Angular on `:4200`).

## Deployment

`main` deploys automatically: GitHub Actions builds backend + frontend images, pushes them to GHCR, then SSHes into the **IPAX VPS** (Debian 13, public IP) and rolls out `docker-compose.prod.yml`. **Caddy** terminates TLS via Let's Encrypt and routes by host — apex `birddoc.at` → the Django landing, `app.birddoc.at` → the Angular SPA with `/api` + `/admin` → the backend, and `birddoc.eu` / `app.birddoc.eu` → 301 to the `.at` canonical hosts. Cloudflare and Tailscale are gone (ADR 0007).

See [`docs/deploy.md`](docs/deploy.md) for the full runbook (VPS bootstrap, DNS, Brevo mail, backup/restore, cutover) and [`deploy/README.md`](deploy/README.md) for the required GitHub secrets.
