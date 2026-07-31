"""Ein Fehler trägt seinen Kontext selbst: der kollidierende Erstfang reist mit.

Der Beringer steht mit einem Vogel in der Hand, und die App sagt, die Ringnummer
sei vergeben. Die Frage, auf die es ankommt, kann sie nicht beantworten: **ist es
derselbe Vogel** — dann ist der Eintrag in Wahrheit ein Wiederfang — **oder hat
jemand vorige Woche eine Nummer vertippt?** Ohne den kollidierenden Erstfang zu
sehen, ist das nicht zu entscheiden.

``ring_already_first_caught`` trägt ihn deshalb selbst: seine ``errors``-Zeile
bekommt ein ``context`` mit Id, Zeitpunkt, Art und Beringer-Kürzel des Erstfangs,
der die Nummer hält (ADR 0038). **Kein Nachfassen** — eine zweite Anfrage kann
selbst scheitern, und ein Fehler über den Fehler ist das schlechteste erreichbare
Ergebnis. Selbsttragend heißt außerdem vollständig persistierbar: eine spätere
Scheibe schreibt den ganzen Umschlag auf den geflaggten ``OutboxEntry``.

Getrieben durch den bestehenden DRF-HTTP-API-Seam mit den Fixtures aus
``conftest.py`` — der Fehlervertrag hat keine eigene Naht. Jeder Test streift den
Umschlag ab und vergleicht den Rest gegen den wörtlichen Körper von heute: der
Kontext lebt **nur** in ``errors``, die ADR-0033-Byte-Identität bleibt unberührt.
"""

import uuid

import pytest

from birds.capture_service import RING_ALREADY_FIRST_CAUGHT
from birds.models import DataEntry

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


def _erstfang(species, scientist, ringing_station, *, ring_number):
    payload = _payload(species, scientist, ringing_station, ring_number=ring_number)
    payload["bird_status"] = DataEntry.BirdStatus.FIRST_CATCH
    return payload


def _without_envelope(body):
    """The body an old bundle sees: everything but the sibling key."""
    return {key: value for key, value in body.items() if key != "errors"}


def _rival(body):
    """The one rival the rejection names."""
    return body["errors"][0]["context"]["rival"]


@pytest.mark.django_db
def test_the_collision_names_the_erstfang_that_holds_the_number(
    auth_client, species, scientist, ringing_station
):
    """The rejection the whole PRD started from stops being a dead end: it names
    the Erstfang the Beringer has to compare their bird against — Id (to open it),
    Zeitpunkt, Art and Beringer-Kürzel (to recognise it).

    The Zeitpunkt is the one the API renders for that very capture everywhere
    else, so the client formats it with the code path it already has."""
    first = auth_client.post(
        DATA_ENTRIES_URL,
        _erstfang(species, scientist, ringing_station, ring_number="901"),
        format="json",
    )
    assert first.status_code == 201, first.json()
    held = first.json()

    response = auth_client.post(
        DATA_ENTRIES_URL,
        _erstfang(species, scientist, ringing_station, ring_number="901"),
        format="json",
    )

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
                    "id": held["id"],
                    "date_time": held["date_time"],
                    "species": species.common_name_de,
                    "staff": scientist.handle,
                }
            },
        }
    ]


@pytest.mark.django_db
def test_the_race_branch_carries_the_context_too(
    monkeypatch, auth_client, species, scientist, ringing_station
):
    """Two offline devices recording the same Erstfang is exactly the case this
    PRD exists for, so the context must be there when the collision comes from the
    **race branch** — the losing INSERT hitting ``unique_erstfang_per_ring`` — and
    not only from the comfortable sequential Vorabprüfung.

    Simulated the way ``test_capture_service.py`` already simulates it (no real
    threads, no flaky SQLite locking): the winner is created first, then the losing
    request's Erstfang pre-check SELECT is forced to miss exactly once, reproducing
    its view of the world at the instant it read „kein rivalisierender Erstfang".
    That the rejection really came from the race branch is not assumed but pinned:
    the INSERT was attempted, which the sequential Vorabprüfung never lets happen."""
    winner = auth_client.post(
        DATA_ENTRIES_URL,
        _erstfang(species, scientist, ringing_station, ring_number="902"),
        format="json",
    )
    assert winner.status_code == 201, winner.json()
    held = winner.json()

    real_filter = DataEntry.objects.filter
    real_create = DataEntry.objects.create
    precheck = {"missed": False}
    attempted = {"insert": False}

    def _erstfang_precheck_misses_once(*args, **kwargs):
        # Only the ring-Erstfang pre-check names ``bird_status``; force it to miss
        # exactly once, leaving the idempotency lookups and the except-block rival
        # re-read on the real, winner-visible data.
        if "bird_status" in kwargs and not precheck["missed"]:
            precheck["missed"] = True
            return DataEntry.objects.none()
        return real_filter(*args, **kwargs)

    def _record_insert(*args, **kwargs):
        attempted["insert"] = True
        return real_create(*args, **kwargs)

    monkeypatch.setattr(DataEntry.objects, "filter", _erstfang_precheck_misses_once)
    monkeypatch.setattr(DataEntry.objects, "create", _record_insert)

    response = auth_client.post(
        DATA_ENTRIES_URL,
        _erstfang(species, scientist, ringing_station, ring_number="902"),
        format="json",
    )

    assert response.status_code == 400
    assert precheck["missed"] and attempted["insert"]
    body = response.json()
    assert _without_envelope(body) == {"ring_number": str(RING_ALREADY_FIRST_CAUGHT)}
    assert body["errors"] == [
        {
            "field": "ring_number",
            "code": "ring_already_first_caught",
            "detail": str(RING_ALREADY_FIRST_CAUGHT),
            "context": {
                "rival": {
                    "id": held["id"],
                    "date_time": held["date_time"],
                    "species": species.common_name_de,
                    "staff": scientist.handle,
                }
            },
        }
    ]


@pytest.mark.django_db
def test_a_deleted_erstfang_is_no_rival_and_produces_no_context(
    auth_client, species, scientist, ringing_station
):
    """Löschen gives the Nummer back to the Seil (ADR 0030), so re-issuing the
    physical ring is exactly what Löschen exists to allow: the create succeeds and
    there is no rejection to hang a context on."""
    first = auth_client.post(
        DATA_ENTRIES_URL,
        _erstfang(species, scientist, ringing_station, ring_number="903"),
        format="json",
    )
    assert first.status_code == 201, first.json()
    assert auth_client.delete(f"{DATA_ENTRIES_URL}{first.json()['id']}/").status_code == 204

    response = auth_client.post(
        DATA_ENTRIES_URL,
        _erstfang(species, scientist, ringing_station, ring_number="903"),
        format="json",
    )

    assert response.status_code == 201, response.json()
    assert "errors" not in response.json()


@pytest.mark.django_db
def test_a_replay_under_the_same_key_stays_idempotent_and_names_no_rival(
    auth_client, species, scientist, ringing_station
):
    """A retried offline-outbox create is not a collision (#155): the idempotency
    short-circuit hands the existing capture back, so nothing is rejected and no
    rival is invented for a device that is simply asking twice."""
    payload = _erstfang(species, scientist, ringing_station, ring_number="904")
    payload["idempotency_key"] = str(uuid.uuid4())

    first = auth_client.post(DATA_ENTRIES_URL, payload, format="json")
    assert first.status_code == 201, first.json()

    replay = auth_client.post(DATA_ENTRIES_URL, payload, format="json")

    assert replay.status_code == 201, replay.json()
    assert replay.json()["id"] == first.json()["id"]
    assert "errors" not in replay.json()
    assert DataEntry.objects.filter(ring__number="904").count() == 1


@pytest.mark.django_db
def test_a_sonderart_rival_with_the_geloescht_beringer_still_renders(
    auth_client, aves_ignota_species, scientist, ringing_station
):
    """The two rivals with nothing ordinary to say about themselves: an *Aves
    ignota* Sonderart in place of a taxon, and the reserved ``GELÖSCHT`` fallback
    Beringer that adopted the capture when its Beringer was deleted (ADR 0003).
    Both still have to name themselves — no crash, and no empty string where the
    banner expects a name."""
    first = auth_client.post(
        DATA_ENTRIES_URL,
        {
            **_erstfang(aves_ignota_species, scientist, ringing_station, ring_number="905"),
            "comment": "Nur Federreste, nicht bestimmbar.",
        },
        format="json",
    )
    assert first.status_code == 201, first.json()
    held = first.json()

    # Deleting the Beringer reassigns their captures to the reserved fallback
    # sink rather than destroying them, so the rival's Beringer is now ``GELÖSCHT``.
    replacement = ringing_station.organization.scientists.create(
        first_name="Nina", last_name="Nachfolge"
    )
    scientist.delete()

    response = auth_client.post(
        DATA_ENTRIES_URL,
        {
            **_erstfang(aves_ignota_species, replacement, ringing_station, ring_number="905"),
            "comment": "Zweiter Versuch auf derselben Nummer.",
        },
        format="json",
    )

    assert response.status_code == 400
    assert _rival(response.json()) == {
        "id": held["id"],
        "date_time": held["date_time"],
        "species": aves_ignota_species.common_name_de,
        "staff": "GELÖSCHT",
    }


@pytest.mark.django_db
def test_the_rival_is_only_ever_the_requesters_own_organisation(
    auth_client, auth_client_b, species, scientist, scientist_b, ringing_station, ringing_station_b
):
    """Ring-Eindeutigkeit ist mandantengebunden (ADR 0006/0019): jede Organisation
    hat ihr eigenes Seil. Two Organisationen holding the very same Größe+Nummer
    both collide — with **their own** Erstfang. The context must never hand one
    Organisation a look at the other's capture (ADR 0005)."""
    foreign = auth_client_b.post(
        DATA_ENTRIES_URL,
        _erstfang(species, scientist_b, ringing_station_b, ring_number="906"),
        format="json",
    )
    assert foreign.status_code == 201, foreign.json()

    own = auth_client.post(
        DATA_ENTRIES_URL,
        _erstfang(species, scientist, ringing_station, ring_number="906"),
        format="json",
    )
    assert own.status_code == 201, own.json()

    response = auth_client.post(
        DATA_ENTRIES_URL,
        _erstfang(species, scientist, ringing_station, ring_number="906"),
        format="json",
    )

    assert response.status_code == 400
    rival = _rival(response.json())
    assert rival["id"] == own.json()["id"]
    assert rival["staff"] == scientist.handle
    assert rival["id"] != foreign.json()["id"]
