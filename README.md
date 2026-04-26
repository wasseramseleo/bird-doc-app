# BirdDoc

Field data entry system for bird ringing (ornithology). Captures per-bird biometric measurements, ring assignments, and capture metadata during ringing sessions.

## Monorepo Structure

```
bird-doc-app/
├── backend/    # Django 5 REST API  →  http://localhost:8000
└── frontend/   # Angular 20 SPA     →  http://localhost:4200
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

`main` deploys automatically: GitHub Actions builds backend + frontend images, pushes them to GHCR, joins the tailnet, then SSHes into a Proxmox LXC container at home and rolls out `docker-compose.prod.yml`. Public traffic reaches the LXC through a Cloudflare Tunnel (`cloudflared` runs as a systemd service on the LXC); TLS terminates at Cloudflare and Caddy serves plain HTTP on `127.0.0.1:80` inside the LXC. The host publishes no public ports.

See [`deploy/README.md`](deploy/README.md) for the one-time LXC bootstrap and the list of required GitHub secrets.
