# syntax=docker/dockerfile:1.7
FROM python:3.13-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

# Install dependencies first (cache-friendly: only re-runs when lock or pyproject change)
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --locked --no-install-project --no-dev

# Now bring in the project source and finalize the environment
COPY . /app
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev


FROM python:3.13-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# Non-root runtime user
RUN groupadd --system --gid 1001 app \
    && useradd --system --uid 1001 --gid app --no-create-home --shell /usr/sbin/nologin app

COPY --from=builder --chown=app:app /app /app

# Pre-create staticfiles so the named volume inherits app:app ownership on first mount.
# Without this, Docker creates the volume root-owned and collectstatic fails as non-root.
RUN mkdir -p /app/staticfiles && chown app:app /app/staticfiles

USER app

EXPOSE 8000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["gunicorn", "birddoc.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--access-logfile", "-"]
