"""Settings for the test suite: the production settings with a throwaway key.

The hardened settings (issue #73) refuse to boot with ``DEBUG=False`` unless a
real ``SECRET_KEY`` is provided. The suite runs against the real settings with
``DEBUG`` defaulting to ``False``, so inject a non-insecure key *before*
importing them.

This must live in a settings module rather than ``conftest.py``: pytest-django
forces the settings import inside ``pytest_load_initial_conftests``, before any
conftest body runs, so a conftest sets the key too late. Tests that exercise the
fail-loud policy itself reload ``birddoc.settings`` under their own controlled
environment and are unaffected by this default.
"""

import os

os.environ.setdefault("DJANGO_SECRET_KEY", "test-only-secret-key-do-not-use-anywhere")

# An empty ``DATABASE_URL`` (as the test gate passes to blank any inherited value)
# is not a valid database URL — ``env.db`` would fail to parse it instead of
# falling back to the sqlite default. Treat empty-as-unset so the suite always
# runs against the isolated sqlite test database.
if not os.environ.get("DATABASE_URL"):
    os.environ.pop("DATABASE_URL", None)

from birddoc.settings import *  # noqa: E402,F401,F403
