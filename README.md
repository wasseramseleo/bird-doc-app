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
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```

Load species reference data (required for autocomplete):

```bash
python manage.py import_species res/artenliste_2024.csv
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
| Django API | http://localhost:8000 | `python manage.py runserver` (in `backend/`) |
| Angular app | http://localhost:4200 | `ng serve` (in `frontend/`) |
| Django admin | http://localhost:8000/admin | login with superuser credentials |

For details, see [`backend/README.md`](backend/README.md) and [`frontend/README.md`](frontend/README.md).
