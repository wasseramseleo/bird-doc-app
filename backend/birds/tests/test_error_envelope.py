"""The Fehlervertrag: ``errors`` rides additively beside the unchanged DRF body.

Every rejection DRF renders carries a sibling key ``errors`` — a list of
``{field, code, detail}`` — while the body it has always sent stays **byte
identical** (ADR 0038). That byte-identity is the hard constraint from ADR 0033:
a device may be offline for ~30 days, so the bundle replaying a month-old payload
*is* the old bundle, and it reads exactly the two shapes ``{field: [string]}`` and
``{"detail": …}``. Every test here therefore asserts the old body explicitly, not
incidentally, by stripping the new key and comparing what is left against the
literal body of today.

Driven through the existing DRF HTTP API with the fixtures from ``conftest.py``
— the Fehlervertrag has no seam of its own.
"""

import uuid

import pytest

from birds.capture_service import RING_ALREADY_FIRST_CAUGHT
from birds.models import Mitgliedschaft, Scientist
from birds.permissions import ADMIN_ONLY_MESSAGE
from birds.views import LAST_ADMIN_MESSAGE, SEAT_LIMIT_MESSAGE, DataEntryViewSet

DATA_ENTRIES_URL = "/api/birds/data-entries/"


def _payload(species, scientist, ringing_station, *, ring_number="200", ring_size="V"):
    return {
        "species_id": str(species.id),
        "staff_id": scientist.id,
        "ringing_station_id": ringing_station.handle,
        "ring_number": ring_number,
        "ring_size": ring_size,
        "date_time": "2026-03-01T12:00:00Z",
    }


def _without_envelope(body):
    """The body an old bundle sees: everything but the new sibling key."""
    return {key: value for key, value in body.items() if key != "errors"}


@pytest.mark.django_db
def test_pflichtfeld_rejection_keeps_its_body_and_gains_required_codes(auth_client, scientist):
    """A create with no payload at all: the six German Pflichtfeld sentences arrive
    exactly as before, and each one now names its field and DRF's own ``required``."""
    response = auth_client.post(DATA_ENTRIES_URL, {}, format="json")

    assert response.status_code == 400
    body = response.json()
    assert _without_envelope(body) == {
        "species_id": ["Dieses Feld ist zwingend erforderlich."],
        "ring_number": ["Dieses Feld ist zwingend erforderlich."],
        "ring_size": ["Dieses Feld ist zwingend erforderlich."],
        "staff_id": ["Dieses Feld ist zwingend erforderlich."],
        "ringing_station_id": ["Dieses Feld ist zwingend erforderlich."],
        "date_time": ["Dieses Feld ist zwingend erforderlich."],
    }
    assert body["errors"] == [
        {
            "field": field,
            "code": "required",
            "detail": "Dieses Feld ist zwingend erforderlich.",
        }
        for field in (
            "species_id",
            "ring_number",
            "ring_size",
            "staff_id",
            "ringing_station_id",
            "date_time",
        )
    ]


@pytest.mark.django_db
def test_ring_collision_body_is_unchanged_and_carries_its_entry(
    auth_client, species, scientist, ringing_station
):
    """The rejection the whole PRD started from: a Ringnummer already first-caught.

    It is raised out of ``create`` rather than during ``is_valid``, so DRF sends the
    bare sentence under the field key (no list around it). That form is what a
    month-old bundle replays into — it must not move a byte, and it does not move
    one even though this entry is the richest of them all: the colliding Erstfang
    rides inside ``errors`` alone (its own contract lives in
    ``test_error_context.py``)."""
    first = _payload(species, scientist, ringing_station, ring_number="901")
    first["bird_status"] = "e"
    held = auth_client.post(DATA_ENTRIES_URL, first, format="json")
    assert held.status_code == 201

    again = _payload(species, scientist, ringing_station, ring_number="901")
    again["bird_status"] = "e"
    response = auth_client.post(DATA_ENTRIES_URL, again, format="json")

    assert response.status_code == 400
    body = response.json()
    assert _without_envelope(body) == {"ring_number": str(RING_ALREADY_FIRST_CAUGHT)}
    assert body["errors"] == [
        {
            "field": "ring_number",
            "code": "ring_already_first_caught",
            "detail": str(RING_ALREADY_FIRST_CAUGHT),
            "context": {
                "rival": {
                    "id": held.json()["id"],
                    "date_time": held.json()["date_time"],
                    "species": species.common_name_de,
                    "staff": scientist.handle,
                }
            },
        }
    ]


@pytest.mark.django_db
def test_admin_only_403_is_unchanged_and_gains_a_field_less_entry(
    mitglied_client, mitglied_scientist
):
    """A Rechteverweigerung has no field to mark, so its entry travels without one —
    ADR 0037's „eine Zurückweisung ohne einzelnes Feld rendert nur das Banner"."""
    response = mitglied_client.post(
        "/api/birds/ringing-stations/", {"name": "Neue Station"}, format="json"
    )

    assert response.status_code == 403
    body = response.json()
    assert _without_envelope(body) == {"detail": ADMIN_ONLY_MESSAGE}
    assert body["errors"] == [{"field": None, "code": "admin_only", "detail": ADMIN_ONLY_MESSAGE}]


@pytest.mark.django_db
def test_not_found_detail_is_unchanged_and_gains_a_field_less_entry(auth_client, scientist):
    """A 404 is a ``{"detail": …}`` body too — the second of the two shapes the
    month-old bundle reads."""
    response = auth_client.get(f"{DATA_ENTRIES_URL}00000000-0000-0000-0000-000000000000/")

    assert response.status_code == 404
    body = response.json()
    assert _without_envelope(body) == {"detail": "No DataEntry matches the given query."}
    assert body["errors"] == [
        {
            "field": None,
            "code": "not_found",
            "detail": "No DataEntry matches the given query.",
        }
    ]


@pytest.mark.django_db
def test_seat_limit_409_is_unchanged_and_carries_its_own_code(
    auth_client, user, organization, mailoutbox
):
    """A 409 is a ``{"detail": …}`` body as well, and ``SeatLimitReached`` already
    declares a ``default_code`` — so a hand-written APIException's code rides along
    with nothing to do per view."""
    organization.seat_limit = 1
    organization.save(update_fields=["seat_limit"])
    Mitgliedschaft.objects.create(
        user=user, organization=organization, rolle=Mitgliedschaft.Rolle.ADMIN
    )

    response = auth_client.post(
        "/api/birds/invitations/", {"email": "kollege@example.org"}, format="json"
    )

    assert response.status_code == 409
    body = response.json()
    assert _without_envelope(body) == {"detail": SEAT_LIMIT_MESSAGE}
    assert body["errors"] == [
        {"field": None, "code": "seat_limit_reached", "detail": SEAT_LIMIT_MESSAGE}
    ]


@pytest.mark.django_db
def test_blank_and_invalid_choice_codes_come_along_for_free(
    auth_client, species, scientist, ringing_station
):
    """DRF knows why it refused; the envelope simply stops throwing that away."""
    payload = _payload(species, scientist, ringing_station, ring_number="")
    payload["bird_status"] = "zzz"

    response = auth_client.post(DATA_ENTRIES_URL, payload, format="json")

    assert response.status_code == 400
    body = response.json()
    assert _without_envelope(body) == {
        "ring_number": ["Dieses Feld darf nicht leer sein."],
        "bird_status": ['"zzz" ist keine gültige Option.'],
    }
    assert body["errors"] == [
        {
            "field": "ring_number",
            "code": "blank",
            "detail": "Dieses Feld darf nicht leer sein.",
        },
        {
            "field": "bird_status",
            "code": "invalid_choice",
            "detail": '"zzz" ist keine gültige Option.',
        },
    ]


@pytest.mark.django_db
def test_max_length_code_comes_along_for_free(auth_client, membership):
    """A Kürzel over the 11-character cap: the German sentence is unchanged and now
    names ``max_length``."""
    response = auth_client.post(
        "/api/birds/scientists/", {"handle": "A" * 30, "first_name": "Nina"}, format="json"
    )

    assert response.status_code == 400
    body = response.json()
    assert _without_envelope(body) == {
        "handle": ["Stelle sicher, dass dieses Feld nicht mehr als 11 Zeichen lang ist."]
    }
    assert body["errors"] == [
        {
            "field": "handle",
            "code": "max_length",
            "detail": "Stelle sicher, dass dieses Feld nicht mehr als 11 Zeichen lang ist.",
        }
    ]


@pytest.mark.django_db
def test_unique_code_comes_along_for_free(
    auth_client, membership, organization, no_account_beringer
):
    """Editing a Beringer onto a Kürzel another one already owns (issue #207): the
    Uniqueness-Verstoß keeps its hand-written German message and gains ``unique``."""
    Scientist.objects.create(
        handle="FRE", first_name="Filip", last_name="Reiter", organization=organization
    )

    response = auth_client.patch(
        f"/api/birds/scientists/{no_account_beringer.id}/", {"handle": "FRE"}, format="json"
    )

    assert response.status_code == 400
    body = response.json()
    assert _without_envelope(body) == {
        "handle": ["Dieses Kürzel ist bereits vergeben. Bitte wähle ein anderes Kürzel."]
    }
    assert body["errors"] == [
        {
            "field": "handle",
            "code": "unique",
            "detail": "Dieses Kürzel ist bereits vergeben. Bitte wähle ein anderes Kürzel.",
        }
    ]


@pytest.mark.django_db
def test_list_field_error_flattens_to_an_indexed_field_path(
    auth_client, species, scientist, ringing_station
):
    """A per-item rejection inside a list field (the Parasit vocabulary, ADR 0027)
    arrives from DRF keyed by item index. It is flattened to one stable path per
    sentence — ``parasites[1]`` — never dropped and never a nested object where the
    envelope promises ``{field, code, detail}``."""
    payload = _payload(species, scientist, ringing_station, ring_number="950")
    payload["parasites"] = ["red_mites", "nope"]

    response = auth_client.post(DATA_ENTRIES_URL, payload, format="json")

    assert response.status_code == 400
    body = response.json()
    assert _without_envelope(body) == {"parasites": {"1": ['"nope" ist keine gültige Option.']}}
    assert body["errors"] == [
        {
            "field": "parasites[1]",
            "code": "invalid_choice",
            "detail": '"nope" ist keine gültige Option.',
        }
    ]


@pytest.mark.django_db
def test_body_that_is_not_a_mapping_stays_byte_identical(auth_client, scientist):
    """Removing the last Admin is refused with a bare sentence, which DRF renders as
    a JSON list. A list has no sibling key to hang the envelope on, so the body is
    left exactly as it was rather than reshaped — additive, never replacing
    (ADR 0038). The prose still travels, which is the fallback ADR 0038 prescribes
    for a rejection whose code the client does not get."""
    membership = Mitgliedschaft.objects.get(user=scientist.user)

    response = auth_client.delete(f"/api/birds/mitgliedschaften/{membership.pk}/")

    assert response.status_code == 400
    assert response.json() == [LAST_ADMIN_MESSAGE]


@pytest.mark.django_db
def test_replayed_capture_rejection_reads_the_same_to_a_month_old_bundle(
    auth_client, species, scientist, ringing_station
):
    """The response the offline replay reads carries the envelope, and the body under
    it is byte-identical to the one a month-old bundle was written against (ADR 0033).

    That the bundle *itself* is unmoved by the new sibling key is proven against the
    real client, not a transcription of it: ``frontend/src/app/service/sync.service.spec.ts``
    replays every rejection shape this path can produce — ``{field: [string]}``, the bare
    ``{field: string}`` asserted just below, and ``{"detail": …}`` — each with the envelope
    bolted on, and asserts the identical ``syncError``. It has to run there, because
    ``sync.service.ts::extractServerMessage`` is the one extractor that enumerates *all*
    body keys rather than named ones, so only the TypeScript can say what it does with a
    key it has never seen."""
    first = _payload(species, scientist, ringing_station, ring_number="902")
    first["bird_status"] = "e"
    held = auth_client.post(DATA_ENTRIES_URL, first, format="json")
    assert held.status_code == 201

    replayed = _payload(species, scientist, ringing_station, ring_number="902")
    replayed["bird_status"] = "e"
    replayed["idempotency_key"] = str(uuid.uuid4())
    response = auth_client.post(DATA_ENTRIES_URL, replayed, format="json")

    assert response.status_code == 400
    body = response.json()
    assert _without_envelope(body) == {"ring_number": str(RING_ALREADY_FIRST_CAUGHT)}
    # The exact body the frontend spec replays into the real client.
    assert body["errors"] == [
        {
            "field": "ring_number",
            "code": "ring_already_first_caught",
            "detail": str(RING_ALREADY_FIRST_CAUGHT),
            "context": {
                "rival": {
                    "id": held.json()["id"],
                    "date_time": held.json()["date_time"],
                    "species": species.common_name_de,
                    "staff": scientist.handle,
                }
            },
        }
    ]


@pytest.mark.django_db
def test_non_drf_exception_keeps_todays_behaviour(auth_client, scientist, monkeypatch):
    """An exception DRF does not handle is none of the envelope's business: it stays
    a 500 and no envelope is invented for it."""

    def boom(self, request, *args, **kwargs):
        raise RuntimeError("kaputt")

    monkeypatch.setattr(DataEntryViewSet, "list", boom, raising=True)
    auth_client.raise_request_exception = False

    response = auth_client.get(DATA_ENTRIES_URL)

    assert response.status_code == 500
    assert b"errors" not in response.content
