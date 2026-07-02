"""The ``seed_demo_org`` management command (issue #127, PRD #113, ADR 0012/0013).

The demo Referenzprojekt and any ops-assisted over-cap backfill ride the **same**
IWM import service the API exposes (``birds.iwm_import.commit_import``) — the
command is a second caller of that service, never a bespoke loader or a data
migration. These tests assert external behaviour only: the entities and captures
that exist in the ``BDDEMO`` Organisation after the command runs, its idempotency,
that Sonderarten obey the shared service's invariants, and that the command path
imports a file larger than the API row cap (the case the button rejects).
"""

from io import StringIO

import pytest
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import override_settings

from birds.invitations import seats_used
from birds.iwm_anonymize import CURATED_KUERZEL
from birds.management.commands.seed_demo_org import (
    DEMO_ADMIN_EMAIL,
    DEMO_ADMIN_KÜRZEL,
)
from birds.models import (
    DataEntry,
    Mitgliedschaft,
    Organization,
    Project,
    RingingStation,
    Scientist,
)

DEMO_HANDLE = "BDDEMO"
# The no-account helper Beringer of the curated cast (the non-Admin Kürzel the
# anonymiser collapses onto — ADR 0012). ``ABE`` is the pre-created Admin.
DEMO_HELPER_KÜRZEL = next(k for k in CURATED_KUERZEL if k != DEMO_ADMIN_KÜRZEL)


def _run(**kwargs):
    """Run the command with its output captured (never printed into the test log)."""
    call_command("seed_demo_org", stdout=StringIO(), stderr=StringIO(), **kwargs)


@pytest.mark.django_db
def test_seeds_bddemo_org_with_projekt_stationen_beringer_and_captures(db):
    _run()

    org = Organization.objects.get(handle=DEMO_HANDLE)
    project = Project.objects.get(organization=org)
    captures = DataEntry.objects.filter(organization=org)

    # The demo content lands in the BDDEMO tenant's Projekt.
    assert captures.count() > 0
    assert all(c.project == project for c in captures)
    # The import auto-created the sheet's Beringer and Stationen in the tenant.
    assert Scientist.objects.filter(organization=org).exists()
    assert RingingStation.objects.filter(organization=org).exists()


@pytest.mark.django_db
def test_second_run_creates_no_duplicate_captures(db):
    # Idempotency (re-runnable local / staging / prod): the importer's
    # duplicate-by-capture-key skip makes a second run add nothing.
    _run()
    org = Organization.objects.get(handle=DEMO_HANDLE)
    after_first = DataEntry.objects.filter(organization=org).count()
    beringer_first = Scientist.objects.filter(organization=org).count()
    station_first = RingingStation.objects.filter(organization=org).count()
    assert after_first > 0

    _run()

    # No doubled captures, no doubled Organisation / Projekt / auto-created entities.
    assert DataEntry.objects.filter(organization=org).count() == after_first
    assert Organization.objects.filter(handle=DEMO_HANDLE).count() == 1
    assert Project.objects.filter(organization=org).count() == 1
    assert Scientist.objects.filter(organization=org).count() == beringer_first
    assert RingingStation.objects.filter(organization=org).count() == station_first


@pytest.mark.django_db
def test_command_imports_a_file_larger_than_the_api_row_cap(monkeypatch, db):
    # Over-cap ops-assisted backfill: the API rejects a file beyond ROW_CAP
    # (issue #125), but the command path loads a multi-year history without a
    # background worker. With the cap lowered far below the sheet's row count the
    # command must still import every row — never truncated, never rejected.
    monkeypatch.setattr("birds.iwm_import.ROW_CAP", 5)

    _run()

    org = Organization.objects.get(handle=DEMO_HANDLE)
    assert DataEntry.objects.filter(organization=org).count() > 5


@pytest.mark.django_db
def test_sonderart_demo_captures_obey_the_shared_services_invariants(
    sentinel_species, aves_ignota_species, db
):
    # The command reuses the same parse → validate → create service as the API
    # (no duplicated ingestion path): the sheet's Sonderarten therefore satisfy
    # exactly the shared invariants (ADR 0004). The sample carries one
    # Ring-Vernichtet row and two Aves-ignota rows.
    _run()
    org = Organization.objects.get(handle=DEMO_HANDLE)

    destroyed = DataEntry.objects.filter(organization=org, species=sentinel_species)
    ignota = DataEntry.objects.filter(organization=org, species=aves_ignota_species)
    assert destroyed.count() == 1
    assert ignota.count() == 2

    # Ring Vernichtet: create_capture nulled every bird-data field but kept the
    # ring identity — the destroyed ring is still recorded (ADR 0004 / ADR 0006).
    ring_vernichtet = destroyed.get()
    assert ring_vernichtet.bird_status is None
    assert ring_vernichtet.age_class is None
    assert ring_vernichtet.sex is None
    assert ring_vernichtet.ring is not None

    # Aves ignota rows imported only because validate_capture's mandatory-Bemerkung
    # rule was satisfied — each keeps a non-empty comment.
    assert all(c.comment for c in ignota)


# --- Demo Admin (ABE) pre-creation (issue #178, ADR 0012) -------------------


@pytest.mark.django_db
def test_seeds_demo_admin_user_beringer_and_admin_mitgliedschaft(db):
    # The demo seed pre-creates a named Admin account so a marketing/test login
    # into BDDEMO exists and later curated captures can be attributed to it.
    _run()
    org = Organization.objects.get(handle=DEMO_HANDLE)

    # The login User: email as identifier (ADR 0008), active so it can sign in.
    User = get_user_model()
    user = User.objects.get(username=DEMO_ADMIN_EMAIL)
    assert user.email == DEMO_ADMIN_EMAIL
    assert user.is_active

    # The Beringer with the shared demo Kürzel, scoped to BDDEMO and linked to
    # the login (so the importer resolves ABE to this account, not a duplicate).
    beringer = Scientist.objects.get(handle=DEMO_ADMIN_KÜRZEL)
    assert beringer.organization == org
    assert beringer.user == user
    # A rename-able placeholder name is set (not left blank).
    assert beringer.full_name.strip()

    # An Admin Mitgliedschaft in BDDEMO linking the login to the tenant.
    membership = Mitgliedschaft.objects.get(user=user, organization=org)
    assert membership.rolle == Mitgliedschaft.Rolle.ADMIN


@pytest.mark.django_db
def test_demo_admin_is_ordinary_admin_consuming_one_mitgliedsplatz(db):
    # The demo Admin is an ordinary Admin Mitglied — no is_demo / schema marker —
    # and consumes exactly one Mitgliedsplatz like any other membership (ADR 0012).
    _run()
    org = Organization.objects.get(handle=DEMO_HANDLE)

    membership = Mitgliedschaft.objects.get(organization=org)
    assert not hasattr(membership, "is_demo")
    # The single Admin membership is counted in the org's Seat-Limit accounting.
    assert seats_used(org) == 1


@override_settings(DEBUG=True)
@pytest.mark.django_db
def test_debug_demo_admin_has_known_dev_password(db):
    # Under DEBUG the Admin gets a known, usable dev password so it is demoable.
    _run()
    user = get_user_model().objects.get(username=DEMO_ADMIN_EMAIL)
    assert user.has_usable_password()


@override_settings(DEBUG=True)
@pytest.mark.django_db
def test_debug_demo_admin_password_overridable_via_env(monkeypatch, db):
    # The dev password is overridable via DEMO_ADMIN_PASSWORD.
    monkeypatch.setenv("DEMO_ADMIN_PASSWORD", "s3kret-override")
    _run()
    user = get_user_model().objects.get(username=DEMO_ADMIN_EMAIL)
    assert user.check_password("s3kret-override")


@override_settings(DEBUG=False)
@pytest.mark.django_db
def test_non_debug_demo_admin_password_is_unusable(db):
    # Outside DEBUG the password is unusable — the operator sets a prod secret
    # out-of-band; no known credential ships in a real deployment.
    _run()
    user = get_user_model().objects.get(username=DEMO_ADMIN_EMAIL)
    assert not user.has_usable_password()


@override_settings(DEBUG=True)
@pytest.mark.django_db
def test_rerun_does_not_reset_password_and_creates_no_duplicates(db):
    # Idempotency: a second run must not reset a password set out-of-band and must
    # create no duplicate User / Scientist / Mitgliedschaft.
    _run()
    User = get_user_model()
    user = User.objects.get(username=DEMO_ADMIN_EMAIL)

    # Simulate a password set out-of-band (e.g. a prod secret) after first seed.
    user.set_password("set-out-of-band")
    user.save(update_fields=["password"])

    _run()

    user.refresh_from_db()
    # The out-of-band password survives the re-run untouched.
    assert user.check_password("set-out-of-band")
    # No duplicate identity rows were created.
    assert User.objects.filter(username=DEMO_ADMIN_EMAIL).count() == 1
    assert Scientist.objects.filter(handle=DEMO_ADMIN_KÜRZEL).count() == 1
    org = Organization.objects.get(handle=DEMO_HANDLE)
    assert Mitgliedschaft.objects.filter(user=user, organization=org).count() == 1


# --- Curated Referenzprojekt from demo_iwm.xlsx (issue #179, ADR 0012) -------


@pytest.mark.django_db
def test_seeds_exactly_one_projekt_one_station_and_two_beringer(db):
    # The curated demo_iwm.xlsx yields the Referenzprojekt ADR 0012 decides:
    # exactly one Projekt, one Station, and two Beringer — the account-linked
    # Admin ``ABE`` plus the auto-created no-account helper ``MHU``.
    _run()
    org = Organization.objects.get(handle=DEMO_HANDLE)

    assert Project.objects.filter(organization=org).count() == 1
    assert RingingStation.objects.filter(organization=org).count() == 1

    beringer = Scientist.objects.filter(organization=org)
    assert beringer.count() == 2
    assert set(beringer.values_list("handle", flat=True)) == {
        DEMO_ADMIN_KÜRZEL,
        DEMO_HELPER_KÜRZEL,
    }


@pytest.mark.django_db
def test_captures_attribute_to_the_precreated_admin_not_a_nameless_duplicate(db):
    # The Admin's captures attribute to the pre-created ``ABE`` account (issue
    # #178) — never a nameless auto-created duplicate: ``ABE`` stays a single,
    # account-linked Beringer, and every capture attributes to one of the two
    # curated Beringer (no stray cast leaked past the anonymiser).
    _run()
    org = Organization.objects.get(handle=DEMO_HANDLE)

    abe = Scientist.objects.get(organization=org, handle=DEMO_ADMIN_KÜRZEL)
    assert abe.user is not None  # the pre-created account, not a no-account dup
    assert Scientist.objects.filter(organization=org, handle=DEMO_ADMIN_KÜRZEL).count() == 1

    assert DataEntry.objects.filter(organization=org, staff=abe).exists()
    attributed = set(
        DataEntry.objects.filter(organization=org).values_list("staff__handle", flat=True)
    )
    assert attributed == {DEMO_ADMIN_KÜRZEL, DEMO_HELPER_KÜRZEL}


@pytest.mark.django_db
def test_seeded_captures_carry_biometrics(db):
    # The biometric import fix (#176) flows through the seed: at least one seeded
    # capture carries the Decimal biometrics the anonymiser preserved (proving the
    # fix, not just that rows were created).
    _run()
    org = Organization.objects.get(handle=DEMO_HANDLE)

    assert DataEntry.objects.filter(
        organization=org, wing_span__isnull=False, weight_gram__isnull=False
    ).exists()


@pytest.mark.django_db
def test_projekt_context_is_adopted_from_the_file(db):
    # Fangmethode/Lockmittel/Umstand are adopted from the file via the importer's
    # context-adoption (ADR 0002), not hard-coded on the Projekt: the homogeneous
    # demo file (Fangmethode ``M``, Lockmittel ``N``, Umstand ``20``) lands its
    # values on the seeded Projekt.
    _run()
    org = Organization.objects.get(handle=DEMO_HANDLE)
    project = Project.objects.get(organization=org)

    assert project.capture_method == "M"
    assert project.lure == "N"
    assert project.circumstance == "20"
