"""„Freigeben lassen" nennt eine Person: die Admins der eigenen Organisation (#450).

„Wende dich an eine:n Admin" ist in einer Organisation mit zwanzig Mitgliedern ein
Achselzucken (ADR 0037) — ein Mitglied kann heute gar nicht herausfinden, **wen**
es fragen soll: ``OrganizationSerializer`` führt nur ``id/handle/name/country``,
und ``/mitgliedschaften/`` ist Admin-only. Diese Lesefläche schließt genau die
Lücke: die Admins der eigenen Organisation, mit **Name und Kürzel**.

Zwei Grenzen tragen sie, und beide werden hier direkt zugesichert:

- **Strikt die eigene Organisation** (ADR 0005). Die Admins einer fremden
  Organisation sind nicht lesbar, und ein Konto ohne aktive Organisation bekommt
  ein **leeres** Ergebnis — nie einen 403 und nie die Daten eines anderen
  Mandanten, genau wie jede andere org-begrenzte Fläche.
- **Nur Name und Kürzel.** Das sind neue personenbezogene Daten auf der Leitung
  (PRD #438, Further Notes) — innerhalb eines Mandanten, unter Kolleg:innen, die
  sich gegenseitig per E-Mail eingeladen haben, aber neu. Also nur, was
  „Freigeben lassen" wirklich braucht: keine E-Mail, kein Benutzername.

Durch den bestehenden HTTP-API-Seam gefahren, mit den Fixtures aus ``conftest.py``.
"""

import pytest

from birds.models import Mitgliedschaft

URL = "/api/birds/org-admins/"


@pytest.mark.django_db
def test_mitglied_reads_the_admins_of_its_own_organisation(
    mitglied_client, mitglied_scientist, scientist
):
    """Mara ist ein einfaches Mitglied; Alice ist die Admin derselben Organisation.

    Mara bekommt Alice mit Namen und Kürzel — und sich selbst nicht, denn sie kann
    nichts freigeben.
    """
    scientist.first_name = "Alice"
    scientist.last_name = "Auer"
    scientist.save()

    response = mitglied_client.get(URL)

    assert response.status_code == 200
    assert response.json()["results"] == [{"name": "Alice Auer", "handle": "ALC"}]


@pytest.mark.django_db
def test_a_foreign_organisations_admins_are_not_readable(
    mitglied_client, mitglied_scientist, scientist, scientist_b
):
    """Bruno ist Admin von Mandant B. Für Mara existiert er nicht (ADR 0005).

    Die Mandantengrenze ist keine Berechtigung: es gibt niemanden, der Mara den
    Weg zu Bruno freigeben könnte, also steht er auch nicht in der Liste.
    """
    response = mitglied_client.get(URL)

    kuerzel = {row["handle"] for row in response.json()["results"]}
    assert kuerzel == {"ALC"}
    assert "BRU" not in kuerzel


@pytest.mark.django_db
def test_account_without_active_organisation_gets_an_empty_result_not_a_403(auth_client, user):
    """Ein Konto ohne Mitgliedschaft hat keinen Mandanten — also **leer**.

    Kein 403 (es ist nichts verweigert, es ist nichts da) und erst recht nicht die
    Admins eines anderen Mandanten. Genau wie ``/data-entries/``,
    ``/ringing-stations/`` und das Offline-Bündel es halten.
    """
    response = auth_client.get(URL)

    assert response.status_code == 200
    assert response.json()["results"] == []


@pytest.mark.django_db
def test_only_name_and_kuerzel_travel(mitglied_client, mitglied_scientist, scientist):
    """Neue personenbezogene Daten auf der Leitung — und nur die nötigen.

    Namentlich **nicht** die E-Mail: bei einem öffentlich registrierten Konto ist
    der ``username`` die E-Mail (ADR 0008), also wäre auch er eine.
    """
    scientist.user.username = "alice@example.org"
    scientist.user.email = "alice@example.org"
    scientist.user.save()

    row = mitglied_client.get(URL).json()["results"][0]

    assert set(row) == {"name", "handle"}
    assert scientist.user.email not in str(row)
    assert scientist.user.username not in str(row)


@pytest.mark.django_db
def test_an_admin_without_a_beringer_entry_carries_no_kuerzel(
    mitglied_client, mitglied_scientist, scientist, gap_seat
):
    """Ein Admin, dessen Konto (noch) kein Beringer ist, hat kein Kürzel.

    Nichts wird erfunden: der Kürzel ist ``null`` (wie in
    ``MitgliedschaftSerializer``) und der Name kommt vom Konto. Trägt es auch
    keinen, bleibt er leer — der Client lässt so einen Admin dann weg, statt ein
    leeres „frag: " zu zeigen.
    """
    gap_seat.rolle = Mitgliedschaft.Rolle.ADMIN
    gap_seat.save()
    gap_seat.user.first_name = "Gerda"
    gap_seat.user.last_name = "Ohnebogen"
    gap_seat.user.save()

    rows = mitglied_client.get(URL).json()["results"]

    assert {"name": "Gerda Ohnebogen", "handle": None} in rows
